/**
 * sourcetype 별 원본 → 정규 이벤트 (SPLUNK_SPEC.md 4절 mapper).
 * 원문 전체는 싣지 않고 허용한 짧은 필드만 attributes 로 옮긴다.
 */
import { sha256 } from './transport'
import type { EntityResolver, ObjectMatch } from './resolver'
import { MAPPING_VERSION, SOURCETYPE_PROVIDER, type EntityRef, type EventCategory, type NormalizedEvent } from './types'
import eventLabels from '../../../ontology/splunk-event-labels-v1.json' with { type: 'json' }
import { to18 } from '../../collect/shared/sfid'
import { confluenceId, confluenceTime, isConfluenceAudit } from './confluence'
import { categoryOf, outcomeOf, SF_ACTION_FLOW_PATTERN, SF_ACTION_PERM_SET_PATTERN, SF_TARGET_FLOW_PATTERN, SF_TARGET_PERMISSION_SET_PATTERN, SF_TARGET_USER_PATTERN } from './eventClasses'

export interface RowMeta {
  index: string
  sourcetype: string
  sid: string
  offset: number
  /** Splunk 색인 시각(초) */
  indextime: number | null
  tenant: string
  receivedAt: string
}

const OKTA_PREFIX: Record<string, string> = { User: 'OKTA-U', UserGroup: 'OKTA-G', AppInstance: 'OKTA-APP', PolicyRule: 'OKTA-PRULE', PolicyEntity: 'OKTA-POL' }

/** 비밀값처럼 보이는 이름은 싣지 않는다 */
const SECRETISH = /token|secret|password|key|cookie|assertion/i
const MAX_ATTR = 24
const MAX_LEN = 200

/** 찾은 객체 키와 그 근거, 또는 못 찾은 이유를 EntityRef 칸으로 옮긴다 */
function keyed(m: ObjectMatch | { miss: 'not_in_graph' | 'ambiguous' } | null): Pick<EntityRef, 'object_key' | 'matched_on' | 'unmatched'> {
  if (!m) return { object_key: null }
  if ('key' in m) return { object_key: m.key, matched_on: m.matched_on }
  return { object_key: null, unmatched: m.miss }
}

function localizedTitle(provider: string, eventType: string): string {
  return (eventLabels.labels as Record<string, string>)[`${provider}|${eventType}`] ?? eventType
}

function clip(v: unknown): string | number | boolean | undefined {
  if (typeof v === 'boolean' || typeof v === 'number') return v
  if (typeof v === 'string') return v.length > MAX_LEN ? `${v.slice(0, MAX_LEN)}…` : v
  return undefined
}

/** Okta 세션·트랜잭션 id. 비었거나 Okta 가 모를 때 넣는 'unknown' 이면 null */
function oktaKnown(v: unknown): string | null {
  return v === undefined || v === null || v === '' || v === 'unknown' ? null : String(v)
}

function isoFromEpoch(sec: number | null): string | null {
  return sec === null || !Number.isFinite(sec) ? null : new Date(sec * 1000).toISOString()
}

// category, outcome 판정은 eventClasses.ts 의 표가 정본이다. AI 검색의 SPL 판정도 같은 표에서 만든다
const oktaCategory = (t: string): EventCategory => categoryOf('okta:im2:log', { t })
const gwsCategory = (app: string, name: string): EventCategory => categoryOf('gws:reports:activity', { app, name })

