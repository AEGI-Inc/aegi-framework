// 위협 판정 V2 위협 형식 (docs/spec/AEGI_THREAT_JUDGMENT_V2.md 8절)
// 차단 지점은 cuts.ts

import type { ThreatLevel } from './judge'
import type { ThreatTypeName } from '../../ontology/generated'
export type { ThreatLevel }

export type ThreatSeverity = 'critical' | 'high' | 'medium' | 'low'

/** 위협 유형 이름. 정본은 aegi-knowledge schema/ontology/threat_types.yaml(npm run ontology:sync) */
export type ThreatType = ThreatTypeName

export interface ThreatSubject {
  person: string
  types: ThreatType[]
  certainty: '확정' | '미확정'
  /** certainty 가 확정이어도 미확정 경로에서만 나온 유형(types 에도 들어 있음) */
  unconfirmedTypes?: ThreatType[]
  /**
   * 이 사람이 이 위협에서 새로 얻은 수준(읽기, 쓰기, 관리). 유형 이름이 읽기와 쓰기를 담지 않아 화면은 이 값으로 가른다.
   * 「아래 내용 읽기」와 데이터 반출의 읽기도 읽기다(2026-11-19 결정)
   */
  levels: AccessLevel[]
  /**
   * certainty 가 확정이어도 미확정 판정 줄에서만 얻은 수준(levels 에도 들어 있음). 유형 이름이 같아도(쓰기는 확정 비인가 접근, 읽기는 미확정 비인가 접근) 보이게 한다.
   * 「아래 내용 읽기」는 읽기로 센다(2026-11-19 결정)
   */
  unconfirmedLevels?: AccessLevel[]
  /** 판정 줄의 사람이 조직 밖이거나 조직 경계를 모름(aegi-knowledge threat_types.yaml outside). 데이터 반출을 받는 사람이라도 조직 안이면 false */
  outside: boolean
  /** 그 사람이 연동 지점에 닿는 간선 종류. 직접 공유면 없음 */
  entry?: string
  /** 그 사람 계정에서 연동 지점까지 길(데이터 흐름은 사본 쪽까지). 마지막 간선의 종류가 entry. 직접 공유와 파생 단계가 없는 판정이면 없음(2026-11-17 결정) */
  lead?: ThreatHop[]
}

export type AccessLevel = '읽기' | '쓰기' | '관리'

/** Access Gap 벤의 사람 한 명(threatGap.ts) */
export interface ThreatGapPerson {
  person: string
  /** 대상에 대한 직접 권한 수준. 조직 밖 사람은 직접 공유 가운데 기준선(승인 목록 밖은 없음, 안은 읽기) 안의 수준. 없으면 null */
  direct: AccessLevel | null
  /** 이 연동 지점으로 닿는 수준. 조직 안은 파생 접근, 조직 밖은 직접 공유와 파생 접근. 직접 권한 원에만 있으면 null */
  derived: AccessLevel | null
  /** Access Gap 기준선보다 높아진 수준(새로 생긴 권한). 기준선은 조직 안이 직접 권한, 조직 밖이 없음이나 승인 범위 */
  gained: AccessLevel[]
  /** 조직 밖 사람이 이 연동 지점(대상 자신)에서 직접 공유로 받은 수준. 기준선 밖이라 직접 권한 원에 넣지 않는다(2026-11-18 결정) */
  share?: AccessLevel
  /** 파생 접근 원 사람만 */
  certainty?: '확정' | '미확정'
  /** certainty 가 확정이어도 미확정 판정 줄에서만 얻은 수준(gained 에도 들어 있음) */
  unconfirmedGained?: AccessLevel[]
  /** 비트는 올랐지만 Access Gap 수에서 뺀 이유 */
  excluded?: '관리자' | '승인됨'
  /** 직접 수준이 누구나 공유에서만 와서 직접 권한 원 밖. 벤에서 파생 접근 원에만 둔다 */
  publicOnly?: true
  /** 대상에 확정 직접 권한을 받은 이 사람의 계정 키(같은 사람 계정 가운데, 키 순). 직접 권한 원 사람만. 대시보드가 계정의 SaaS 로고를 단다(2026-11-20) */
  directAccounts?: string[]
  /** 이 연동 지점으로 대상에 닿기 시작한 이 사람의 계정 키(판정 경로의 첫 계정, 조직 밖 직접 공유는 공유받은 계정, 키 순). 파생 접근 원 사람만 */
  derivedAccounts?: string[]
}

