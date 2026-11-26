/**
 * Splunk 커넥터 엔드포인트 (운영 Pages). 고객 내부망의 커넥터가 밖으로만 연결해 AI 검색 요청을 받아 가고 답을 올린다.
 *
 *   POST /api/connector/poll     → { requests: [{ id, request }] }  대기 요청이 없으면 최대 10초 기다린다
 *   POST /api/connector/respond  { id, status, body }  → { ok: true } | 410 이미 만료된 요청
 *   POST /api/connector/graph-index → { snapshotId, objects, links, appTenants }  current 스냅샷의 객체 식별자, 동일인 연결,
 *        Okta 앱이 등록된 다른 SaaS 짝만. 커넥터가 이벤트의 원본 ID를 그래프 객체 키로 잇고 이벤트 연결을 계산하는 데 쓴다
 *        (adapter-engine events 조회. 짝은 SSO 인계가 넘어간 SaaS 를 고를 때 쓴다)
 *
 * 인증은 팀 로그인 세션이 아니라 커넥터 키(`AEGI_SPLUNK_CONNECTOR_KEY`, Bearer)다. 대기열은 D1 `splunk_relay`(마이그레이션 0005).
 * 키나 D1이 없으면 404로 끝나 이 경로가 있는지도 드러내지 않는다.
 */
import type { D1Like } from './exceptions'
import { readBoundedText } from './assistant/planner'
import { D1Relay, connectorAuthorized, connectorRoute } from './splunkRelay'
import { currentSnapshotId, withSnapshotPin } from './snapshotGraph'

export interface ConnectorEnv {
  AEGI_SPLUNK_CONNECTOR_KEY?: string
  AEGI_GRAPH_INDEX_KEY?: string
  EXCEPTIONS_DB?: D1Like
  /** server/measured.ts MeasuredEnv 와 같다 */
  AEGI_GRAPH_SNAPSHOT_ID?: string
}

const BODY_LIMIT = 1_200_000
const POLL_WAIT_MS = 10_000
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export async function handleConnector(request: Request, env: ConnectorEnv, relay?: D1Relay): Promise<Response> {
  env = { ...env, EXCEPTIONS_DB: withSnapshotPin(env.EXCEPTIONS_DB, env.AEGI_GRAPH_SNAPSHOT_ID) }
  const route = new URL(request.url).pathname.replace(/^\/api\/connector\/?/, '')
  const key = route === 'graph-index' ? env.AEGI_GRAPH_INDEX_KEY ?? env.AEGI_SPLUNK_CONNECTOR_KEY : env.AEGI_SPLUNK_CONNECTOR_KEY
  if (!key || !env.EXCEPTIONS_DB || request.method !== 'POST' || !['poll', 'respond', 'graph-index'].includes(route)) return json(404, { error: 'not_found' })
  if (!(await connectorAuthorized(request.headers.get('Authorization'), key))) return json(401, { error: 'unauthorized' })
  if (route === 'graph-index') {
    try { return json(200, await graphIndex(env.EXCEPTIONS_DB)) } catch { return json(503, { error: 'graph_index_unavailable' }) }
  }
  let body: unknown
  try {
    const text = await readBoundedText(request.body, BODY_LIMIT)
    body = text ? JSON.parse(text) : {}
  } catch { return json(400, { error: 'invalid_body' }) }
  // A connector that hangs up mid long-poll stops claiming; anything already claimed goes back to the queue.
  // 10 s of 0.25 s checks is 40 D1 queries, inside the free plan's 50 per invocation.
  const result = await connectorRoute(route as 'poll' | 'respond', body, relay ?? new D1Relay(env.EXCEPTIONS_DB), POLL_WAIT_MS, request.signal)
  return json(result.status, result.body)
}

const ID_FIELDS = ['id', 'login', 'email', 'primaryEmail', 'full_name', 'key']

/**
 * Identifiers only: provider and the identifier values the engine resolver matches on, never other object fields
 * (이름 일치(D1)에 쓰는 SF 권한 집합 Label 과 Flow ApiName 만 예외).
 * SQL picks the fields so the Worker parses a few small strings per object (free plan: 10 ms CPU per request).
 * Numeric identifiers (GitHub ids) are kept: the engine matches them only inside the object type the mapper names.
 * Relations go as their indexed columns plus the role key, so the engine can record which relation's two ends an event's
 * actor and targets were (relation_matches). collectedAt is when the snapshot's dataset was made.
 */