export function mapOkta(raw: Record<string, any>, meta: RowMeta, r: EntityResolver): NormalizedEvent {
  const ref = (at: string) => (e: Record<string, any> | null | undefined): EntityRef | null => {
    if (!e?.id) return null
    return { native_id: String(e.id), type: String(e.type ?? 'unknown'), display: e.displayName ?? e.alternateId ?? null, ...keyed(r.lookup('okta', [[`${at}.id`, e.id], [`${at}.alternateId`, e.alternateId]], OKTA_PREFIX[e.type])) }
  }
  const debug = (raw.debugContext?.debugData ?? {}) as Record<string, unknown>
  const caused: EntityRef[] = []
  if (typeof debug.triggeredByGroupRuleId === 'string') {
    const id = debug.triggeredByGroupRuleId
    caused.push({ native_id: id, type: 'GroupRule', display: null, ...keyed(r.lookup('okta', [['debugContext.debugData.triggeredByGroupRuleId', id]], 'OKTA-GRULE')) })
  }
  const attributes: Record<string, string | number | boolean> = {}
  for (const k of ['changedAttributes', 'privilegeGranted', 'requestUri', 'triggeredByGroupRuleId']) {
    const v = clip(debug[k]); if (v !== undefined) attributes[k] = v
  }
  if (raw.legacyEventType) attributes.legacyEventType = String(raw.legacyEventType)
  const result = String(raw.outcome?.result ?? '').toUpperCase()
  const tx = raw.transaction?.id
  return {
    origin_key: `okta:${meta.tenant}:${raw.uuid}`,
    provider: 'okta',
    event_type: String(raw.eventType),
    category: oktaCategory(String(raw.eventType)),
    title: localizedTitle('okta', String(raw.eventType)),
    occurred_at: typeof raw.published === 'string' ? raw.published : null,
    indexed_at: isoFromEpoch(meta.indextime),
    received_at: meta.receivedAt,
    outcome: outcomeOf('okta:im2:log', { result }),
    outcome_reason: raw.outcome?.reason ?? null,
    signal: String(raw.eventType ?? '').startsWith('security.threat.') ? { kind: 'suspicious', source: 'eventType', value: String(raw.eventType) } : null,
    actor: ref('actor')(raw.actor),
    targets: ((raw.target ?? []) as Array<Record<string, any>>).map(ref('target[]')).filter((x): x is EntityRef => !!x),
    correlation: {
      // Okta 는 세션을 모르면 'unknown' 을 넣는다. 그 값끼리 같은 세션으로 묶이지 않게 비운다
      session_id: oktaKnown(raw.authenticationContext?.rootSessionId) ?? oktaKnown(raw.authenticationContext?.externalSessionId),
      transaction_id: oktaKnown(tx),
      caused_by: caused,
      client_ip: raw.client?.ipAddress ?? null,
    },
    attributes,
    transport_ref: { index: meta.index, sourcetype: meta.sourcetype, sid: meta.sid, offset: meta.offset },
    mapping_version: MAPPING_VERSION,
    raw_sha256: '',
  }
}

/** 대상으로 볼 GWS 파라미터 → 종류 */
const GWS_TARGET_PARAMS: Record<string, string> = {
  USER_EMAIL: 'User', affected_email_address: 'User', target_user: 'User', user_email: 'User',
  GROUP_EMAIL: 'Group', group_email: 'Group',
  doc_id: 'File', email_forwarding_destination_address: 'ExternalAddress',
}

