/**
 * 범용 접근 엔진 (Effective Access · 권한 차집합) — 타입.
 *
 * 설계·검증 절차: docs/spec/AEGI_GENERIC_ACCESS_ENGINE_V1.md
 *
 * 저장된 사실(관계·Link·증거 링크·관측·참조)을 간선 7종으로 옮기고, 같은 범용 규칙을
 * 원래 간선(M·U·G)만으로 한 번, 연동 간선(T·A·F·E)까지 넣어 한 번 풀어 두 결과의 차를 낸다.
 * 답은 3값(yes · unknown · no)이고, 답마다 근거 경로(witness)를 든다.
 */
import * as onto from '../../../ontology/generated'


/**
 * 간선 종류
 * - M 소속: 주체 → 그룹·테넌트 (그룹의 권한이 멤버에게 간다)
 * - U 범위: 자원 → 상위 자원 (상위의 권한이 내려온다 — 모델이 허락할 때만)
 * - G 권한: 주체 → 자원, 능력 순위(rank)
 * - T 호출·입력: 주체·자원 → 자동화 (누가 자동화를 돌리거나 입력을 넣나)
 * - A 대행: 자동화 → 실행 신원 (자동화가 누구의 권한으로 도나)
 * - F 사본: 자원·자동화 → 자원·자동화 (데이터가 어디로 옮겨지나)
 * - E 효과: 자동화 → 객체 (자동화가 실제로 바꾼 것 — 관측)
 * 종류 목록은 개념 사전(effects.yaml)에서 생성한 src/ontology/generated.ts 에서 온다.
 */
export type EdgeKind = onto.EdgeKind

/** 원래 권한을 이루는 간선. 연동 간선(T·A·F·E)은 원래 집합 계산에 절대 들어가지 않는다 */
export const NATIVE_KINDS: ReadonlySet<EdgeKind> = new Set(onto.NATIVE_EDGE_KINDS)

export type Verdict = onto.Verdict

/** 간선이 어디서 왔나 — 보고서가 원본을 가리킬 수 있게 */
export type EdgeRefType = 'relation' | 'link' | 'evidence' | 'observation' | 'reference' | 'model' | 'override'

export interface EdgeRef {
  type: EdgeRefType
  id: string
}

/** T 간선의 성격. modify(코드를 고칠 수 있다)만 자동화의 모든 권한을 쓸 수 있다고 본다 */
export type TriggerMode = onto.TriggerMode

/** G 간선의 출처. config = 벤더 설정(회수 대상), observed = 받아들여진 쓰기, author = 작성자 */
export type GrantSource = onto.GrantSource

export interface Edge {
  id: string
  kind: EdgeKind
  from: string
  to: string
  /** G: 능력 순위 (read 1 · write 3 · admin 5). undefined = 모름 */
  rank?: number
  /** G: 능력 이름 목록 (관계 의미 층을 켰을 때만. 질의가 이름으로 묻는다 — semantic/ceiling.ts) */
  caps?: string[]
  /** G: 아래 객체(상위 범위에서 내려간 곳)로는 이 능력까지만. 없으면 caps 그대로 (capabilities.yaml capability_names 의 below) */
  capsBelow?: string[]
  /** G: 상위 범위에서 내려올 때 이 권한이 닿는 객체 종류(소문자). 없으면 전부 */
  appliesTo?: string[]
  grantSource?: GrantSource
  /** G: 역할 객체 키 (excludes 판정) */
  roleKey?: string
  /** G: 테넌트에 거는 권한의 출처 종류(레코드 규칙 emit 의 tenant_grant, providers.yaml tenant_scope kinds). 직접 권한이 테넌트 아래로 내려가는 범위를 정한다(directAccess.ts) */
  tenantGrant?: string
  /** T */
  mode?: TriggerMode
  /** 비면 확실. 사유 코드 (REASON_LABELS) */
  uncertain: string[]
  /** 벤더가 적어 준 부여(stated, 합친 값 아님) — 지워서 회수할 수 있다 */
  revocable: boolean
  /** 관측·증거로 뒷받침된다 */
  observed: boolean
  /** 사건 기록이 이 간선을 지난 횟수와 처음·마지막 시각, 행위자 수. 판정이 끝난 뒤 usage.ts 가 붙인다(판정에 쓰지 않는다). 사건이 없으면 없다 */
  usage?: { count: number; first_at: string | null; last_at: string | null; actors: number }
  refs: EdgeRef[]
  /** 보고서용 짧은 설명 */
  label: string
}

