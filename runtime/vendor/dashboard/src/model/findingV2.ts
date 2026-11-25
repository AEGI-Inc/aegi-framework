import type { Provider } from './object'
import type { ThreatTypeName } from '../ontology/generated'
import type { RemediationAction } from '../domain/remediation'
import type { ThreatSpreadResult } from '../findings/threatSpread'

export interface FindingRemediationItem {
  id: string
  title: string
  description: string
  completed?: boolean
  /** 조치 상세. 게시 때 엔진이 조치 틀(aegi-adapter-engine display-text/remediations)을 이 위협의 객체로 채워 싣는다 */
  guide?: RemediationAction
}

export interface FindingControlItem {
  id: string
  title: string
  description: string
}

/**
 * 탐지 규칙이 실제로 확인한 조건 하나.
 *
 * 규칙 코드는 이미 조건을 하나씩 따져서 Finding을 낼지 말지 정하는데,
 * 그 중간 결과가 화면으로 나오지 않아 담당자는 "왜 이게 떴는지"를
 * 설명 문장으로만 봐야 했다. 규칙이 본 것을 그대로 올린다.
 *
 * state
 * - confirmed: 규칙이 값을 확인했고, 그 판단이 기대는 동일인 연결도 강하다
 *   (벤더가 준 연결·결정적 규칙·사람이 쓴 표 — Link_Schema_v3 disclosed_relation·resolved)
 * - inferred: 값은 있지만 판단이 약한 동일인 연결(이메일 일치·로그 상관 등 — possibly_same·candidate·inferred)이나
 *   연결 기록이 없다는 사실에 기댄다. 틀릴 수 있어 확인과 따로 보여 준다 (XST Judgement.md 「추정」)
 * - unknown: 확인에 필요한 데이터가 아예 없다
 * 지어내지 않는다.
 */
export interface FindingCheck {
  id: string
  label: string
  state: 'confirmed' | 'inferred' | 'unknown'
  /** 판정 근거 표의 행. route 권한을 얻는 경로, level 얻는 권한 수준, unknown 미수집, inferred 추정 */
  group: 'route' | 'level' | 'unknown' | 'inferred'
  detail: string
}

/**
 * 규칙이 판정한 위반 대상 한 명 — 보안 담당자가 예외 처리하는 기본 단위다.
 *
 * `affectedIdentityKeys`(영향 대상)와 다를 수 있다. 공유 자격증명 위협의 영향 대상에는
 * 자격증명 소유자도 들어가지만, 위반 대상은 소유자가 아닌 요청자뿐이다.
 */
export interface FindingSubject {
  /** identityKey(cluster) — Identity Link 가 있으면 링크 ID, 없으면 계정 키 */
  key: string
  label: string
  /** 이 사람이 왜 위반 대상인가 (예: '격차 인원', '소유자가 아닌 요청자') */
  role: string
  /** 이 사람의 계정 키 전부. 예외가 링크 ID 변화에도 이어지도록 쓴다 */
  accountKeys: string[]
  /** 이 사람과 이어진 증적. '이번 발생' 예외를 판정할 때 쓴다 */
  observationIds: string[]
  /** 이 사람이 직접 관련된 실행·전달 기록이 있는가. 없으면 노출 가능성만 있는 대상이다 */
  activity: boolean
  /** 이 사람을 위반 대상으로 본 신원 판단의 세기 */
  basis: 'confirmed' | 'inferred'
}

/** 위협 판정 V2 간선 종류. 직접 3종(소속, 범위, 권한)과 파생 6종 */
export type ThreatHopKindV2 = '소속' | '범위' | '권한' | '호출' | '실행 신원' | '데이터 흐름' | '효과' | '조건' | '자격 보관'
/** 위협 유형 이름(aegi-knowledge threat_types.yaml, 생성 코드 THREAT_TYPES) */
export type ThreatTypeNameV2 = ThreatTypeName

export interface ThreatPathV2 {
  point: string
  target: string
  hops: { kind: ThreatHopKindV2; from: string; to: string }[]
}