/** GWS activity 하나에 events 가 여러 개면 이벤트마다 하나씩 만든다 */
export function mapGws(raw: Record<string, any>, meta: RowMeta, r: EntityResolver): NormalizedEvent[] {
  const id = raw.id ?? {}
  const actorEmail: string | undefined = raw.actor?.email
  const actor: EntityRef | null = raw.actor?.profileId || actorEmail
    ? { native_id: String(raw.actor.profileId ?? actorEmail), type: 'User', display: actorEmail ?? raw.actor?.key ?? null, ...keyed(r.lookup('gws', [['actor.profileId', raw.actor.profileId], ['actor.email', actorEmail]])) }
    : raw.actor?.callerType ? { native_id: String(raw.actor.key ?? raw.actor.callerType), type: String(raw.actor.callerType), display: raw.actor.key ?? null, object_key: null } : null
  return ((raw.events ?? []) as Array<Record<string, any>>).map((e, i) => {
    const attributes: Record<string, string | number | boolean> = {}
    const targets: EntityRef[] = []
    let outcomeReason: string | null = null
    let signal: NormalizedEvent['signal'] = null
    let tokenClientId: string | null = null
    let tokenAppName: string | null = null
    const app = String(id.applicationName)
    const name = String(e.name)
    for (const p of (e.parameters ?? []) as Array<Record<string, any>>) {
      const name = String(p.name)
      const value = p.value ?? p.boolValue ?? p.intValue ?? (Array.isArray(p.multiValue) ? p.multiValue.join(',') : undefined)
      if (GWS_TARGET_PARAMS[name] && typeof value === 'string' && value) {
        targets.push({ native_id: value, type: GWS_TARGET_PARAMS[name], display: value, ...(GWS_TARGET_PARAMS[name] === 'ExternalAddress' ? { object_key: null } : keyed(r.lookup('gws', [[`events[].parameters.${name}`, value]]))) })
      }
      if (app === 'token' && name === 'client_id' && typeof value === 'string') tokenClientId = value
      if (app === 'token' && name === 'app_name' && typeof value === 'string') tokenAppName = value
      if (app === 'login' && name.startsWith('suspicious_')) signal = { kind: 'suspicious', source: 'event_type', value: `${app}:${name}` }
      if (name === 'is_suspicious' && (value === true || value === 'true')) signal = { kind: 'suspicious', source: 'is_suspicious', value: true }
      if (SECRETISH.test(name) || Object.keys(attributes).length >= MAX_ATTR) continue
      const v = clip(typeof p.intValue === 'string' ? Number(p.intValue) : value); if (v !== undefined) attributes[name] = v
    }
    const outcome = outcomeOf('gws:reports:activity', { app, name })
    if (app === 'login' && name === 'login_failure') {
      const reason = (e.parameters as Array<Record<string, any>>).find(x => x.name === 'login_failure_type')
      const reasonValue = reason?.value ?? reason?.stringValue
      if (typeof reasonValue === 'string' && reasonValue) outcomeReason = reasonValue
    } else if (app === 'login' && name.startsWith('suspicious_')) {
      outcomeReason = 'blocked'
    }
    if (app === 'login' && name.startsWith('suspicious_')) signal = { kind: 'suspicious', source: 'event_type', value: `${app}:${name}` }
    if (tokenClientId && r.isSelfClient(tokenClientId)) putAttr(attributes, 'aegi_self', true)
    if (app === 'token' && (tokenClientId || tokenAppName)) {
      const clientId = tokenClientId ?? tokenAppName!
      const display = tokenClientId ? r.gwsTokenDisplay(tokenClientId) : null
      const tokenMatch = tokenClientId && raw.actor?.profileId
        ? r.lookup('gws', [['actor.profileId|events[].parameters.client_id', `${raw.actor.profileId}|${tokenClientId}`]], 'GWS-TOK')
        : null
      targets.push({ native_id: clientId, type: 'Application', display: display ?? tokenAppName ?? clientId, ...keyed(tokenMatch) })
    }
    const eventType = `${app}:${name}`
    return {
      origin_key: `gws:${id.customerId ?? meta.tenant}:${id.applicationName}:${id.time}:${id.uniqueQualifier}:${i}`,
      provider: 'gws' as const,
      event_type: eventType,
      category: gwsCategory(app, name),
      title: localizedTitle('gws', eventType),
      occurred_at: typeof id.time === 'string' ? id.time : null,
      indexed_at: isoFromEpoch(meta.indextime),
      received_at: meta.receivedAt,
      outcome,
      outcome_reason: outcomeReason,
      signal,
      actor,
      targets,
      correlation: { session_id: null, transaction_id: null, caused_by: [], client_ip: raw.ipAddress ?? null },
      attributes,
      transport_ref: { index: meta.index, sourcetype: meta.sourcetype, sid: meta.sid, offset: meta.offset },
      mapping_version: MAPPING_VERSION,
      raw_sha256: '',
    }
  })
}

/** 원본 객체의 짧은 값 필드를 attributes 로 옮긴다. skip 과 비밀값처럼 보이는 이름은 뺀다 */
function shortFields(src: Record<string, unknown> | null | undefined, skip: Set<string>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, raw] of Object.entries(src ?? {})) {
    if (Object.keys(out).length >= MAX_ATTR) break
    if (skip.has(k) || SECRETISH.test(k)) continue
    const v = clip(raw); if (v !== undefined) out[k] = v
  }
  return out
}

function putAttr(attributes: Record<string, string | number | boolean>, k: string, v: unknown): void {
  const c = clip(v)
  if (c !== undefined && Object.keys(attributes).length < MAX_ATTR) attributes[k] = c
}

function common(meta: RowMeta): Pick<NormalizedEvent, 'indexed_at' | 'received_at' | 'transport_ref' | 'mapping_version' | 'raw_sha256'> {
  return {
    indexed_at: isoFromEpoch(meta.indextime),
    received_at: meta.receivedAt,
    transport_ref: { index: meta.index, sourcetype: meta.sourcetype, sid: meta.sid, offset: meta.offset },
    mapping_version: MAPPING_VERSION,
    raw_sha256: '',
  }
}

const githubCategory = (action: string): EventCategory => categoryOf('github:cloud:audit', { action })

const GITHUB_SKIP = new Set(['@timestamp', 'created_at', '_document_id', 'action', 'actor', 'actor_id', 'actor_ip', 'actor_location', 'user', 'user_id', 'repo', 'repo_id', 'org', 'org_id', 'team'])