export async function graphIndex(db: D1Like) {
  const snapshotId = await currentSnapshotId(db)
  if (!snapshotId) throw new Error('no_snapshot')
  const picks = ID_FIELDS.map(f => `'${f}', json_extract(detail, '$.canonical.identifiers.${f}.value')`).join(', ')
  const objects = (await db.prepare(`SELECT id, json_extract(detail, '$.canonical.provider') AS provider, json_object(${picks}) AS ids,
    CASE json_extract(detail, '$.canonical.object_type')
      WHEN 'PermissionSet' THEN json_object('Label', json_extract(detail, '$.canonical.properties.Label'))
      WHEN 'FlowDefinitionView' THEN json_object('ApiName', json_extract(detail, '$.canonical.properties.ApiName'))
      ELSE NULL END AS props
    FROM snap_objects WHERE snapshot_id = ?`)
    .bind(snapshotId).all<{ id: string; provider: string | null; ids: string; props: string | null }>()).results.map(r => {
    const values = JSON.parse(r.ids) as Record<string, unknown>
    const identifiers = Object.fromEntries(Object.entries(values).filter(([, v]) => (typeof v === 'string' && v) || (typeof v === 'number' && Number.isFinite(v))).map(([k, v]) => [k, { value: v }]))
    const parsedProps = r.props ? JSON.parse(r.props) as Record<string, unknown> : null
    const properties = parsedProps ? Object.fromEntries(Object.entries(parsedProps).filter(([, v]) => typeof v === 'string' && v)) : null
    const hasProps = properties && Object.keys(properties).length > 0
    return { fixture_key: r.id, canonical: { provider: r.provider ?? undefined, identifiers, ...(hasProps ? { properties } : {}) } }
  })
  const links = (await db.prepare('SELECT detail FROM snap_links WHERE snapshot_id = ? ORDER BY ord').bind(snapshotId).all<{ detail: string }>()).results.map(r => JSON.parse(r.detail) as unknown)
  const relations = (await db.prepare(`SELECT id, type, from_key AS "from", to_key AS "to", json_extract(detail, '$.canonical.references.role.value') AS role
    FROM snap_relations WHERE snapshot_id = ? ORDER BY ord`).bind(snapshotId).all<{ id: string; type: string; from: string; to: string; role: string | null }>()).results
    .map(r => ({ id: r.id, type: r.type, from: r.from, to: r.to, role: r.role ?? null }))
  const collectedAt = (await db.prepare('SELECT dataset_created_at AS at FROM graph_snapshots WHERE id = ?').bind(snapshotId).first<{ at: string | null }>())?.at ?? null
  return { snapshotId, objects, links, appTenants: await appTenants(db, snapshotId), relations, collectedAt }
}

/**
 * Okta Application → 다른 SaaS 객체 registered_in(crosswalk tenant_pointer) 하나마다 앱 키와 끝 객체의 SaaS.
 * 짝을 고르기만 하고 판단(한 앱이 SaaS 둘을 가리키면 모른다)은 engine `ssoAppsFrom` 이 한다. 같은 짝을 engine `appTenants` 가 데이터셋에서 뽑는다.
 * SaaS 는 끝 객체의 provider 다. 정규화는 SaaS 를 넘는 관계의 references 양끝에도 관계의 provider 를 적는다.
 */
async function appTenants(db: D1Like, snapshotId: string) {
  return (await db.prepare(`SELECT r.from_key AS app, json_extract(t.detail, '$.canonical.provider') AS provider FROM snap_relations r
      JOIN snap_objects s ON s.snapshot_id = r.snapshot_id AND s.id = r.from_key
      JOIN snap_objects t ON t.snapshot_id = r.snapshot_id AND t.id = r.to_key
    WHERE r.snapshot_id = ? AND r.type = 'registered_in' AND json_extract(s.detail, '$.canonical.provider') = 'okta'
      AND json_extract(s.detail, '$.canonical.object_type') = 'Application' AND json_extract(t.detail, '$.canonical.provider') <> 'okta'
    ORDER BY r.ord`).bind(snapshotId).all<{ app: string; provider: string }>()).results.map(r => ({ app: r.app, provider: r.provider }))
}