/**
 * Access Gap 벤(위협 하나에 하나). 비인가 접근, 권한 상승, 데이터 반출 위협만(조직 밖 직접 공유 포함, 2026-11-18 결정).
 * 권한 없는 접근자: 새로 생긴 권한이 있고 직접 권한(기준선 안)이 없는 사람. 권한 초과 접근자: 새로 생긴 권한이 있고 직접 권한이 있는 사람. 제외된 사람은 두 수에서 뺀다
 */
export interface ThreatAccessGap {
  /** 직접 권한 원 인원(누구나 공유를 뺀 기준선 안 직접 권한, 전부 셈) */
  directCount: number
  /** 파생 접근 원 인원(제외된 사람 포함) */
  derivedCount: number
  unauthorized: number
  excess: number
  /** 파생 접근 원 사람 전부와 직접 권한만 있는 사람 앞쪽 일부(수준 높은 순) */
  people: ThreatGapPerson[]
}

export interface ThreatHop {
  /** 간선 9종 이름 */
  kind: string
  from: string
  to: string
  /** 이 간선의 근거(관계, 연결, 관측, 증거 키, 벤더 표가 읽은 속성). 상위 범위에 준 권한이면 가장 가까운 범위 간선의 근거, 묶인 대상이면 대상마다 합침. 맞는 그래프 간선이 없으면 없음 */
  refs?: HopRef[]
}

/** 간선 근거 하나. 종류는 엔진 EdgeRef 와 같음(relation, link, observation, evidence, reference, model, override) */
export interface HopRef {
  type: string
  id: string
}

export interface ThreatV2 {
  /** 연동 지점과 대상의 해시. 경로가 조금 바뀌어도 이어진다 */
  id: string
  fingerprint: string
  point: string
  /** 대표 대상. 여러 대상이 한 범위 아래 같은 판정이면 그 범위 */
  target: string
  /** 묶인 대상 전부 */
  targets: string[]
  /** 확정이면 확정된 유형 중 대표 */
  primaryType: ThreatType
  types: ThreatType[]
  /** certainty 가 확정이어도 어느 사람에게서도 확정되지 않은 유형(types 에도 들어 있음) */
  unconfirmedTypes?: ThreatType[]
  /** certainty 가 확정이어도 어느 사람에게서도 확정되지 않은 수준. 「아래 내용 읽기」는 읽기로 센다 */
  unconfirmedLevels?: AccessLevel[]
  occurrence: '발생 가능' | '발생'
  certainty: '확정' | '미확정'
  reasons: string[]
  /** 연동 지점에서 대표 대상까지. 직접 공유면 사람에서 대상 */
  path: { hops: ThreatHop[] }
  subjects: ThreatSubject[]
  /** 화면에 보이는 인원. 추적성 상실에는 없다 */
  headcount?: ThreatHeadcount
  /** Access Gap 벤. 비인가 접근, 권한 상승, 데이터 반출(조직 밖 직접 공유 포함) 위협에 위협 행이 있는 사람이 하나라도 있을 때만 */
  accessGap?: ThreatAccessGap
  /**
   * 차단 지점(게시 때만 계산). 지웠을 때 다시 판정으로 이 위협의 사람이 닫히는, 설정으로 회수할 수 있는 간선(cuts.ts).
   * 많이 닫는 것이 앞. 하나로 다 안 닫히면 맨 앞에 함께 끊을 조합(with)
   */
  cuts?: ThreatCutV2[]
  /** OWASP Risk Rating 으로 정한 등급(assemble severityOf, 명세 「심각도」). 사람마다 매긴 등급 중 가장 높은 것. 확실성은 쓰지 않는다 */
  severity: ThreatSeverity
  severityFactors: {
    /** 새로 접근하는 사람 수(공유 계정은 대표하는 사람 수). 등급에 쓰지 않고 같은 등급 안의 정렬에 씀. 추적성 상실은 0 */
    people: number
    /**
     * 등급을 정한 사람(추적성 상실은 길)의 가능성 요소 점수(0~9)와 평균(score).
     * size 규모, opportunity 기회, exploit 공격 쉬움, detection 침입 탐지. 신호가 없는 기술 수준, 동기, 발견 쉬움, 알려짐은 없다
     */
    likelihood: { size: number; opportunity: number; exploit: number; detection: number; score: number }
    /**
     * 같은 사람의 영향 요소 점수(0~9)와 평균(score). 해당하는 요소만 있다.
     * confidentiality 기밀성(새 읽기), integrity 무결성(새 쓰기), availability 가용성(새 관리), accountability 책임 추적성(추적성 상실에만)
     */
    impact: { confidentiality?: number; integrity?: number; availability?: number; accountability?: number; score: number }
  }
}