/** GitHub 조직 감사 로그 (GH-17). 대상은 사용자, 저장소, 팀이다. 셋 다 없으면 조직을 대상으로 둔다 */
export function mapGithub(raw: Record<string, any>, meta: RowMeta, r: EntityResolver): NormalizedEvent {
  const action = String(raw.action ?? 'unknown')
  const actor: EntityRef | null = raw.actor_id || raw.actor
    ? { native_id: String(raw.actor_id ?? raw.actor), type: 'User', display: raw.actor ?? null, ...keyed(r.lookup('github', [['actor_id', raw.actor_id], ['actor', raw.actor]], 'GH-U')) }
    : null
  const targets: EntityRef[] = []
  if (raw.user_id || raw.user) targets.push({ native_id: String(raw.user_id ?? raw.user), type: 'User', display: raw.user ?? null, ...keyed(r.lookup('github', [['user_id', raw.user_id], ['user', raw.user]], 'GH-U')) })
  if (raw.repo_id || raw.repo) targets.push({ native_id: String(raw.repo_id ?? raw.repo), type: 'Repository', display: raw.repo ?? null, ...keyed(r.lookup('github', [['repo_id', raw.repo_id], ['repo', raw.repo]], 'GH-REPO')) })
  if (typeof raw.team === 'string' && raw.team) targets.push({ native_id: raw.team, type: 'Team', display: raw.team, object_key: null })
  if (!targets.length && (raw.org_id || raw.org)) targets.push({ native_id: String(raw.org_id ?? raw.org), type: 'Organization', display: raw.org ?? null, ...keyed(r.lookup('github', [['org_id', raw.org_id], ['org', raw.org]], 'GH-ORG')) })
  if (raw.hook_id) targets.push({ native_id: String(raw.hook_id), type: 'Hook', display: null, ...keyed(r.lookup('github', [['hook_id', raw.hook_id]], 'GH-HOOK')) })
  const attributes = shortFields(raw, GITHUB_SKIP)
  putAttr(attributes, 'actor_country', raw.actor_location?.country_code)
  const ts = typeof raw['@timestamp'] === 'number' ? raw['@timestamp'] : typeof raw.created_at === 'number' ? raw.created_at : null
  return {
    origin_key: `github:${raw._document_id}`,
    provider: 'github',
    event_type: action,
    category: githubCategory(action),
    title: localizedTitle('github', action),
    occurred_at: ts === null ? null : new Date(ts).toISOString(),
    outcome: 'unknown',
    outcome_reason: null,
    signal: null,
    actor,
    targets,
    correlation: { session_id: null, transaction_id: null, caused_by: [], client_ip: typeof raw.actor_ip === 'string' ? raw.actor_ip : null },
    attributes,
    ...common(meta),
  }
}

const slackCategory = (action: string): EventCategory => categoryOf('slack:audit', { action })

const SLACK_PREFIX: Record<string, string> = { user: 'SLK-U', channel: 'SLK-CH', workspace: 'SLK-WS', enterprise: 'SLK-ENT', app: 'SLK-APP', usergroup: 'SLK-UG' }

/** Slack Audit Logs (SL-11). entity 하나가 대상이다 */
export function mapSlack(raw: Record<string, any>, meta: RowMeta, r: EntityResolver): NormalizedEvent {
  const action = String(raw.action ?? 'unknown')
  const ref = (at: string, holder: Record<string, any> | undefined): EntityRef | null => {
    const kind = holder?.type
    const o = typeof kind === 'string' ? holder?.[kind] : undefined
    if (!o?.id) return null
    return { native_id: String(o.id), type: kind, display: o.email ?? o.name ?? null, ...keyed(r.lookup('slack', [[`${at}.${kind}.id`, o.id], [`${at}.${kind}.email`, o.email]], SLACK_PREFIX[kind])) }
  }
  const target = ref('entity', raw.entity)
  const ctx = raw.context ?? {}
  const attributes = shortFields(raw.details, new Set())
  putAttr(attributes, 'location_type', ctx.location?.type)
  putAttr(attributes, 'location_id', ctx.location?.id)
  return {
    origin_key: `slack:${raw.id}`,
    provider: 'slack',
    event_type: action,
    category: slackCategory(action),
    title: localizedTitle('slack', action),
    occurred_at: typeof raw.date_create === 'number' ? isoFromEpoch(raw.date_create) : null,
    outcome: 'unknown',
    outcome_reason: null,
    signal: null,
    actor: ref('actor', raw.actor),
    targets: target ? [target] : [],
    correlation: {
      session_id: ctx.session_id === undefined || ctx.session_id === null ? null : String(ctx.session_id),
      transaction_id: null,
      caused_by: [],
      client_ip: typeof ctx.ip_address === 'string' ? ctx.ip_address : null,
    },
    attributes,
    ...common(meta),
  }
}

