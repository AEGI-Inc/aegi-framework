/**
 * Effective Access 행 (aegi-schema `docs/Effective_Access_Schema_v1.md` 초안, 대시보드 적용안
 * `docs/spec/AEGI_EFFECTIVE_ACCESS_DASHBOARD_PLAN_V1.md` §2).
 *
 * 관계·Link 와 다른 저장소다. 탐지 룰이 물은 쌍만 들어 있고, 여기 없다고 접근이 없다는 뜻이 아니다.
 * 규격에 없는 칸은 `x_` 접두사로 적는다.
 */
import type { IdentityLink } from '../../../model/link'
import type { RelationType } from '../../../model/relation'

export type EaLevel = 'computed' | 'computed_cross' | 'indeterminate' | 'denied'

/** runs_as_inherits 만 규격 규칙이다. x_ 넷은 대시보드 로컬 규칙 (적용안 §3, x_dynamic_holder 는 오브젝트 모델 v2 V2-OPEN-15) */
export type EaRuleId = 'runs_as_inherits' | 'x_member_grant' | 'x_dynamic_holder' | 'x_acts_as_inherits' | 'x_token_inherits'

export interface EaRelationVia {
  kind: 'relation'
  /** relation fixture_key */
  ref: string
  relation_type: RelationType
  source: string
  target: string
  /** has_role_on 역할 자리 (객체 키 또는 이름) */
  role?: string
  basis: 'stated' | 'computed' | 'flag'
  /** 두 끝의 provider 가 다른 관계 (Relation_Schema_v3 교차 stated) */
  x_cross_provider?: true
}

/** Link 집합 안의 간선 하나. 실측 v2 는 meta.edges 의 간선, 간선이 없는 링크(v1·합성)는 두 계정을 잇는 집합 자체 */
export interface EaLinkVia {
  kind: 'link'
  /** link_id */
  ref: string
  a: string
  b: string
  level: IdentityLink['level']
  rule: string
}

export type EaVia = EaRelationVia | EaLinkVia

/** 넓은 홉을 끊으면 누가 같이 잃는지가 조치하는 사람에게 읽혀야 한다 (EA 규격 「어느 홉을 cut 에 넣나」) */
export type EaAffects = 'source_only' | 'group' | 'all_callers'

export interface EaCut {
  /** via[] 인덱스. cut ⊆ via */
  via: number
  x_scope: { affects: EaAffects; count?: number; note: string }
}

export type EaComputationReason =
  /** 멤버십을 끊으면 막히는지(집행되는지) 확인하지 못했다 */
  | 'enforcement_unknown'
  /** 공개 채널이라 멤버십을 끊어도 다시 들어오거나 읽을 수 있다 */
  | 'public_channel'
  /** 채널의 공개 여부를 모른다 */
  | 'channel_visibility_unknown'
  /** 실행 신원을 벤더가 합쳐 준다(runs_as 가 basis stated 가 아니거나 decomposable false). 엔진 aegi-adapter-engine effectiveAccess/types.ts 와 같다 */
  | 'runs_as_computed'
  /** Okta 역할이 리소스 세트에 걸려 있는데 세트를 펴지 않았다. 엔진과 같다 */
  | 'resource_set_not_expanded'
  /** 봇이 호출자를 어떻게 거르는지 저장된 사실이 없다 */
  | 'invoker_gate_not_stored'
  /** 스크립트와 웹훅이 관계가 아니라 URL 지문(속성·시각 대조)으로만 이어진다 */
  | 'script_webhook_by_url_fingerprint'
  /** 권한 줄의 보유자가 이슈마다(보고자, 담당자, 사용자 지정 필드) 또는 수집하지 않은 제품 접근으로 정해진다 */
  | 'dynamic_holder_unresolved'
  /** 자동화끼리의 동일인 간선이 약하다(possibly_same 등). 엔진 aegi-adapter-engine effectiveAccess/types.ts 와 같다 */
  | 'identity_link_weak'
  /** 사람 계정끼리의 동일인 간선이 약하다(이메일 일치 등). 엔진과 같다 */
  | 'identity_weak'

export type EaUndecomposed =
  /** 관계 행의 undecomposed 를 물려받았다 — 벤더가 못 가른다 */
  | { at: `via[${number}]`; from: 'relation'; vendor_paths: string[] }
  /** 우리가 못 풀었다 */
  | { at: `via[${number}]`; from: 'computation'; reason: EaComputationReason }
  /** 저장되지 않은 홉. x_between 은 앞뒤 via 인덱스 (적용안 §10-2) */
  | { at: 'x_gap'; x_between: [number, number]; from: 'computation'; reason: EaComputationReason }

export interface EffectiveAccessRow {
  /** 동일성 키 (source, target, rule, via ref 순서열) 의 해시 */
  id: string
  /** 어휘 미정 (EA 규격 「어휘를 이번 판에서 만들지 않는다」) */
  effect: null
  effect_query: string
  references: { source: string; target: string }
  level: EaLevel
  via: EaVia[]
  cut: EaCut[]
  undecomposed: EaUndecomposed[]
  stale_at?: string
  source: { rule: EaRuleId; view_version: number; computed_at: string; inputs_view_version: number }
  /** 어느 탐지 룰의 어느 판정 근거가 물었나 — 「물어본 쌍만」 */
  x_asked_by: { rule_id: string; check_id?: string }
  /**
   * x_dynamic_holder: 관계가 아니라 권한 줄(배정 레코드)과 객체 참조로 정해지는 보유자.
   * via 는 스킴 → 프로젝트 applies_to 이고, 보유자가 이 주체가 되는 근거는 여기 적는다
   */
  x_holders?: Array<{ type: string; grant: string; permission: string; evidence: string }>
}

export interface EffectiveAccessFile {
  format: 'aegi-effective-access/v1'
  schema: 'Effective_Access_Schema_v1'
  /** 이 규칙 판 */
  view_version: number
  /** 입력 Link 의 view_version */
  inputs_view_version: number
  /** 입력 데이터셋 스냅샷 시각 (manifest.created_at). 다시 생성해도 파일이 바뀌지 않게 계산한 시각이 아니라 입력 시각을 쓴다 */
  computed_at: string
  /** 규칙마다 첫 홉 입력 수. 0 이면 「행 없음」이 「접근 없음」이 아니라 「입력 없음」이다 */
  x_rule_inputs: Record<EaRuleId, number>
  rows: EffectiveAccessRow[]
}
