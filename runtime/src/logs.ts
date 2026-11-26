/**
 * 감사 로그 조회 서비스. 운영 Connector 자리를 한 프로세스 안에서 맡는다:
 *   대시보드 서버 ─(relay.request)→ 엔진 dispatcher → QueryService / EventService ─(SearchTransport, HTTPS)→ 기업 Splunk 검색 REST
 * 결과는 운영처럼 로그 캐시 표(log_*)에 쓰이고, 대시보드는 그 표를 읽는다. Splunk 설정이 없으면 서비스를 만들지 않는다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { graphIndex } from '../dashboard/server/connector.ts'
import type { Relay, RelayReply, RelayRequest } from '../dashboard/server/splunkRelay.ts'
import { createDispatcher } from '../engine/scripts/stream/splunk/query/dispatch.ts'
import { EventService } from '../engine/scripts/stream/splunk/query/events.ts'
import { LogStore } from '../engine/scripts/stream/splunk/query/logStore.ts'
import { QueryService } from '../engine/scripts/stream/splunk/query/service.ts'
import type { Workspace } from '../engine/scripts/stream/splunk/query/workspace.ts'
import type { SearchTransport, Wire } from '../engine/scripts/stream/splunk/transport.ts'
import type { LocalDb } from './db.ts'
import { DATA_DIR } from './paths.ts'
import { loadWorkspace, splunkSettings, splunkTransport, type SplunkSettings } from './splunk.ts'

export { WORKSPACE_ID } from './splunk.ts'

export interface LogServices { relay: Relay; store: LogStore; transport: SearchTransport; workspace: Workspace; settings: SplunkSettings }

/** Splunk 를 바꾸거나 그래프를 다시 게시하면 조회 캐시(log_*)를 비운다. 다음 조회가 Splunk 를 다시 읽는다 */
export async function clearLogCache(local: LocalDb) {
  await local.exec.batch(['log_query_event', 'log_spl_result', 'log_query', 'log_event_link', 'log_event', 'log_bucket'].map(t => ({ sql: `DELETE FROM ${t}`, params: [] })))
}

/** .env 에 SPLUNK_URL 이 없으면 null. wire 는 시험에서 Splunk 응답을 흉내 낼 때만 준다 */
export function createLogServices(local: LocalDb, env: Record<string, string>, opts: { wire?: Wire; jobDir?: string } = {}): LogServices | null {
  const settings = splunkSettings(env)
  if (!settings) return null
  const workspace = loadWorkspace(settings.sourcesFile)
  const transport = splunkTransport(settings, opts.wire)
  const hours = Number(env.AEGI_LOG_CACHE_HOURS || 24)
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) throw new Error('AEGI_LOG_CACHE_HOURS 는 0 초과 720 이하 시간이다')
  const store = new LogStore(local.exec, hours * 3600_000)
  const index = async (expected?: string) => {
    try { const i = await graphIndex(local.d1); return !expected || i.snapshotId === expected ? i as never : null } catch { return null }
  }
  // 이전 실행이 남긴 작업 파일은 서비스가 실패로 표시한다. 설치판은 매번 비우고 시작한다
  const jobDir = opts.jobDir ?? path.join(DATA_DIR, 'jobs')
  fs.rmSync(jobDir, { recursive: true, force: true })
  const query = new QueryService(transport, [workspace], jobDir, store, () => index())
  const events = new EventService(transport, [workspace], path.join(jobDir, 'events'), store, index)
  const dispatch = createDispatcher({ query, events })
  const relay: Relay = {
    async request(request: RelayRequest): Promise<RelayReply> {
      const r = await dispatch(request)
      return { status: r.status, body: (r.body ?? {}) as Record<string, unknown> }
    },
    async poll() { return [] },
    respond() { return false },
    requeue() {},
  }
  return { relay, store, transport, workspace, settings }
}