const salesforceCategory = (action: string, section: string): EventCategory => categoryOf('sfdc:setupaudittrail', { action, section })

/** Salesforce 18자리 id → 그래프 키가 쓰는 15자리 */
const sfId15 = (id: unknown): string | null => (typeof id !== 'string' || !id ? null : id.length === 18 ? id.slice(0, 15) : id)

/** Salesforce 설정 감사 기록 (SF-90). Display 안 사용자 id 와, Action 이 권한 집합·플로인 문장의 Label·고유 이름만 꺼낸다. 이름 일치는 matched_on.identifier 로 드러난다 */
export function mapSalesforce(raw: Record<string, any>, meta: RowMeta, r: EntityResolver): NormalizedEvent {
  const action = String(raw.Action ?? 'unknown')
  const section = typeof raw.Section === 'string' ? raw.Section : ''
  const actorId = sfId15(raw.CreatedById)
  const ms = typeof raw.CreatedDate === 'string' ? Date.parse(raw.CreatedDate) : NaN
  const attributes: Record<string, string | number | boolean> = {}
  putAttr(attributes, 'Section', raw.Section)
  putAttr(attributes, 'DelegateUser', raw.DelegateUser)
  const targets: EntityRef[] = []
  const display = typeof raw.Display === 'string' ? raw.Display : ''

  if (new RegExp(SF_ACTION_PERM_SET_PATTERN).test(action)) {
    const m = display.match(new RegExp(SF_TARGET_PERMISSION_SET_PATTERN))
    if (m) {
      const label = m[1]!
      targets.push({ native_id: label, type: 'PermissionSet', display: label, ...keyed(r.lookup('salesforce', [['Display', label]], 'SF-PS')) })
    }
  } else if (new RegExp(SF_ACTION_FLOW_PATTERN, 'i').test(action)) {
    const m = display.match(new RegExp(SF_TARGET_FLOW_PATTERN))
    if (m) {
      const apiName = m[1]!
      targets.push({ native_id: apiName, type: 'Flow', display: apiName, ...keyed(r.lookup('salesforce', [['Display', apiName]], 'SF-FLOW')) })
    }
  }

  const seenUsers = new Set<string>()
  for (const m of display.match(new RegExp(SF_TARGET_USER_PATTERN, 'g')) ?? []) {
    const id15 = m.slice(0, 15)
    if (seenUsers.has(id15)) continue
    seenUsers.add(id15)
    targets.push({ native_id: id15, type: 'User', display: null, ...keyed(r.lookup('salesforce', [['Display', id15], ['Display', to18(id15)]], 'SF-U')) })
  }
  return {
    origin_key: `salesforce:${raw.Id}`,
    provider: 'salesforce',
    event_type: action,
    category: salesforceCategory(action, section),
    title: localizedTitle('salesforce', action),
    occurred_at: Number.isNaN(ms) ? null : new Date(ms).toISOString(),
    outcome: 'unknown',
    outcome_reason: null,
    signal: null,
    // 손코드 정규화는 15자, 오브젝트 카탈로그 정규화는 18자(Profile_Schema normalization to_18_char) 키를 쓴다. 둘 다 찾는다
    actor: actorId ? { native_id: actorId, type: 'User', display: null, ...keyed(r.lookup('salesforce', [['CreatedById', actorId], ['CreatedById', to18(actorId)]], 'SF-U')) } : null,
    targets,
    correlation: { session_id: null, transaction_id: null, caused_by: [], client_ip: null },
    attributes,
    ...common(meta),
  }
}

/** Jira, Confluence, Guard 가 같은 표를 쓴다 */
const jiraCategory = (category: string, summary: string): EventCategory => categoryOf('jira:audit', { text: `${category} ${summary}`.toLowerCase() })

