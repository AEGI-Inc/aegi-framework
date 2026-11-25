/**
 * 구간 결과 확정 (SPLUNK_SPEC.md 3절 ingestWindow).
 * durable 인 검색만 이벤트를 합치고 cursor 를 compare-and-swap 으로 옮긴다 → checkpointed.
 * 변환하지 못한 행은 rejected 에 격리 기록(원문 해시, 색인 시각, 까닭)으로 남기고 cursor 는 옮긴다.
 * 고칠 수 없는 행 하나가 cursor 를 영영 멈추지 않게 하고, 다시 찾을 단서는 남긴다(잃지 않음).
 * 같은 origin_key 에 내용이 다르면 덮어쓰지 않고 충돌로 남긴다.
 */
import fs from 'fs'
import path from 'path'
import type { JobResult } from './searchJob'
import type { IndexWindow } from './templates'
import type { EventFile, NormalizedEvent, RejectedRow, SearchRecord } from './types'

export const EVENT_FILE = 'events.json'

export function emptyEventFile(now = new Date()): EventFile {
  return { version: 1, generated_at: now.toISOString(), cursors: {}, searches: [], events: [], conflicts: [], unresolved: 0 }
}

export function loadEventFile(dir: string): EventFile {
  const file = path.join(dir, EVENT_FILE)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as EventFile : emptyEventFile()
}

export function saveEventFile(dir: string, f: EventFile): void {
  const file = path.join(dir, EVENT_FILE)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(f, null, 1))
  fs.renameSync(tmp, file)
}

export const cursorKey = (index: string, sourcetype: string) => `${index}|${sourcetype}`

export class CursorConflict extends Error {}

export interface IngestInput {
  index: string
  sourcetype: string
  window: IndexWindow
  /** 검색을 계획할 때 읽은 cursor. 그 사이 다른 실행이 옮겼으면 거절한다 */
  expectedCursor: number | undefined
  job: JobResult
  events: NormalizedEvent[]
  /** 이 구간에서 변환하지 못한 행. 격리 기록으로 남기고 cursor 는 옮긴다 */
  rejected?: Array<{ raw_sha256: string; indextime: number | null; reason: string }>
  now?: Date
}

function mappingGeneration(value: string): number | null {
  const match = /^splunk-map\/(\d+)$/.exec(value)
  return match ? Number(match[1]) : null
}

export interface IngestResult { added: number; remapped: number; duplicates: number; conflicts: number; quarantined: number; resolved: number; checkpointed: boolean }

export function ingestWindow(f: EventFile, input: IngestInput): IngestResult {
  const now = (input.now ?? new Date()).toISOString()
  const key = cursorKey(input.index, input.sourcetype)
  const record: SearchRecord = {
    index: input.index, sourcetype: input.sourcetype, sid: input.job.sid,
    window: { index_earliest: input.window.indexEarliest, index_latest: input.window.indexLatest },
    state: input.job.state, trail: [...input.job.trail], result_count: input.job.resultCount, fetched: input.job.rows.length,
    messages: input.job.messages, at: now,
  }
  if (input.job.state !== 'durable') {
    f.searches.push(record)
    return { added: 0, remapped: 0, duplicates: 0, conflicts: 0, quarantined: 0, resolved: 0, checkpointed: false }
  }
  if (f.cursors[key] !== input.expectedCursor) throw new CursorConflict(`${key} cursor 가 바뀌었다 (기대 ${input.expectedCursor}, 현재 ${f.cursors[key]})`)

  const byKey = new Map(f.events.map(e => [e.origin_key, e]))
  let added = 0, remapped = 0, duplicates = 0, conflicts = 0
  for (const e of input.events) {
    const prev = byKey.get(e.origin_key)
    if (!prev) { byKey.set(e.origin_key, e); f.events.push(e); added++; continue }
    if (prev.raw_sha256 === e.raw_sha256) {
      const oldGeneration = mappingGeneration(prev.mapping_version), newGeneration = mappingGeneration(e.mapping_version)
      if (oldGeneration !== null && newGeneration !== null && newGeneration > oldGeneration) {
        const at = f.events.findIndex(x => x.origin_key === e.origin_key)
        if (at >= 0) f.events[at] = e
        byKey.set(e.origin_key, e)
        remapped++
      } else duplicates++
      continue
    }
    f.conflicts.push({ origin_key: e.origin_key, kept: prev.raw_sha256, incoming: e.raw_sha256, at: now })
    conflicts++
  }
  f.events.sort((a, b) => (a.occurred_at ?? '').localeCompare(b.occurred_at ?? '') || a.origin_key.localeCompare(b.origin_key))
  // 변환 실패는 매퍼가 원문 모양을 모를 때라 같은 구간을 다시 받아도 또 실패한다. cursor 를 멈추면 그 sourcetype 이 영영 멈추므로
  // 격리 기록으로 남기고 옮긴다. 매퍼를 고친 뒤 pull --remap-from <격리 색인 시각> 이 다시 받아 변환하면 그 기록을 지운다.
  const rejected = f.rejected ?? []
  const mappedHashes = new Set(input.events.map(e => e.raw_sha256))
  const before = rejected.length
  const kept = rejected.filter(x => !(x.index === input.index && x.sourcetype === input.sourcetype && mappedHashes.has(x.raw_sha256)))
  const resolved = before - kept.length
  let quarantined = 0
  for (const x of input.rejected ?? []) {
    const prev = kept.find(k => k.index === input.index && k.sourcetype === input.sourcetype && k.raw_sha256 === x.raw_sha256)
    if (prev) { prev.last_seen = now; prev.seen++; prev.reason = x.reason; continue }
    const row: RejectedRow = { index: input.index, sourcetype: input.sourcetype, raw_sha256: x.raw_sha256, indextime: x.indextime, window: record.window, reason: x.reason, first_seen: now, last_seen: now, seen: 1 }
    kept.push(row)
    quarantined++
  }
  if (kept.length || f.rejected) f.rejected = kept
  if (input.rejected?.length) record.messages = [...record.messages, `변환 실패 ${input.rejected.length}건 격리(새 ${quarantined}건)`]
  // 구간을 나눠 받을 때 앞 조각의 끝이 겹침 때문에 옛 cursor 보다 앞일 수 있어 뒤로 물리지 않는다
  f.cursors[key] = Math.max(input.window.indexLatest, f.cursors[key] ?? -Infinity)
  record.state = 'checkpointed'
  record.trail.push('checkpointed')
  f.searches.push(record)
  f.unresolved = f.events.filter(e => (e.actor && !e.actor.object_key) || e.targets.some(t => !t.object_key && t.type !== 'ExternalAddress')).length
  f.generated_at = now
  return { added, remapped, duplicates, conflicts, quarantined, resolved, checkpointed: true }
}
