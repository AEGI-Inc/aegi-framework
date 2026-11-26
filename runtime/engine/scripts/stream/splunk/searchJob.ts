/**
 * 검색 상태 기계 (SPLUNK_SPEC.md 2절).
 *   planned → dispatched → running → fetching → durable   (checkpointed 는 ingest 가 cursor 를 옮긴 뒤)
 *   실패는 failed, 결과를 다 읽지 못하거나 Splunk 가 결과를 잘랐으면 incomplete. 둘 다 cursor 를 옮기지 않는다.
 * SID 를 받은 것은 완료가 아니다. 완료 상태와 최종 결과 수를 확인하고 모든 페이지를 읽는다. preview 결과는 버린다.
 */
import type { SearchTransport } from './transport'

export type JobState = 'planned' | 'dispatched' | 'running' | 'fetching' | 'durable' | 'checkpointed' | 'failed' | 'incomplete'

export interface JobResult {
  state: JobState
  trail: JobState[]
  sid: string | null
  resultCount: number
  rows: Array<Record<string, string>>
  messages: string[]
  /** incomplete 의 까닭. pull 은 preview 를 빼고 구간을 나눠 다시 받는다(구간이 작으면 풀릴 수 있는 것들) */
  incomplete?: 'truncated' | 'timeout' | 'short_read' | 'preview'
}

export interface JobOptions {
  pollMs?: number
  timeoutMs?: number
  pageSize?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function runSearchJob(t: SearchTransport, spl: string, opts: JobOptions = {}): Promise<JobResult> {
  const { pollMs = 1000, timeoutMs = 120_000, pageSize = 1000, sleep = defaultSleep, now = Date.now } = opts
  const trail: JobState[] = ['planned']
  const out = (state: JobState, extra: Partial<JobResult> = {}): JobResult => {
    if (trail[trail.length - 1] !== state) trail.push(state)
    return { state, trail, sid: null, resultCount: 0, rows: [], messages: [], ...extra }
  }

  let sid: string
  try { sid = await t.createJob(spl) } catch (e) { return out('failed', { messages: [String((e as Error).message)] }) }
  trail.push('dispatched')

  const started = now()
  let status = await t.jobStatus(sid)
  while (!status.isDone && !status.isFailed) {
    if (trail[trail.length - 1] !== 'running') trail.push('running')
    if (now() - started > timeoutMs) {
      await t.cancel(sid).catch(() => undefined)
      return out('incomplete', { sid, incomplete: 'timeout', messages: [`검색 시간 초과 ${timeoutMs}ms`] })
    }
    await sleep(pollMs)
    status = await t.jobStatus(sid)
  }
  if (status.isFailed || status.dispatchState === 'FAILED' || status.dispatchState === 'EXPIRED') {
    return out('failed', { sid, messages: status.messages })
  }
  if (trail[trail.length - 1] !== 'running') trail.push('running')
  // Splunk 가 결과를 잘랐으면(강제 종료, 이벤트 잘림, 버린 결과) 다 읽어도 구간이 온전하지 않다. cursor 를 옮기지 않는다.
  // 구간을 나눠 다시 받는 것은 pull.ts pullWindow 가 한다(SPLUNK_SPEC.md 2절).
  if (status.truncated) {
    return out('incomplete', { sid, resultCount: status.resultCount, incomplete: 'truncated', messages: ['Splunk 가 결과를 잘랐다 (isFinalized, eventIsTruncated 또는 dropCount)', ...status.messages] })
  }

  trail.push('fetching')
  const rows: Array<Record<string, string>> = []
  while (rows.length < status.resultCount) {
    const page = await t.results(sid, rows.length, pageSize)
    if (page.preview) return out('incomplete', { sid, resultCount: status.resultCount, rows, incomplete: 'preview', messages: ['preview 결과는 확정하지 않는다'] })
    if (!page.rows.length) break
    rows.push(...page.rows)
  }
  if (rows.length !== status.resultCount) {
    return out('incomplete', { sid, resultCount: status.resultCount, rows, incomplete: 'short_read', messages: [`결과 ${status.resultCount}건 중 ${rows.length}건만 읽었다`] })
  }
  return out('durable', { sid, resultCount: status.resultCount, rows, messages: status.messages })
}