/** Jira 감사 기록 (JI-90). 작성자는 AT-U, 대상은 사용자(AT-U), 프로젝트(JIRA-P), 프로젝트 역할(JIRA-PR), 그룹(AT-G) 객체에 연결한다 */
export function mapJira(raw: Record<string, any>, meta: RowMeta, r: EntityResolver): NormalizedEvent {
  const summary = String(raw.summary ?? 'unknown')
  const category = String(raw.category ?? '')
  const actorId = raw.authorAccountId ?? raw.authorKey
  const actorStr = actorId ? String(actorId) : null
  // 객체 키는 계정 id 의 ':' 를 '_' 로 바꾼 형태(AT-U-557058_xxx)다
  const userKey = (...ids: Array<readonly [string, unknown]>) =>
    keyed(r.lookup('atlassian', ids.flatMap(([f, v]) => (v ? [[f, String(v)], [f, String(v).replace(/:/g, '_')]] as const : [])), 'AT-U'))
  const actor: EntityRef | null = actorStr
    ? { native_id: actorStr, type: 'User', display: null, ...userKey([raw.authorAccountId ? 'authorAccountId' : 'authorKey', actorStr]) }
    : null

  const targets: EntityRef[] = []
  const seen = new Set<string>()
  const addTarget = (at: string, item: Record<string, any> | null | undefined) => {
    if (!item || !item.typeName) return
    const nativeId = String(item.id ?? item.name ?? '')
    const typeName = String(item.typeName).toUpperCase()
    // 같은 id 를 종류가 다른 대상(PROJECT_ROLE, PROJECT)이 쓸 수 있어 종류까지 넣어 거른다
    const dedup = `${typeName}:${nativeId}`
    if (!nativeId || seen.has(dedup)) return
    seen.add(dedup)
    if (typeName === 'USER') targets.push({ native_id: nativeId, type: 'User', display: item.name ?? null, ...userKey([`${at}.id`, item.id], [`${at}.name`, item.name]) })
    else if (typeName === 'PROJECT') targets.push({ native_id: nativeId, type: 'Project', display: item.name ?? null, ...keyed(r.lookup('atlassian', [[`${at}.id`, item.id]], 'JIRA-P')) })
    else if (typeName === 'PROJECT_ROLE') targets.push({ native_id: nativeId, type: 'ProjectRole', display: item.name ?? null, ...keyed(r.lookup('atlassian', [[`${at}.id`, item.id]], 'JIRA-PR')) })
    else if (typeName === 'GROUP') targets.push({ native_id: nativeId, type: 'Group', display: item.name ?? null, ...keyed(r.lookup('atlassian', [[`${at}.id`, item.id], [`${at}.name`, item.name]], 'AT-G')) })
    else targets.push({ native_id: nativeId, type: String(item.typeName), display: item.name ?? null, object_key: null })
  }
  addTarget('objectItem', raw.objectItem)
  for (const item of (raw.associatedItems ?? [])) addTarget('associatedItems[]', item)

  const attributes: Record<string, string | number | boolean> = {}
  putAttr(attributes, 'category', raw.category)
  putAttr(attributes, 'object_name', raw.objectItem?.name)
  putAttr(attributes, 'object_type', raw.objectItem?.typeName)
  if (Array.isArray(raw.changedValues)) {
    for (const cv of raw.changedValues) {
      if (cv?.fieldName && (cv.changedTo !== undefined || cv.changedFrom !== undefined)) putAttr(attributes, `changed_${cv.fieldName}`, `${cv.changedFrom ?? ''} -> ${cv.changedTo ?? ''}`)
      if (typeof cv?.fieldName === 'string' && cv.fieldName.toLowerCase() === 'users') {
        const parseUsers = (v: unknown): string[] =>
          typeof v === 'string'
            ? v.split(',').map(s => s.trim()).filter(s => /^\d+:[0-9a-f-]{36}$/.test(s))
            : []
        const fromUsers = parseUsers(cv.changedFrom)
        const toUsers = parseUsers(cv.changedTo)
        const fromSet = new Set(fromUsers)
        const toSet = new Set(toUsers)
        for (const u of toUsers) {
          if (!fromSet.has(u)) {
            const dedup = `USER:${u}`
            if (!seen.has(dedup)) {
              seen.add(dedup)
              targets.push({ native_id: u, type: 'User', display: null, ...userKey(['changedValues[Users].changedTo', u]) })
            }
          }
        }
        for (const u of fromUsers) {
          if (!toSet.has(u)) {
            const dedup = `USER:${u}`
            if (!seen.has(dedup)) {
              seen.add(dedup)
              targets.push({ native_id: u, type: 'User', display: null, ...userKey(['changedValues[Users].changedFrom', u]) })
            }
          }
        }
      }
    }
  }

  const ms = typeof raw.created === 'string' ? Date.parse(raw.created) : NaN
  return {
    origin_key: `jira:${raw.id}`,
    provider: 'atlassian',
    event_type: summary,
    category: jiraCategory(category, summary),
    title: localizedTitle('atlassian', summary),
    occurred_at: Number.isNaN(ms) ? null : new Date(ms).toISOString(),
    outcome: 'unknown',
    outcome_reason: null,
    signal: null,
    actor,
    targets,
    correlation: { session_id: null, transaction_id: null, caused_by: [], client_ip: typeof raw.remoteAddress === 'string' ? raw.remoteAddress : null },
    attributes,
    ...common(meta),
  }
}