/** 위협 판정 V2 화면 인원(엔진 계약 headcount, 2026-11-20 결정). 누구나를 뺀 서로 다른 사람 수와 누구나 여부 */
export interface ThreatHeadcountV2 {
  people: number
  everyone: boolean
}

export interface ThreatSubjectV2 {
  /** 사람 링크 id 또는 계정 키. 누구나는 '@everyone', 조직 밖 주소는 'outside:주소' */
  person: string
  types: ThreatTypeNameV2[]
  certainty: '확정' | '미확정'
  /** 확정 사람이어도 미확정 경로에서만 나온 유형(types 에도 들어 있음) */
  unconfirmedTypes?: ThreatTypeNameV2[]
  /** 새로 얻은 수준(엔진 contract.ts, 2026-11-19). 유형 이름이 읽기와 쓰기를 담지 않아 화면은 이 값으로 가른다. 이 값이 없는 옛 스냅샷은 비어 있다 */
  levels?: AccessLevelV2[]
  /** 확정 사람이어도 미확정 판정 줄에서만 얻은 수준(엔진 contract.ts, 2026-11-19). 「아래 내용 읽기」는 읽기 */
  unconfirmedLevels?: AccessLevelV2[]
  /** 조직 밖 사람이거나 조직 경계 모름. 데이터 반출을 받는 사람이라도 조직 안이면 false(엔진, 2026-11-19) */
  outside: boolean
  /** 이 사람이 point 에 닿는 간선 종류. 없으면 직접 공유 */
  entry?: ThreatHopKindV2
}

export type AccessLevelV2 = '읽기' | '쓰기' | '관리'

/** Access Gap 벤의 사람 한 명(엔진 src/detection/threat/threatGap.ts) */
export interface ThreatGapPersonV2 {
  /** 사람 링크 id 또는 계정 키 */
  person: string
  direct: AccessLevelV2 | null
  derived: AccessLevelV2 | null
  /** 직접 권한보다 높아진 수준(새로 생긴 권한) */
  gained: AccessLevelV2[]
  certainty?: '확정' | '미확정'
  /** 확정 사람이어도 미확정 판정 줄에서만 얻은 수준(gained 에도 들어 있음, 엔진 threatGap.ts, 2026-11-19) */
  unconfirmedGained?: AccessLevelV2[]
  /** 새로 생긴 권한이 있지만 수에서 뺀 이유 */
  excluded?: '관리자' | '승인됨'
  /** 직접 수준이 누구나 공유에서만 와서 직접 권한 원 밖. 벤에서 파생 접근 원에만 둔다 */
  publicOnly?: true
  /** 조직 밖 사람의 직접 공유 수준(엔진 share, 2026-11-18). 승인 범위 밖은 기준선 밖이라 새로 생긴 권한 */
  share?: AccessLevelV2
  /** 대상에 직접 권한을 받은 이 사람의 계정 키(엔진 directAccounts, 2026-11-20). 대표 계정이 아니라 실제로 받은 계정 */
  directAccounts?: string[]
  /** 이 연동 지점으로 대상에 닿기 시작한 이 사람의 계정 키(엔진 derivedAccounts, 2026-11-20) */
  derivedAccounts?: string[]
}

/**
 * Access Gap 벤(엔진 계약 accessGap). 위협 하나에 하나. 비인가 접근, 권한 상승, 데이터 반출(조직 밖 직접 공유 포함) 위협만.
 * 권한 없는 접근자(unauthorized): 새로 생긴 권한이 있고 직접 권한이 없는 사람. 권한 초과 접근자(excess): 직접 권한이 있는 사람
 */
export interface ThreatAccessGapV2 {
  directCount: number
  derivedCount: number
  unauthorized: number
  excess: number
  /** 파생 접근 원 사람 전부와 직접 권한만 있는 사람 앞쪽 일부 */
  people: ThreatGapPersonV2[]
}

