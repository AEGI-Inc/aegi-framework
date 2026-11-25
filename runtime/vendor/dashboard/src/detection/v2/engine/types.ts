/**
 * 범용 접근 엔진의 브라우저 사본 — 간선 타입. 설계는 docs/spec/AEGI_GENERIC_ACCESS_ENGINE_V1.md.
 *
 * 저장된 사실(관계, Link, 증거 링크, 관측, 참조)을 간선 7종으로 옮긴다. 화면은 이 간선으로 Explorer 경로를 그린다.
 * 접근 질의(can, cause, know)와 그 답(Hit, SetResult, Witness)은 2026-11-18 지웠다. 접근은 엔진 접근 표를 읽는다.
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
  /** G: 상위 범위에서 내려올 때 이 권한이 닿는 객체 종류(소문자). 없으면 전부 */
  appliesTo?: string[]
  grantSource?: GrantSource
  /** G: 역할 객체 키 (excludes 판정) */
  roleKey?: string
  /** T */
  mode?: TriggerMode
  /** 비면 확실. 사유 코드 (REASON_LABELS) */
  uncertain: string[]
  /** 벤더가 적어 준 부여(stated, 합친 값 아님) — 지워서 회수할 수 있다 */
  revocable: boolean
  /** 관측·증거로 뒷받침된다 */
  observed: boolean
  refs: EdgeRef[]
  /** 보고서용 짧은 설명 */
  label: string
}

export interface CoverageCall {
  provider: string
  call_id: string
  completeness: string
  reasons?: string[]
  run_id?: string
}

/** normalize:v2 가 데이터셋 옆에 쓰는 수집 완결성 (coverage.json) */
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
