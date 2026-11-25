/**
 * pull 의 index·sourcetype 하나 처리: 검색 → 행마다 변환 → ingestWindow (run.ts 에서 뺌, 시험이 부른다).
 *
 * Splunk 가 결과를 자르거나, 검색 시간이 넘거나, 결과를 덜 읽으면 구간을 반으로 나눠 앞 조각부터 다시 받는다
 * (SPLUNK_SPEC.md 2절 「시간을 이분할」). 셋 다 구간이 작아지면 풀릴 수 있다. preview 는 나누지 않고 멈춘다.
 * 앞 조각이 확정되어야 뒤 조각으로 가므로 cursor 는 앞으로만 나아간다. 1초 구간도 안 되거나 검색 수 한도에 닿으면
 * 거기서 멈추고 경고한다. 그때까지 확정한 조각만큼은 cursor 가 나아가 있다.
 */
import { ingestWindow, type IngestResult } from './ingest'
import { mapRow } from './mapper'
import type { EntityResolver } from './resolver'
import { runSearchJob, type JobOptions, type JobResult } from './searchJob'
import { windowSearch, type IndexWindow } from './templates'
import { sha256, type SearchTransport } from './transport'
import type { Approved, EventFile, NormalizedEvent } from './types'

export interface PullWindowInput {
  approved: Approved
  index: string
  sourcetype: string
  tenant: string
  window: IndexWindow
  expectedCursor: number | undefined
  /** 잘림으로 나눠 받을 때 이 구간에서 돌릴 검색 수 상한 */
  maxSearches?: number
  job?: JobOptions
  receivedAt?: string
}

export interface PullWindowResult extends Omit<IngestResult, 'checkpointed'> {
  /** 받은 구간 전체를 확정했다 */
  checkpointed: boolean
  searches: number
  splits: number
  resultCount: number
  rejected: string[]
  /** 한 줄 요약 (조각마다) */
  lines: string[]
  /** cursor 를 구간 끝까지 못 옮긴 까닭 */
  warnings: string[]
}

export const DEFAULT_MAX_SEARCHES = 64

export async function pullWindow(t: SearchTransport, f: EventFile, resolver: EntityResolver, input: PullWindowInput): Promise<PullWindowResult> {
  const { index, sourcetype } = input
  const maxSearches = input.maxSearches ?? DEFAULT_MAX_SEARCHES
  const out: PullWindowResult = { added: 0, remapped: 0, duplicates: 0, conflicts: 0, quarantined: 0, resolved: 0, checkpointed: false, searches: 0, splits: 0, resultCount: 0, rejected: [], lines: [], warnings: [] }
  const queue: IndexWindow[] = [input.window]
  let expected = input.expectedCursor
  while (queue.length) {
    if (out.searches >= maxSearches) {
      out.warnings.push(`검색 ${maxSearches}번 한도에 닿아 [${queue[0]!.indexEarliest}, ${input.window.indexLatest}) 는 다음 pull 로 넘긴다 (잘림 ${out.splits}번)`)
      break
    }
    const w = queue.shift()!
    out.searches++
    const job: JobResult = await runSearchJob(t, windowSearch(input.approved, index, sourcetype, w), input.job)
    const receivedAt = input.receivedAt ?? new Date().toISOString()
    const events: NormalizedEvent[] = []
    const rejected: Array<{ raw_sha256: string; indextime: number | null; reason: string }> = []
    if (job.state === 'durable') {
      job.rows.forEach((row, offset) => {
        const m = mapRow(row, { index, sourcetype, sid: job.sid ?? '', offset, tenant: input.tenant, receivedAt }, resolver)
        events.push(...m.events)
        if (m.error) rejected.push({ raw_sha256: sha256(row._raw ?? ''), indextime: row.aegi_indextime ? Number(row.aegi_indextime) : null, reason: m.error })
      })
    }
    const r = ingestWindow(f, { index, sourcetype, window: w, expectedCursor: expected, job, events, rejected })
    out.added += r.added; out.remapped += r.remapped; out.duplicates += r.duplicates; out.conflicts += r.conflicts
    out.quarantined += r.quarantined; out.resolved += r.resolved; out.resultCount += job.resultCount
    out.rejected.push(...rejected.map(x => x.reason))
    const span = w.indexLatest - w.indexEarliest
    out.lines.push(`[${w.indexEarliest}, ${w.indexLatest}) ${job.trail.join(' → ')}${r.checkpointed ? ' → checkpointed' : ''} · 결과 ${job.resultCount} · 추가 ${r.added} · 재매핑 ${r.remapped} · 중복 ${r.duplicates} · 충돌 ${r.conflicts}${rejected.length ? ` · 변환 실패 격리 ${rejected.length}` : ''}${job.messages.length ? ` · ${job.messages.join('; ')}` : ''}`)
    if (r.checkpointed) { expected = f.cursors[`${index}|${sourcetype}`]; continue }
    const splittable = job.incomplete === 'truncated' || job.incomplete === 'timeout' || job.incomplete === 'short_read'
    if (splittable && span > 1) {
      const mid = w.indexEarliest + Math.floor(span / 2)
      queue.unshift({ indexEarliest: w.indexEarliest, indexLatest: mid }, { indexEarliest: mid, indexLatest: w.indexLatest })
      out.splits++
      continue
    }
    out.warnings.push(splittable
      ? `1초 구간 [${w.indexEarliest}, ${w.indexLatest}) 도 ${job.incomplete === 'truncated' ? 'Splunk 가 잘라' : job.incomplete === 'timeout' ? '검색 시간을 넘겨' : '결과를 다 읽지 못해'} 더 나눌 수 없다. source 별 분할이나 수집 경로 분기가 필요하다 (SPLUNK_SPEC.md 2절)`
      : `검색 ${job.state} [${w.indexEarliest}, ${w.indexLatest}): ${job.messages.join('; ') || '까닭 없음'}`)
    break
  }
  out.checkpointed = queue.length === 0 && out.warnings.length === 0
  return out
}
