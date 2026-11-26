/** Splunk 이벤트 파이프라인 공통 타입 (docs/SPLUNK_TIMELINE_PLAN.md 3절) */

export type EventProvider = 'okta' | 'gws' | 'github' | 'slack' | 'salesforce' | 'atlassian'

/** 승인된 index → 그 index 에서 검색할 수 있는 sourcetype */
export type Approved = Record<string, string[]>

export const APPROVED: Approved = {
  aegi_okta: ['okta:im2:log'],
  aegi_gws: ['gws:reports:activity'],
  aegi_github: ['github:cloud:audit'],
  aegi_slack: ['slack:audit'],
  aegi_salesforce: ['sfdc:setupaudittrail'],
  aegi_atlassian: ['jira:audit', 'confluence:audit', 'atlassian:guard:audit'],
}

export const SOURCETYPE_PROVIDER: Record<string, EventProvider> = {
  'okta:im2:log': 'okta',
  'gws:reports:activity': 'gws',
  'github:cloud:audit': 'github',
  'slack:audit': 'slack',
  'sfdc:setupaudittrail': 'salesforce',
  'jira:audit': 'atlassian',
  'confluence:audit': 'atlassian',
  'atlassian:guard:audit': 'atlassian',
}

export interface SplunkConnection {
  /** 검색 REST 주소 (https://host:8089) */
  searchBase: string
  /** 검색 전용 계정의 토큰 */
  token: string
  /** HEC 주소 (https://host:8088). ship 에만 필요 */
  hecBase?: string
  hecToken?: string
  /** 서버 인증서 SHA-256 지문. 자체 서명 인증서라 지문으로 고정한다 */
  tlsSha256?: string
  approved: Approved
  /** index → 원본 tenant (origin_key 에 넣는다) */
  tenants: Record<string, string>
}

/**
 * 객체 키를 찾은 근거. 무엇과 무엇이 같았는지만 적고 점수를 매기지 않는다
 * (aegi-knowledge Link_Schema_v3 「숫자 신뢰도를 쓰지 않는다」, 비교 방법은 crosswalk.yaml same).
 */
export interface MatchedOn {
  /** 원본 이벤트의 칸. 예: target[].id, repo, CreatedById */
  event_field: string
  /** 객체 쪽 칸. canonical.identifiers 의 이름이거나, 옛 키 `<접두사>-<값>` 이 그대로 있으면 object_key */
  identifier: string
  same: 'exact' | 'casefold'
}

export type Unmatched = 'not_in_graph' | 'ambiguous' | 'name_only'

export interface EntityRef {
  native_id: string
  type: string
  display: string | null
  /** 그래프 객체 키. 식별자로 찾지 못하면 null */
  object_key: string | null
  /** object_key 를 찾은 근거. 못 찾았으면 없다 */
  matched_on?: MatchedOn
  /** object_key 가 없을 때 못 찾은 이유 */
  unmatched?: Unmatched
}

/** 그래프 관계 한 줄. graph-index 가 snap_relations 에서 읽는다 */
export interface GraphRelationRef {
  id: string
  type: string
  from: string
  to: string
  /** 3항 관계의 role. 객체 키이거나 문자열 역할 이름(name:…)이다 */
  role?: string | null
}

/** 이벤트의 칸: 행위자, 또는 targets 의 몇 번째 */
export type EventSlot = 'actor' | { target: number }

/**
 * 이벤트에서 찾은 객체 둘이 그래프 관계 하나의 출발과 도착과 같았다는 사실.
 * 이벤트가 그 관계를 만들거나 썼다는 뜻이 아니다. 판단은 읽는 쪽이 한다
 * (aegi-knowledge Splunk_Normalized_Event_Contract_v1 「감사 이벤트는 Object 나 Relation 이 아니다」).
 */
export interface RelationMatch {
  relation_id: string
  relation_type: string
  source: EventSlot
  target: EventSlot
  /** 관계의 role 객체도 이벤트에 있었으면 그 칸 */
  role?: EventSlot
}

export type EventCategory = 'auth' | 'admin' | 'membership' | 'policy' | 'token' | 'data' | 'mail' | 'other'

export interface EventSignal {
  kind: 'suspicious'
  source: string
  value: string | boolean | number
}

export interface NormalizedEvent {
  origin_key: string
  provider: EventProvider
  event_type: string
  category: EventCategory
  title: string
  occurred_at: string | null
  indexed_at: string | null
  received_at: string
  outcome: 'success' | 'failure' | 'unknown'
  outcome_reason: string | null
  signal: EventSignal | null
  actor: EntityRef | null
  targets: EntityRef[]
  correlation: {
    session_id: string | null
    transaction_id: string | null
    /** 원본이 원인으로 명시한 객체 (Okta triggeredByGroupRuleId 등) */
    caused_by: EntityRef[]
    client_ip: string | null
  }
  /** 허용한 짧은 필드만. 원문 전체를 싣지 않는다 */
  attributes: Record<string, string | number | boolean>
  transport_ref: { index: string; sourcetype: string; sid: string; offset: number }
  /**
   * 행위자, 대상이 같았던 그래프 관계. 그래프 관계를 받지 못했으면 없고, 받았는데 맞는 것이 없으면 빈 배열이다.
   * 맞는 것이 없다는 것은 관계가 없다는 뜻이 아니다.
   */
  relation_matches?: RelationMatch[]
  /** 객체와 관계를 대조한 그래프 스냅샷과 그 데이터셋을 만든 시각 */
  matched_snapshot?: { id: string; collected_at: string | null }
  mapping_version: string
  /** 원문 해시. 같은 origin_key 에 내용이 다르면 충돌로 기록한다 */
  raw_sha256: string
}

export interface SearchRecord {
  index: string
  sourcetype: string
  sid: string | null
  window: { index_earliest: number; index_latest: number }
  state: string
  trail: string[]
  result_count: number
  fetched: number
  messages: string[]
  at: string
}

export interface EventFile {
  version: 1
  generated_at: string
  /** `${index}|${sourcetype}` → 완료 색인 시각(초) */
  cursors: Record<string, number>
  searches: SearchRecord[]
  events: NormalizedEvent[]
  conflicts: Array<{ origin_key: string; kept: string; incoming: string; at: string }>
  unresolved: number
  /** 변환하지 못한 행. 원문은 두지 않고 다시 찾을 단서만 둔다. 같은 원문을 나중에 변환하면 지운다 (ingest) */
  rejected?: RejectedRow[]
}

export interface RejectedRow {
  index: string
  sourcetype: string
  raw_sha256: string
  /** Splunk 색인 시각(초). 없으면 null, 그때는 window.index_earliest 부터 다시 받는다 */
  indextime: number | null
  window: { index_earliest: number; index_latest: number }
  reason: string
  first_seen: string
  last_seen: string
  seen: number
}

/** 4: Okta 세션 id 가 'unknown' 이면 null (mapper oktaKnown). 같은 원문은 더 높은 판으로 다시 매핑된다 (ingest) */
export const MAPPING_VERSION = 'splunk-map/4'