const CF_UUID_PAT = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const CF_GROUP_NAME_UUID = new RegExp(`^(.+):(${CF_UUID_PAT})$`)
const CF_GROUP_USER = new RegExp(`^(${CF_UUID_PAT}); User: (\\S+)$`)

/** Confluence 제품 REST 감사 기록(CF-90). 대상 그룹 안의 UUID와 사용자 계정 id만 그래프 객체로 연결한다 */
export function mapConfluence(raw: Record<string, any>, meta: RowMeta, r: EntityResolver): NormalizedEvent {
  const accountId = typeof raw.author?.accountId === 'string' ? raw.author.accountId : null
  const actor: EntityRef | null = accountId ? {
    native_id: accountId, type: 'User', display: raw.author?.displayName ?? null,
    ...keyed(r.lookup('atlassian', [['author.accountId', accountId], ['author.accountId', accountId.replace(/:/g, '_')]], 'AT-U')),
  } : null
  const targets: EntityRef[] = []
  const seen = new Set<string>()
  const items: Array<readonly [Record<string, any> | undefined, string]> = [
    [raw.affectedObject, 'affectedObject.name'],
    ...((Array.isArray(raw.associatedObjects) ? raw.associatedObjects : []).map(o => [o, 'associatedObjects[].name'] as const)),
  ]
  for (const [item, at] of items) {
    if (!item || typeof item.name !== 'string' || !item.name || typeof item.objectType !== 'string') continue
    const key = `${item.objectType}:${item.name}`
    if (seen.has(key)) continue
    seen.add(key)
    if (item.objectType.toUpperCase() === 'GROUP') {
      const mUser = item.name.match(CF_GROUP_USER)
      if (mUser) {
        const uuid = mUser[1]!
        const userId = mUser[2]!
        targets.push({
          native_id: item.name,
          type: item.objectType,
          display: item.name,
          ...keyed(r.lookup('atlassian', [[at, uuid]], 'AT-G')),
        })
        const userKey = `USER:${userId}`
        if (!seen.has(userKey)) {
          seen.add(userKey)
          targets.push({
            native_id: userId,
            type: 'User',
            display: null,
            ...keyed(r.lookup('atlassian', [[at, userId], [at, userId.replace(/:/g, '_')]], 'AT-U')),
          })
        }
        continue
      }
      const mName = item.name.match(CF_GROUP_NAME_UUID)
      if (mName) {
        const uuid = mName[2]!
        targets.push({
          native_id: item.name,
          type: item.objectType,
          display: item.name,
          ...keyed(r.lookup('atlassian', [[at, uuid]], 'AT-G')),
        })
        continue
      }
    }
    targets.push({ native_id: item.name, type: item.objectType, display: item.name, object_key: null, ...(r.hasObjects ? { unmatched: 'name_only' } : {}) })
  }
  const attributes: Record<string, string | number | boolean> = {}
  putAttr(attributes, 'product', 'confluence')
  putAttr(attributes, 'category', raw.category)
  putAttr(attributes, 'object_name', raw.affectedObject?.name)
  putAttr(attributes, 'object_type', raw.affectedObject?.objectType)
  // changedValues 에는 비밀값과 hidden 값이 섞일 수 있어 통째로 옮기지 않는다.
  return {
    origin_key: `confluence:${meta.tenant}:${confluenceId(raw)}`,
    provider: 'atlassian', event_type: raw.summary,
    category: jiraCategory(String(raw.category ?? ''), raw.summary),
    title: localizedTitle('atlassian', raw.summary),
    occurred_at: isoFromEpoch(confluenceTime(raw)),
    outcome: 'unknown', outcome_reason: null, signal: null, actor, targets,
    correlation: { session_id: null, transaction_id: null, caused_by: [], client_ip: typeof raw.remoteAddress === 'string' ? raw.remoteAddress : null },
    attributes, ...common(meta),
  }
}