/**
 * 화면에 보이는 인원(2026-11-20 결정). 누구나는 숫자에 넣지 않고 따로 붙인다(「8명과 누구나」).
 * people: 누구나를 뺀 서로 다른 사람 수. 공유 계정도 한 명. everyone: 누구나가 그 사람들 안에 있다.
 * severityFactors.people 은 정렬용 값이라 그대로 둔다
 */
export interface ThreatHeadcount {
  people: number
  everyone: boolean
}

export interface ThreatCutV2 {
  at: ThreatHop
  /** 간선 종류로 정한 조치 코드 */
  action: string
  /** 함께 끊어야 닫히는 다른 간선 */
  with?: { at: ThreatHop; action: string }[]
  /** 지운 그래프를 다시 판정해 닫힌 사람 수 */
  closes: number
  /** 이 위협의 사람 수 */
  of: number
  /** 닫힌 사람을 headcount 와 같은 셈으로. 추적성 상실의 차단 지점에는 없다 */
  closed?: ThreatHeadcount
  /** closes === of */
  verified: boolean
  /** 다 안 닫힐 때 남은 사람이 같은 대상에 닿는 다른 연동 지점 */
  remainVia?: string[]
  /** 같은 간선(조합)이 모두 닫는 다른 위협 수 */
  alsoCloses?: number
}

/**
 * 게시 접근 표의 사람 한 줄(accessTable.ts). 수준은 [읽기(1), 쓰기(2) 또는 관리(3)]. 없는 칸은 0 이라 뺀다.
 * direct: 권한 간선이 닿는 수준(확정과 모름 근거 전부, 수준 모르는 권한은 읽기). directSure: 그중 확정 근거만. 누구나 공유는 @everyone 줄에 따로 있다.
 * derived: 파생 접근 수준. derivedSure: 그중 확정 경로만. points: 그 수준을 준 연동 지점(읽기 r, 쓰기 이상 w, 확정 경로 rs, ws)
 * gained: 판정이 본 직접 수준(확정 직접 권한과 누구나 공유 읽기)보다 파생 접근이 높아진 수준. 위협 판정과 같은 셈이다(명세 「접근 표」)
 */
export interface AccessTableRow {
  person: string
  direct?: [number, number]
  directSure?: [number, number]
  derived?: [number, number]
  derivedSure?: [number, number]
  points?: { r?: string; w?: string; rs?: string; ws?: string }
  gained?: Partial<Record<AccessLevel, AccessGain>>
}

/** 새로 생긴 권한 한 수준의 확실성. 미확정이면 이유(경로 모름 사유, 직접 수준 모름, 같은 사람 연결 약함, 같은 사람 연결 없음, 조직 경계 모름) */
export interface AccessGain {
  certainty: '확정' | '미확정'
  reasons?: string[]
  /** 조직 밖 사람에게 직접 공유한 수준. 조직 밖 사람의 기준선(승인 목록 밖은 없음, 안은 읽기)을 넘어 Access Gap 이다(2026-11-18 결정) */
  share?: true
}

/** 게시 접근 표: 대상마다 사람별 직접 권한과 파생 접근(2026-11-18 결정). 대상과 사람은 키 순. 사람 키는 위협의 person 과 같은 대표 계정 키 */
export interface AccessTable {
  version: 1
  targets: Record<string, AccessTableRow[]>
  /**
   * 계정이 둘 이상인 사람의 계정(대표 계정 키 포함, 키 순). 같은 사람 묶음은 판정이 정한다. 대시보드는 경로에 있는 그 사람 계정의 이름을 보이고
   * 진입 계정이 어느 사람인지 찾을 때 이것만 읽는다(같은 사람을 다시 가리지 않는다). 계정 하나뿐인 사람은 싣지 않는다
   */
  accounts?: Record<string, string[]>
}