/** 경로 하나의 결과 */
export interface Hit {
  /** 불확실 간선 수 (+ 행동 범위를 모르는 대행 1) */
  cost: number
  /** 근거 경로 — 간선 id, 질의가 걸어간 순서 */
  path: string[]
  reasons: string[]
  /** 경로의 연동 간선(T·A·F·E) 중 하나 이상이 실행·전송 기록(증거·관측)에서 왔다. 확실한지는 cost 로 본다 */
  observed: boolean
}

export interface SetResult {
  /** 계정(주체 객체 키) → 가장 단단한 경로 */
  hits: Map<string, Hit>
  /** 누구나(anyone 공유·폼 응답자) */
  everyone?: Hit
  /** 목록 밖에도 있을 수 있다 (수집 완결성이 열렸다). 비어 있지 않으면 목록에 없는 사람은 no 가 아니라 unknown */
  open: string[]
}

export interface EdgeView {
  id: string
  kind: EdgeKind
  from: string
  fromName: string
  to: string
  toName: string
  label: string
  uncertain: string[]
  revocable: boolean
  refs: EdgeRef[]
}

/** EA 규격 level 과 같은 뜻 */
export type WitnessLevel = onto.WitnessLevel

export interface Witness {
  level: WitnessLevel
  /** 경로 모양 (예: T·E, M·G·U, G·F·F) */
  shape: string
  cost: number
  reasons: string[]
  edges: EdgeView[]
}

export interface CutOption {
  edge: EdgeView
  /** 끊으면 연동 쪽에서 no 가 되는 격차 인원 */
  closes: number
  /** 끊으면 yes → unknown 으로만 내려가는 격차 인원 */
  weakens: number
  /** 같이 잃는 사람 — 연동을 정당하게 쓰던 사람(둘 다) · 원래 권한자 */
  collateral: { integration: number; native: number }
}

export interface CoverageCall {
  provider: string
  call_id: string
  completeness: string
  reasons?: string[]
  run_id?: string
}

/** npm run normalize 가 데이터셋 옆에 쓰는 수집 완결성 (coverage.json) */
export interface CoverageFile {
  format: 'aegi-coverage/v1'
  generated_at?: string | null
  calls: CoverageCall[]
}

/**
 * 데이터셋 옆 access_engine_overrides.json — 끊어 보기·벤더 문서로 확인한 것을 적는다.
 * 코드가 아니라 데이터라, 확인할 때마다 여기에 더한다.
 */
export interface EngineOverrides {
  /** 엔드포인트 키 → 호출자 게이트. channel_membership = 관측된 요청 채널의 멤버만, none = 게이트 없음(확실), unknown = 기본 */
  entry_point_gates?: Record<string, 'channel_membership' | 'none' | 'unknown'>
  /** 역할 객체 키 또는 `provider:역할이름` → 능력 */
  role_capabilities?: Record<string, { rank: number; applies_to?: string[] }>
  /** Okta 리소스 세트 id (역할 배정의 resource-set 값) — resource_set.resources 로 대상 전체를 덮는다고 확인한 것 */
  confirmed_resource_sets?: string[]
  notes?: string
}

export interface EngineWarning {
  code: string
  message: string
}

export interface EngineResult {
  format: 'aegi-access-engine/v1'
  model_version: number
  dataset: { record?: string; created_at?: string | null; name?: string }
  coverage: { source: 'file' | 'none'; open: Array<{ family: string; reason: string }> }
  overrides: { source: 'file' | 'none'; entries: number }
  edges: Record<EdgeKind, { certain: number; uncertain: number }>
  warnings: EngineWarning[]
}