export interface FindingV2 {
  id: string // 위협 판정 V2 는 "FND-THR-<지문 앞 8자리>"
  /** 범용 판정의 정책 */
  policy?: string
  ruleId: string // 위협 판정 V2 는 "threat-v2"
  /** 위협 판정 V2 대표 유형과 붙은 유형 전부(findings/threatV2.ts) */
  primaryType?: ThreatTypeNameV2
  types?: string[]
  /** 위협 판정 V2 발생 가능, 발생 */
  occurrence?: '발생 가능' | '발생'
  /** 위협 판정 V2 확정, 미확정 */
  threatCertainty?: '확정' | '미확정'
  /** 위협 판정 V2 경로. 엔진 계약의 point, target, path.hops 그대로(가상 노드 키 mail:, outside:, attr: 포함) */
  threatPath?: ThreatPathV2
  /** 위협 판정 V2 대상 전부(엔진 계약 targets). target 이 폴더면 그 아래 객체들이다 */
  threatTargets?: string[]
  /** 위협 판정 V2 사람. 새로 권한이 생기는 사람(엔진 계약 subjects) */
  threatSubjects?: ThreatSubjectV2[]
  /** 위협 판정 V2 화면 인원(엔진 계약 headcount, 2026-11-20). 옛 게시 행과 추적성 상실에는 없다 */
  threatHeadcount?: ThreatHeadcountV2
  /** 위협 판정 V2 차단 지점(엔진 계약 cuts). 다시 판정으로 해결을 확인한 것이 앞, 순서와 번호는 권장 조치와 같다 */
  threatCuts?: ThreatCutView[]
  /** 위협 판정 V2 요약 문장의 조각. 위협 상세 제목 아래 문장에서 이름을 굵게, 유형을 배지로 보인다. 추적성 상실은 없다 */
  threatHeadline?: { people: number; count: string; point: string; target: string; types: string[] }
  /** 위협 판정 V2 Access Gap 벤(엔진 계약 accessGap). Access Gaps 화면이 쓴다 */
  threatAccessGap?: ThreatAccessGapV2

  title: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  status: 'open' | 'resolved' | 'accepted'

  summary: string
  impact: string
  whatHappened?: string
  whyDetected?: string

  involvedObjectKeys: string[]
  involvedRelationKeys: string[]
  involvedLinkIds: string[]
  evidenceObservationIds: string[]
  evidenceLinkIds: string[]

  affectedIdentityKeys: string[]
  providerSet: Provider[]

  /** 규칙이 확인한 조건들. 규칙이 값을 채워 넣는다. */
  checks?: FindingCheck[]

  /**
   * 구성 지문: 위협 판정 V2 는 시작 객체와 위협 대상에서 만든 값. 예외는 이 지문에 묶어,
   * 대상이 바뀐 다른 상황까지 가리지 않게 한다.
   */
  fingerprint?: string
  /** 규칙이 판정한 위반 대상 (예외 처리 단위) */
  subjects?: FindingSubject[]

  remediation: FindingRemediationItem[]
  controls: FindingControlItem[]

  /** 위협 확산 범위. 게시 때 엔진이 계산해 싣는다(findings/threatSpread.ts). 칸이 없으면 화면이 계산한다. null 은 출발 객체가 없어 계산하지 못한 것 */
  spread?: ThreatSpreadResult | null

  meta?: Record<string, unknown>
}

/**
 * 위협 판정 V2 차단 지점 한 개. 엔진이 지운 그래프를 다시 판정해 닫힌 사람 수(closes)를 센다.
 * with 가 있으면 함께 끊어야 닫히는 조합이고, 다 안 닫히면 남은 사람이 닿는 다른 연동 지점(remainVia)이 있다
 */
export interface ThreatCutView {
  at: { kind: string; from: string; to: string }
  with?: { kind: string; from: string; to: string }[]
  verified: boolean
  /** 엔진이 센 차단 가능 인원. 옛 게시 행(11-12 이전 엔진)에는 없다 */
  closes?: number
  of: number
  /** 차단 인원과 위협 인원 글자(엔진 closed, headcount). 「8명과 누구나」. 옛 게시 행에는 없다 */
  closedText?: string
  ofText?: string
  title: string
  /** 조치 이름(권한 축소 등), 조치할 곳, 그 범위. 차단 지점 표에서 칸으로 나눠 보인다 */
  action?: string
  target?: string
  scope?: string
  withTitles?: string[]
  remainVia?: string[]
  /** 같은 조치로 함께 막히는 다른 위협 수 */
  alsoCloses?: number
}