/** Guard 조직 감사 웹훅의 data[] 봉투. 제품 REST와 별도 sourcetype으로만 받는다. */
function guardRecords(raw: unknown): Array<Record<string, any>> | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).data)) return null
  const records = (raw as any).data
  return records.every((e: any) => e?.type === 'events' && typeof e.id === 'string' && !!e.id
    && typeof e.attributes?.action === 'string' && !!e.attributes.action
    && typeof e.attributes?.time === 'string' && Number.isFinite(Date.parse(e.attributes.time))) ? records : null
}

export function mapAtlassianGuard(raw: Record<string, any>, meta: RowMeta, r: EntityResolver): NormalizedEvent {
  const a = raw.attributes
  const actorId = typeof a.actor?.id === 'string' && a.actor.id ? a.actor.id : null
  const action = a.action as string
  const attributes: Record<string, string | number | boolean> = {}
  if (action.startsWith('confluence_')) putAttr(attributes, 'product', 'confluence')
  else if (action.startsWith('jira_')) putAttr(attributes, 'product', 'jira')
  return {
    origin_key: `atlassian-guard:${meta.tenant}:${raw.id}`,
    provider: 'atlassian', event_type: action, category: jiraCategory('', action),
    title: localizedTitle('atlassian', action), occurred_at: new Date(a.time).toISOString(),
    outcome: 'unknown', outcome_reason: null, signal: null,
    actor: actorId ? { native_id: actorId, type: 'User', display: typeof a.actor.name === 'string' ? a.actor.name : null,
      ...keyed(r.lookup('atlassian', [['attributes.actor.id', actorId], ['attributes.actor.id', actorId.replace(/:/g, '_')]], 'AT-U')) } : null,
    // container 는 이벤트 범위이며 context 는 여러 종류를 담는다. 대상 ID 의미를 확인하기 전에는 추정하지 않는다.
    targets: [],
    correlation: { session_id: null, transaction_id: null, caused_by: [], client_ip: typeof a.location?.ip === 'string' ? a.location.ip : null },
    attributes, ...common(meta),
  }
}

/** Splunk 결과 한 줄 → 정규 이벤트 (원문이 JSON 이 아니면 버리고 사유를 돌려준다) */
export function mapRow(row: Record<string, string>, meta: Omit<RowMeta, 'indextime'>, r: EntityResolver): { events: NormalizedEvent[]; error?: string } {
  const provider = SOURCETYPE_PROVIDER[meta.sourcetype]
  if (!provider) return { events: [], error: `모르는 sourcetype ${meta.sourcetype}` }
  let raw: Record<string, any>
  try { raw = JSON.parse(row._raw) } catch { return { events: [], error: '원문이 JSON 이 아니다' } }
  if (meta.sourcetype === 'confluence:audit' && !isConfluenceAudit(raw)) return { events: [], error: 'Confluence REST 감사 기록 형식이 아니다' }
  const guard = meta.sourcetype === 'atlassian:guard:audit' ? guardRecords(raw) : null
  if (meta.sourcetype === 'atlassian:guard:audit' && guard === null) return { events: [], error: 'Atlassian Guard 감사 봉투 형식이 아니다' }
  const indextime = row.aegi_indextime ? Number(row.aegi_indextime) : null
  const full: RowMeta = { ...meta, indextime }
  const hash = sha256(row._raw)
  const events = guard !== null ? guard.map(e => mapAtlassianGuard(e, full, r))
    : provider === 'okta' ? [mapOkta(raw, full, r)]
    : provider === 'gws' ? mapGws(raw, full, r)
    : provider === 'github' ? [mapGithub(raw, full, r)]
    : provider === 'slack' ? [mapSlack(raw, full, r)]
    : provider === 'salesforce' ? [mapSalesforce(raw, full, r)]
    : meta.sourcetype === 'confluence:audit' ? [mapConfluence(raw, full, r)]
    : [mapJira(raw, full, r)]
  for (const e of events) {
    e.raw_sha256 = hash
    const relationMatches = r.relationMatches(e)
    if (relationMatches) e.relation_matches = relationMatches
    if (r.snapshot) e.matched_snapshot = r.snapshot
  }
  return { events }
}
