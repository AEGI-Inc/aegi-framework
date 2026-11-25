// 위협 판정 V2 핵심 (docs/spec/AEGI_THREAT_JUDGMENT_V2.md 4~6절)
//
// 판정 그래프 위에서 사람마다 직접 접근과 파생 접근을 구하고 5절 규칙 표로 유형을 붙인다. 추적성 상실은 고정 실행 신원마다 따로 훑는다.
// SaaS 이름, 정책 id 를 쓰지 않는다. 판정 그래프는 사례 시험(cases.ts)과 실데이터 어댑터가 같이 만든다.
import type { EdgeName } from './vocabulary'
import type { AccessGain, AccessLevel, HopRef } from './contract'
import { ADMIN as ADMIN_BIT, READ as READ_BIT, WRITE as WRITE_BIT, LEVEL_RANK, grantUnsure, reachedGrants, spreadOf, type DirectLevel, type DirectSource, type GrantView, type ObjectClass } from '../v2/engine/directAccess'
import { EVERYONE } from '../v2/engine/relationEffects'
import { L, Z, eq, get, mx, type Acc, type AccMap } from './access'
import { POST_ONLY, derivedAccess, isFixed, stepOf, unsure, unsureReasons, type Chain, type FlagMaps, type Opening, type Step } from './derived'
import { gainedOf } from './threatGap'
import { THREAT_TYPES, THREAT_TYPE_ORDER, type ThreatTypeId, type ThreatTypeName } from '../../ontology/generated'

export type NodeKind = 'person' | 'identity' | 'auto' | 'group' | 'tenant' | 'res'
export type Boundary = 'in' | 'out' | 'unknown'
export type Level = 'read' | 'write' | 'admin' | 'post'

export interface JudgeNode {
  kind: NodeKind
  /** 객체 종류(소문자). 권한 간선 appliesTo 대조용 */
  type?: string
  /** 객체가 속한 SaaS. 관리 범위 차용을 같은 SaaS 로 한정할 때만 쓴다 */
  provider?: string
  org?: Boundary
  /** res 만. 내용 객체, 제어 객체 */
  cls?: 'content' | 'control'
  /** 아래 객체가 따로 없어도 그릇으로 본다(메일 외부 전달의 메일 내용: 그 계정 메일 전부). 범위 「중간」 */
  holds?: true
  /** 이 노드가 대표하는 사람 수 */
  multi?: number
  /** 승인 목록 등록 출처 */
  approved?: 'customer' | 'saas' | 'both'
  /** 공개 의도 등록 */
  public_by_design?: unknown
  /** res 만. 이 객체가 딸린 사람 계정(본인 프로필, 본인 속성). 본인 객체에 대한 접근은 위협 아님(1절) */
  owner?: string
  guest?: unknown
  /** 메일 도메인만으로 본 수신자. 값이 참이면 그 도메인이 조직 테넌트의 검증 도메인 */
  domain_owned_tenant?: unknown
  /** 약하게 이어진 같은 사람 계정(하나 또는 여럿) */
  weak?: string | string[]
  /** 단단하게 이어진 같은 사람 계정(하나 또는 여럿) */
  same?: string | string[]
  /** person 만. 같은 사람 Link 를 시작한 허브 계정(IdP, 메일 디렉터리. crosswalk.yaml hubs). 같은 사람 묶음의 대표로 먼저 고른다 */
  hub?: true
  /**
   * person 만. 같은 사람 연결이 하나도 없고, 사람 표가 완결이 아니라 연결이 없다는 것이 다른 사람이라는 뜻이 아니다.
   * 같은 사람일 수 있는 다른 SaaS 사람이 이미 닿는 대상에 새로 닿는 판정은 미확정(같은 사람 연결 없음).
   * open: 그 SaaS 계정은 아무도 연결되지 않음(허브가 그 SaaS 를 못 맞춤). 그 SaaS 계정이 없는 사람 누구나 후보.
   * matched: 같은 SaaS 의 다른 계정은 연결됨(맞추기는 되는데 이 계정만 안 맞음). 연결된 사람은 후보가 아니고 연결 없는 계정만 후보
   */
  nolink?: 'open' | 'matched'
  /** identity 만. 자격증명(토큰, 키). 범위 위 자원을 읽을 수 있으면 꺼내 쓴다 */
  credential?: unknown
  /** identity 만. 자격증명 실물(개인 키)이 SaaS 밖에 있어 범위 위 자원을 읽어도 꺼내지 못한다 */
  heldElsewhere?: boolean
  /** auto 만. caller_recorded 면 대상 감사 로그에 호출자가 남는다 */
  audit?: string
  /** auto 만. 접속자 권한 차용이 실행 기록으로 확인됨 */
  obs_borrow?: unknown
  /** 직접 권한 규칙의 객체 종류(내용, 설정, 계정). none 은 종류 없음. 없으면 노드 종류로 정한다(사례 시험) */
  dclass?: ObjectClass | 'none'
}

/** 접속자 권한 차용 상한 하나. types 는 객체 종류(소문자), 없으면 같은 SaaS 전부 */
export interface BorrowCap {
  level: Level
  types?: string[]
}

export interface JudgeEdge {
  kind: EdgeName
  from: string
  to: string
  /** 권한, 효과 간선의 수준 */
  level?: Level
  /** 권한 간선. 범위 아래로 내려갈 때 닿는 객체 종류. 없으면 전부 */
  appliesTo?: string[]
  /** 실행 신원 간선. 대상별 동작 범위. 없으면 모름 */
  cap?: Record<string, Level>
  /**
   * 실행 신원 간선. 자동화를 부르는 사람이 이 신원 권한으로 닿을 수 있는 대상(규칙 범위 안이고 동작이 바꿀 수 있는 것). 없으면 거르지 않음.
   * 추적성 상실은 이것으로 거르지 않는다(고정 신원이 여럿 대신 하는 일 전부가 기록에서 한 이름이 된다)
   */
  callerScope?: string[]
  /** 실행 신원 간선. 자동화를 고칠 수 있는 사람이 이 신원 권한으로 닿을 수 있는 대상(규칙 범위 안). 없으면 거르지 않음 */
  editScope?: string[]
  /** 실행 신원 간선. 자동화를 고칠 수 있다고 볼 자동화 접근 수준. 없으면 쓰기 */
  editLevel?: Level
  /** 데이터 흐름을 옮기는 자동화 */
  via?: string
  /** 데이터 흐름 간선. 사건 기록으로 흐름(전송)을 확인함(엔진 간선 observed). 조직 밖 목적지로 가면 데이터 반출 「발생」 */
  observed?: true
  /** 실행 신원 간선. fixed(기본) 또는 caller */
  mode?: string
  /** caller 실행 신원. 호출자의 제어 객체 관리 권한만 빌린다(관리 범위로 도는 자동화) */
  borrowAdminOnly?: boolean
  /**
   * caller 실행 신원. 호출자 토큰이 닿는 상한(자동화가 받은 scope). 있으면 borrowAdminOnly 대신 이것으로 자른다:
   * 대상 종류가 맞는 상한 중 가장 높은 수준까지만 빌린다. 없으면 상한 없음
   */
  borrowCap?: BorrowCap[]
  /** 호출 간선. 허용 호출자. 없으면 모름 */
  gate?: string[]
  /** 호출에 필요한 수준. 기본 write */
  need?: Level
  /** 호출 간선. 호출할 수 있는 사람을 확인 못 한 사유. 있으면 그 호출로 얻은 접근은 미확정(규칙 9) */
  uncertain?: string[]
  /**
   * 실행 신원 간선. 이어 붙인 사슬이 모두 불확실 간선(약한 자동화 연결, 같은 범위로만 이은 자격증명 사용 등)을 지날 때 그 사유.
   * 위협 판정은 그 간선을 거친 파생 접근에 「실행 신원 연결 추정」을 붙여 미확정으로, 추적성 상실도 미확정으로 낸다.
   * 피해 범위 위임 쓰기와 자동화의 파생 접근 답(derivedAt)도 미확정으로 읽는다
   */
  chainUnsure?: string[]
  /** 간선 근거(명세 3절 출처). 판정에는 안 씀 */
  refs?: HopRef[]
  /** 설정으로 회수할 수 있는 간선(명세 8절). 차단 지점 후보만 가른다. 판정에는 안 씀 */
  revocable?: boolean
  /** 엔진 간선 id(EdgeIndex). 판정만 더한 간선은 없음 */
  id?: string
  /** 권한 간선. 역할 객체(역할 제외 판정용) */
  roleKey?: string
  /** 권한 간선. 도착이 테넌트일 때 객체 종류마다 내려가는 세기 문턱(directAccess tenantReach). 없으면 막지 않는다 */
  reach?: Partial<Record<ObjectClass, number>>
  /** 권한 간선. 수준을 아는가. 없으면 level 이 있는가 */
  known?: boolean
  /** 권한 간선. 불확실 사유(채널 공개 모름 등). 있으면 그 권한은 「모름」 */
  grantUnsure?: string[]
  /** 권한 간선. 근거 출처. log 는 로그에서 확인한 권한 */
  source?: GrantView['source']
}

/** 실데이터 직접 권한 규칙(fromIndex 가 단다). 없으면 판정 그래프 간선 수준만 본다(사례 시험) */
export interface DirectHooks {
  /** 권한 간선이 x 에서 이 수준을 내나(상한, 깎기 포함). 엔진 간선이 아니면 null(간선 수준으로 본다) */
  grantAt(e: JudgeEdge, x: string, level: DirectLevel, limit: number): { reasons: string[] } | undefined | null
  /** 테넌트 소속 계정(그룹 아닌 주체) */
  tenantAccount(k: string): boolean
  roleExcluded(role: string | undefined, member: string): boolean
}

export interface JudgeGraph {
  nodes: Record<string, JudgeNode>
  edges: JudgeEdge[]
  direct?: DirectHooks
  /** AEGI 가 감사 로그를 수집하는 SaaS(노드 provider) */
  logged?: ReadonlySet<string>
}

export interface JudgedThreat {
  person: string
  target: string
  /** 대표 유형이 앞 */
  types: string[]
  certainty: '확정' | '미확정'
  /** 판정 줄의 사람이 조직 밖이거나 조직 경계를 모름(조직 밖 표시, aegi-knowledge threat_types.yaml outside). 유형 이름에 꼬리표를 붙이지 않고 사람마다 단다 */
  external?: boolean
  flags: string[]
  /** 연동 지점. 직접 공유는 대상 자신 */
  point: string
  /** 사람이 연동 지점에 닿는 간선(데이터 흐름은 사본 쪽에 닿는 간선). lead 의 마지막. 직접 공유면 없음 */
  entry?: Hop
  /** 사람 계정에서 연동 지점까지 단계마다 간선(파생 계산이 남긴 단계를 이어 붙인 것). 직접 공유면 없음 */
  lead?: Hop[]
  /** 제외 행만: lead 를 만들지 않고 그 첫 간선의 사람 계정만 둔다(Access Gap 벤의 파생 접근 계정) */
  via?: string
  /** 연동 지점에서 대상까지 간선 */
  hops: Hop[]
  /** 새로 얻은 수준. 게시 전용은 읽기 없이 게시만 */
  level: ThreatLevel
  /**
   * 판정 차원. 읽기(r), 쓰기 이상(w), 둘 다(rw). 유형 이름이 차원을 담지 않아(읽기와 쓰기가 같은 비인가 접근)
   * 대상 묶기(assemble)와 차단 지점 다시 판정(cuts)이 이름과 같이 본다
   */
  dim: 'r' | 'w' | 'rw'
  /**
   * 심각도 가능성 신호(명세 「심각도」). 판정 행의 길마다 하나, 읽기와 쓰기가 다른 단계에서 와 합친 행은 둘(심각도는 더 높은 쪽).
   * 제외 행은 심각도를 매기지 않아 비어 있다
   */
  likelihood: Likelihood[]
  /**
   * 손실 범위(심각도 영향). 같은 연동 지점으로 그 사람에게 열리는 대상 전체로 본다(직접 공유는 공유 대상마다).
   * 연동 지점 신원이 테넌트 권한으로 닿으면 전부. 대상이 자격증명이면 assemble 이 피해 범위로 넓힌다. 제외 행은 없다
   */
  extent?: Extent
  /**
   * 이 판정을 낸 Access Gap 값(그 행의 차원). Access Gap 벤(threatGap.ts)이 쓴다.
   * base: 기준선(조직 안은 직접 권한, 조직 밖은 없음이나 승인 범위). direct: 벤에 보이는 직접 수준(조직 밖은 직접 공유 가운데 기준선 안).
   * derived: 가진 접근(조직 안은 파생 접근, 조직 밖은 직접 공유와 파생 접근 중 높은 것). share: 그 수준을 준 조직 밖 직접 공유
   */
  access?: { direct: Acc; derived: Acc; base: Acc; share?: Acc }
  /** 관리자 신뢰, 승인으로 위협에서 뺀 행(JudgeResult.excluded 에만 있다) */
  excluded?: '관리자' | '승인됨'
  /** 데이터 반출 판정이고 조직 밖 목적지로 가는 데이터 흐름의 전송 기록이 있다(명세 5절 규칙 12 「발생」, threat_types.yaml data_exfiltration) */
  sent?: true
}

/** 판정 수준. 게시 전용은 읽기 없이 게시만 */
export type ThreatLevel = 'read' | 'write' | 'admin' | 'post'
/**
 * 들어오는 자리에 설 수 있는 사람(심각도 가능성 요소 규모).
 * admin 관리자만, member 특정 채널이나 그룹 구성원(특정 사람, 특정 자원 포함), org 조직 전원, anyone 누구나(공개 폼, 공개 링크)
 */
export type Spot = 'admin' | 'member' | 'org' | 'anyone'
/**
 * 길 하나의 심각도 가능성 신호(명세 「심각도」, 2026-11-18 OWASP Risk Rating 결정). 점수는 assemble 이 매긴다.
 * spot: 사람이 자기 권한으로 처음 서는 자리(Opening)에 설 수 있는 사람. 직접 공유는 member, 누구나 노드는 anyone.
 * need: 그 자리에 필요한 수준(기회). admin 관리, write 쓰기, read 읽기나 호출, none 계정 없이(조직 밖 직접 공유, 누구나).
 * effort: 길에서 가장 어려운 단계(공격 쉬움). usual 평소대로(사본 읽기, 봇 호출, 폼 제출), extract 자원 안 자격증명 꺼내 쓰기,
 *   edit 자동화를 고침(접속자 권한 차용 포함).
 * recorded: 대상에 한 일이 감사 로그에 그 사람으로 남는가(침입 탐지, 책임 추적성). 고정 신원이나 다른 사람 이름만 남거나 모르면 거짓.
 * outside: 조직 밖 사람(조직 경계 모름 포함)
 */
export interface Likelihood {
  spot: Spot
  need: 'admin' | 'write' | 'read' | 'none'
  effort: 'usual' | 'extract' | 'edit'
  recorded: boolean
  outside: boolean
  /** 들어가는 자리나 대상의 SaaS 가운데 하나라도 AEGI 가 감사 로그를 수집한다(JudgeGraph.logged). 침입 탐지 「기록되고 검토됨」 */
  logged?: true
}
/** 손실 범위(심각도 영향). some 조금(대상 하나), mid 중간(그릇 하나), wide 넓게(여러 대상), all 전부(SaaS 둘 이상, 테넌트 전체) */
export type Extent = 'some' | 'mid' | 'wide' | 'all'

/** 경로의 간선 한 개. kind 는 간선 7종 이름 */
export interface Hop {
  kind: string
  from: string
  to: string
  /** lead 의 권한 간선만. 그 자리에 필요한 수준(읽기 r, 쓰기 w, 관리 a). 게시가 근거 간선을 고를 때 쓴다 */
  need?: 'r' | 'w' | 'a'
}

/** 위협 대상에 파생 접근이 닿지만 직접 권한보다 높아지지 않은 사람(위협 행이 없다). Access Gap 파생 접근 원 */
export interface JudgedReach {
  person: string
  point: string
  derived: Acc
  direct: Acc
  certainty: '확정' | '미확정'
  /** 그 파생 접근을 시작한 사람 계정(lead 첫 간선). 경로를 못 찾으면 없음 */
  accounts?: string[]
}

/**
 * 사람 하나가 대상 하나에 가진 직접 권한과 파생 접근(게시 접근 표, accessTable.ts). 수준은 [읽기, 쓰기(2)/관리(3)].
 * direct: 권한 간선이 닿는 수준. 확정과 모름 근거 전부(수준 모르는 권한은 읽기). directSure: 그중 확정 근거만(누구나 공유 뺌).
 * derived, derivedSure: 파생 접근 수준과 확정 수준. points: 그 수준을 준 연동 지점(읽기 r, 쓰기 이상 w, 확정 표의 지점 rs, ws)
 * gained: Access Gap 기준선보다 높아진 수준과 확실성. 위협 판정의 Access Gap 과 같다. 조직 안은 기준선이 판정이 본 직접 수준(D, 누구나 공유 읽기 포함)이고
 * 가진 접근이 파생 접근. 조직 밖의 Access Gap 대상은 기준선이 없음이나 승인 범위(읽기)이고 가진 접근이 직접 공유와 파생 접근(직접 공유로 선 수준은 share)
 */
export interface JudgedAccess {
  person: string
  target: string
  direct: Acc
  directSure: Acc
  derived: Acc
  derivedSure: Acc
  points: { r?: string; w?: string; rs?: string; ws?: string }
  gained: Partial<Record<AccessLevel, AccessGain>>
}

export interface JudgedTrace {
  identity: string
  severity: 'high' | 'low'
  /** 약하게 이어진 계정을 같은 사람으로 합치면 사라지는 추적성 상실(명세 5절 규칙 12). 감사 로그로 확인해도 미확정 */
  unsure?: true
  /**
   * 그 신원 이름만 남는 길마다(자동화 호출, 자원 안 자격증명 꺼내 쓰기) 심각도 신호. 심각도는 가장 높은 길(명세 「심각도」).
   * likelihood: 부르거나 꺼내 쓰는 사람의 가능성 신호(recorded 는 늘 거짓). level: 그 신원이 남의 이름으로 하는 일(추적성 상실 수준). extent: 그 범위
   */
  ways: TraceWay[]
}

export interface TraceWay {
  likelihood: Likelihood
  level: Acc
  extent: Extent
}


/** 여러 접근 표를 합친 표. 물어본 대상만 그때 셈한다(같은 사람 후보를 합쳐 재검사할 때 표 전체를 복사하지 않게) */
class MaxView extends Map<string, Acc> {
  constructor(private readonly parts: AccMap[]) { super() }
  override get(k: string): Acc {
    let v = super.get(k)
    if (!v) { v = this.parts.reduce((a, m) => mx(a, get(m, k)), Z); super.set(k, v) }
    return v
  }
  override keys(): MapIterator<string> {
    return new Set(this.parts.flatMap(m => [...m.keys()])).values()
  }
}

/** 위협 유형 이름(aegi-knowledge threat_types.yaml, 생성 src/ontology/generated.ts) */
const TYPE_NAME = Object.fromEntries(THREAT_TYPES.map(t => [t.id, t.name])) as Record<ThreatTypeId, ThreatTypeName>
const UNAUTH = TYPE_NAME.unauthorized_access
const EXFIL = TYPE_NAME.data_exfiltration
const ESCALATE = TYPE_NAME.privilege_escalation
/** 대표 유형 순서(threat_types.yaml order) */
const TYPE_ORDER: readonly string[] = THREAT_TYPE_ORDER.map(id => TYPE_NAME[id])
/** 제어 객체 관리를 새로 얻어 그 아래 기준선으로 못 읽던 내용을 읽게 된 판정의 사유(비인가 접근, 심각도 영향 기밀성) */
export const HIDDEN = '아래 내용 읽기'
/** 관리 수준을 새로 얻은 판정의 사유. 판정 수준 관리(심각도 영향 가용성) */
export const ADMIN = '관리'

export class Index {
  readonly out = new Map<string, JudgeEdge[]>()
  readonly inn = new Map<string, JudgeEdge[]>()
  readonly scopeChildren = new Map<string, string[]>()
  readonly scopeParents = new Map<string, string[]>()
  readonly byKind = new Map<EdgeName, JudgeEdge[]>()
  private readonly grantCache: Map<string, AccMap>
  private readonly directCache: Map<string, Direct>
  private readonly reachCache: Map<GrantView, [string, Acc][]>

  /** 권한 간선 하나가 신원에게 주는 수준. 간선마다 한 번만 */
  private grantReach(g: GrantView): [string, Acc][] {
    let out = this.reachCache.get(g)
    if (out) return out
    out = []
    for (const [t, r] of spreadOf(this.src, g)) {
      if (!g.known && t !== g.to && this.src.isTenant(g.to) && this.src.objectClass(t) === 'account') continue
      const bits = g.known ? r.bits : r.bits ? READ_BIT : 0
      if (bits) out.push([t, accOf(bits)])
    }
    this.reachCache.set(g, out)
    return out
  }
  /**
   * 계정들(같은 사람)의 권한 간선이 닿는 모든 대상의 수준. 확정과 모름 근거 전부(수준 모르는 권한은 읽기, identityGrant 와 같은 셈).
   * 누구나 공유는 넣지 않는다. 게시 접근 표(accessTable.ts)만 쓴다
   */
  directReach(key: string, accounts: string[] = [key]): AccMap {
    const m: AccMap = new Map()
    for (const g of this.direct(key, accounts).reached) for (const [t, l] of this.grantReach(g)) m.set(t, mx(get(m, t), l))
    return m
  }
  /** 계정들 가운데 대상에 확정 직접 권한(sure 와 같은 근거)을 받은 계정. 키 순 */
  directAccountsAt(key: string, accounts: string[], t: string): string[] {
    const d = this.direct(key, accounts)
    const out = new Set<string>()
    d.reached.forEach((g, i) => {
      if (out.has(d.by[i]) || grantUnsure(g)) return
      const r = spreadOf(this.src, g).get(t)
      if (r && !r.reasons.length && r.bits) out.add(d.by[i])
    })
    return [...out].sort()
  }
  private stored?: Map<string, string[]>
  private readonly descCache = new Map<string, Set<string>>()

  /**
   * direct: 직접 권한이 읽는 간선(소속, 권한, 범위)과 노드가 이 그래프와 같은 다른 그래프의 색인. 주면 직접 권한 계산과 그 결과를 함께 쓴다.
   * 차단 지점 확인이 호출, 데이터 흐름, 효과 같은 간선만 지우고 다시 판정할 때 사람마다 직접 권한을 다시 세지 않게 한다
   */
  constructor(readonly g: JudgeGraph, direct?: Index) {
    this.grantCache = direct?.grantCache ?? new Map()
    this.directCache = direct?.directCache ?? new Map()
    this.reachCache = direct?.reachCache ?? new Map()
    if (direct) this.srcCache = direct.src
    for (const e of g.edges) {
      push(this.out, `${e.kind}|${e.from}`, e)
      push(this.inn, `${e.kind}|${e.to}`, e)
      push(this.byKind, e.kind, e)
      if (e.kind === '범위') {
        push(this.scopeChildren, e.to, e.from)
        push(this.scopeParents, e.from, e.to)
      }
    }
  }

  outOf(kind: EdgeName, from: string): JudgeEdge[] {
    return this.out.get(`${kind}|${from}`) ?? []
  }

  inOf(kind: EdgeName, to: string): JudgeEdge[] {
    return this.inn.get(`${kind}|${to}`) ?? []
  }

  of(kind: EdgeName): JudgeEdge[] {
    return this.byKind.get(kind) ?? []
  }

  /** 소속을 따라 닿는 주체 */
  closure(starts: Iterable<string>): Set<string> {
    const seen = new Set(starts)
    const st = [...seen]
    while (st.length) {
      const x = st.pop()!
      for (const e of this.outOf('소속', x)) if (!seen.has(e.to)) { seen.add(e.to); st.push(e.to) }
    }
    return seen
  }

  /** 범위 아래 객체 전부 */
  desc(x: string): Set<string> {
    const res = new Set([x])
    const st = [x]
    while (st.length) {
      const y = st.pop()!
      for (const c of this.scopeChildren.get(y) ?? []) if (!res.has(c)) { res.add(c); st.push(c) }
    }
    return res
  }

  /** 범위 아래 객체 전부. 여러 번 묻는 대상은 담아 둔다 */
  descCached(x: string): Set<string> {
    let d = this.descCache.get(x)
    if (!d) { d = this.desc(x); this.descCache.set(x, d) }
    return d
  }

  /** 자원(res) 범위 바로 아래 자격증명. 자원을 읽으면 꺼내 쓴다. 테넌트 아래 자격증명은 테넌트 권한으로 꺼내지 않는다 */
  credentialsIn(x: string): string[] {
    if (!this.stored) {
      this.stored = new Map()
      for (const [k, cs] of this.scopeChildren) {
        if (this.g.nodes[k]?.kind !== 'res') continue
        const held = cs.filter(c => extractable(this.g.nodes[c]))
        if (held.length) this.stored.set(k, [...new Set(held)])
      }
    }
    return this.stored.get(x) ?? []
  }

  /** 자격증명을 쥐면 동작하는 신원. 실행 신원 간선이 없으면 자격증명 자신 */
  credentialIdentities(c: string): string[] {
    const ids = this.outOf('실행 신원', c).map(r => r.to)
    return ids.length ? [...new Set(ids)] : [c]
  }

  /** 직접 권한 펴기 입력. 판정 그래프 위에서 엔진과 같은 규칙(directAccess.ts) */
  private srcCache?: DirectSource
  get src(): DirectSource { return (this.srcCache ??= directSourceOf(this)) }

  /**
   * 계정들(같은 사람)의 직접 권한. 확정 근거만 수준 표에 넣고, 「모름」 권한은 따로 둬 대상마다 그때 묻는다(사람마다 표를 다 만들지 않게).
   * 누구나 공유는 넣지 않는다(판정이 누구나 노드 것을 따로 합친다)
   */
  direct(key: string, accounts: string[] = [key]): Direct {
    let d = this.directCache.get(key)
    if (d) return d
    const reached = reachedGrants(this.src, { kind: 'identity', key, accounts: accounts.map(k => ({ key: k, link: 'strong' as const })) }, { everyone: false })
    const sure: AccMap = new Map()
    const unsure: GrantView[] = []
    for (const { grant: g } of reached) {
      if (grantUnsure(g)) { unsure.push(g); continue }
      let partial = false
      for (const [t, r] of spreadOf(this.src, g)) {
        if (r.reasons.length) { partial = true; continue }
        sure.set(t, mx(get(sure, t), accOf(r.bits)))
      }
      if (partial) unsure.push(g)
    }
    const src = this.src
    d = {
      reached: reached.map(r => r.grant), by: reached.map(r => r.account.key), sure,
      unknownAt: t => unsure.some(g => { const r = spreadOf(src, g).get(t); return !!r && (grantUnsure(g) || r.reasons.length > 0) }),
    }
    this.directCache.set(key, d)
    return d
  }

  /**
   * 신원(또는 계정) 하나가 가진 수준. 확정, 모름 근거 전부. 수준 모르는 권한은 읽기로 센다(파생 접근이 닿는 곳).
   * 테넌트에 걸린 수준 모르는 역할은 그 테넌트 소속 계정을 읽는다고 보지 않는다(직접 권한에서는 모름으로 남는다). 신원마다 한 번만 계산
   */
  identityGrant(identity: string): AccMap {
    let m = this.grantCache.get(identity)
    if (!m) {
      m = new Map()
      for (const g of this.direct(identity).reached) for (const [t, l] of this.grantReach(g)) m.set(t, mx(get(m, t), l))
      this.grantCache.set(identity, m)
    }
    return m
  }
  private readonly foreignCache = new Map<string, Set<string>>()
  /**
   * 신원과 다른 SaaS 의 주체가 받은 권한으로만 닿는 대상(다른 SaaS 그룹, 주체에 소속돼 닿은 것). 신원 자신이나 같은 SaaS 주체가 받은 권한으로도
   * 닿으면 넣지 않는다. 신원이 다른 SaaS 대상에 직접 받은 권한(벤더가 적어 준 자격증명의 대상 등)도 넣지 않는다. 신원의 SaaS 를 모르면 비어 있다
   */
  foreignOnly(identity: string): ReadonlySet<string> {
    let s = this.foreignCache.get(identity)
    if (s) return s
    s = new Set()
    const own = new Set<string>()
    const idProvider = this.g.nodes[identity]?.provider
    if (idProvider) {
      for (const g of this.direct(identity).reached) {
        const holder = this.g.nodes[g.from]?.provider
        for (const [t] of this.grantReach(g)) (holder && holder !== idProvider ? s : own).add(t)
      }
      for (const t of own) s.delete(t)
    }
    this.foreignCache.set(identity, s)
    return s
  }
}

/** 사람(대표 키)마다 값. 사람이 아닌 키는 없음 */
export type PersonTable<V> = Pick<ReadonlyMap<string, V>, 'get'>

/** 물을 때 세어 담는 사람 표 */
function lazyTable<V>(people: readonly string[], make: (p: string) => V): PersonTable<V> {
  const keys = new Set(people)
  const m = new Map<string, V>()
  return {
    get: (p: string) => {
      if (!keys.has(p)) return undefined
      if (!m.has(p)) m.set(p, make(p))
      return m.get(p)
    },
  }
}

/** 계정들의 직접 권한(판정용). by: reached 와 같은 차례로 그 권한을 받은 계정. sure: 확정 수준. unknownAt: 그 대상에 「모름」 근거가 닿는가 */
interface Direct {
  reached: GrantView[]
  by: string[]
  sure: AccMap
  unknownAt(t: string): boolean
}

/** 범위 위 자원을 읽어 꺼내 쓸 수 있는 자격증명. 실물이 SaaS 밖에 있으면 못 꺼낸다 */
const extractable = (n: JudgeNode | undefined): boolean => !!n?.credential && !n.heldElsewhere

/** 수준 비트 → [읽기, 쓰기(2)/관리(3)] */
const accOf = (bits: number): Acc => [bits & READ_BIT ? 1 : 0, bits & ADMIN_BIT ? 3 : bits & WRITE_BIT ? 2 : 0]

/** 판정 그래프 간선 수준이 이 수준을 내나 */
const LEVEL_BITS: Record<Level, number> = { read: READ_BIT, write: READ_BIT | WRITE_BIT, admin: READ_BIT | WRITE_BIT | ADMIN_BIT, post: WRITE_BIT }
const DLEVEL_BIT: Record<DirectLevel, number> = { read: READ_BIT, write: WRITE_BIT, admin: ADMIN_BIT }

/** 노드 종류로 객체 종류(사례 시험). 테넌트는 없음 */
export function nodeClass(n: JudgeNode | undefined): ObjectClass | undefined {
  if (!n) return undefined
  if (n.dclass) return n.dclass === 'none' ? undefined : n.dclass
  switch (n.kind) {
    case 'res': return n.cls === 'content' ? 'content' : 'config'
    case 'group': case 'auto': return 'config'
    case 'person': case 'identity': return 'account'
    default: return undefined
  }
}

/** 판정 그래프를 직접 권한 펴기 입력으로. 실데이터 규칙(상한, 역할 제외, 테넌트 소속 계정)은 g.direct 가 준다 */
function directSourceOf(ix: Index): DirectSource {
  const g = ix.g
  const hooks = g.direct
  let n = 0
  const views = new Map<JudgeEdge, GrantView & { e: JudgeEdge }>()
  const view = (e: JudgeEdge) => {
    let v = views.get(e)
    if (!v) {
      v = {
        id: e.id ?? `~judge~${n++}`, from: e.from, to: e.to, ...(e.appliesTo?.length ? { appliesTo: e.appliesTo } : {}), ...(e.roleKey ? { roleKey: e.roleKey } : {}),
        uncertain: e.grantUnsure ?? [], source: e.source ?? 'config', known: e.known ?? !!e.level, ...(e.reach ? { reach: e.reach } : {}), e,
      }
      views.set(e, v)
    }
    return v
  }
  const nodeOf = (k: string) => g.nodes[k]
  return {
    memberOf: k => ix.outOf('소속', k).map(e => ({ id: e.id ?? '', to: e.to })),
    grantsOf: k => ix.outOf('권한', k).map(view),
    childrenOf: k => (ix.scopeChildren.get(k) ?? []).map(child => ({ id: '', child })),
    tenantAccounts: t => ix.inOf('소속', t).filter(e => (hooks ? hooks.tenantAccount(e.from) : nodeOf(e.from)?.kind === 'person' || nodeOf(e.from)?.kind === 'identity'))
      .map(e => ({ id: e.id ?? '', account: e.from })),
    provider: k => nodeOf(k)?.provider,
    type: k => nodeOf(k)?.type,
    isTenant: k => nodeOf(k)?.kind === 'tenant',
    objectClass: k => nodeClass(nodeOf(k)),
    roleExcluded: (role, m) => !!hooks?.roleExcluded(role, m),
    grantAt: (gv, x, lv, limit) => {
      const e = (gv as GrantView & { e: JudgeEdge }).e
      // 게시 전용(웹훅 게시, 폼 제출)은 읽기 없는 쓰기. 엔진 간선 능력과 상관없이 판정 어휘를 따른다
      if (e.level !== 'post' && hooks && e.id) {
        const r = hooks.grantAt(e, x, lv, limit)
        if (r !== null) return r
      }
      if (LEVEL_RANK[lv] > limit) return undefined
      return !e.level || LEVEL_BITS[e.level] & DLEVEL_BIT[lv] ? { reasons: [] } : undefined
    },
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

/** same, weak 값을 목록으로 */
export const others = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])



/** 연결 묶음마다 따로 판정한다. 묶음 사이에는 간선이 없어 결과가 같고, 사람마다 훑는 간선 수가 묶음 크기로 줄어든다 */
/**
 * persons: 이 계정들의 위협만 판정(차단 지점 확인용). 접속자 권한 차용이 있는 요소는 다른 호출자가 필요해 전원을 본다.
 * keepAll: 「한 경로에 한 건」 범위 묶기를 하지 않는다. 차단 지점 확인에서 아래 객체 판정이 위 객체 판정에 가려지지 않게
 */
/**
 * callers: 접속자 권한으로 도는 자동화마다 호출자(앞선 전체 판정의 결과). 주면 persons 만 판정해도 차용을 계산한다.
 * 간선을 지운 그래프에서는 실제 호출자보다 많을 수 있어, 틀려도 위협이 남는 쪽으로만 틀린다(차단 지점을 덜 확인할 뿐 더 확인하지 않음)
 */
export interface JudgeOptions {
  persons?: Set<string>
  keepAll?: boolean
  callers?: Map<string, Set<string>>
  /** 시험용. 노드와 간선을 정렬하지 않고 받은 차례로 본다. 파생 계산 자체가 계산 차례와 상관없는지 볼 때 쓴다 */
  keepOrder?: boolean
  /**
   * 차단 지점 확인용. 위협 행만 쓰고 추적성 상실은 세지 않는다(trace 는 빈 목록). 사람마다 직접 권한은 물을 때 센다.
   * persons 와 함께 쓰면 판정할 사람과 그 판정이 묻는 사람(접속자 권한 호출자, 약한 연결 사람)의 직접 권한만 센다. 위협 행은 이 값이 없을 때와 같다
   */
  threatsOnly?: boolean
  /** 차단 지점 확인용. 직접 권한이 읽는 간선(소속, 권한, 범위)이 이 그래프와 같은 그래프의 색인(Index 의 direct) */
  directFrom?: Index
}

export interface JudgeResult {
  threats: JudgedThreat[]
  trace: JudgedTrace[]
  /** 접속자 권한으로 도는 자동화마다 호출자(대표 계정 키) */
  callers: Map<string, Set<string>>
  /** 관리자 신뢰, 승인으로 위협에서 뺀 행. Access Gap 벤에 제외 이유를 달아 보인다 */
  excluded: JudgedThreat[]
  /**
   * 대상 하나의 사람마다 직접 권한(누구나 공유를 뺀 확정 직접 권한). Access Gap 직접 권한 원.
   * 물을 때 센다. 대상 전부를 미리 펴면 큰 조직에서 사람 수 곱하기 대상 수만큼 쌓인다
   */
  holders(t: string): ReadonlyMap<string, Acc> | undefined
  /** holders 의 사람 하나가 대상에 직접 권한을 받은 계정(Access Gap 벤 사람의 직접 권한 계정). 물을 때 센다 */
  holderAccounts(p: string, t: string): string[]
  /** 대상 하나에 이 연동 지점으로 새로 생긴 권한 없이 파생 접근이 닿는 사람. Access Gap 파생 접근 원. 물을 때 센다 */
  reach(t: string, point: string): readonly JudgedReach[] | undefined
  /**
   * 계정 하나가 대상에 그 수준 이상의 파생 접근을 갖는가(사건 기록 대조, v2/engine/usage.ts). 없으면 undefined.
   * 사람 계정은 같은 사람의 파생 접근(확정 표에 있으면 sure). 자동화는 고정 실행 신원이 가진 권한(자동화가 자기 신원으로 한 일).
   * hops: 그 수준을 준 길(사람은 lead 와 마지막 단계 간선, 자동화는 실행 신원과 권한 간선)
   */
  derivedAt(account: string, cap: 'read' | 'write' | 'admin', t: string): DerivedAnswer | undefined
  /** 사람마다 직접 권한이나 파생 접근이 닿는 모든 대상(게시 접근 표). 물을 때 센다. 차단 지점 확인처럼 일부 사람만 판정한 결과에는 쓰지 않는다 */
  access(): JudgedAccess[]
  /** 사람(대표 계정 키)의 계정. 같은 사람 묶음(4절) 전부, 키 순. 사람이 아니면 그 키 하나 */
  accountsOf(p: string): readonly string[]
}

/** JudgeResult.derivedAt 의 답 */
export interface DerivedAnswer {
  sure: boolean
  hops: Hop[]
  /**
   * 그 수준을 준 판정 행의 연동 지점과 사람(대표 키). 판정 행(JudgedThreat)의 point, person 과 같다.
   * 자동화는 person 없이 point 가 자기 키(추적성 상실의 identity). 사건 기록이 위협 「발생」을 정할 때 쓴다(scripts/loader/engine.ts occurredOf)
   */
  point: string
  person?: string
}

const cmpStr = (a: string | undefined, b: string | undefined): number => { const x = a ?? '', y = b ?? ''; return x < y ? -1 : x > y ? 1 : 0 }
/** 간선의 정해진 순서. 종류, 출발, 도착, 옮기는 자동화, 수준, 필요 수준, 실행 방식이 같으면 간선 전체 */
const edgeCmp = (a: JudgeEdge, b: JudgeEdge): number =>
  cmpStr(a.kind, b.kind) || cmpStr(a.from, b.from) || cmpStr(a.to, b.to) || cmpStr(a.via, b.via) || cmpStr(a.level, b.level) ||
  cmpStr(a.need, b.need) || cmpStr(a.mode, b.mode) || (a === b ? 0 : cmpStr(JSON.stringify(a), JSON.stringify(b)))

/**
 * 간선을 정해진 순서로 둔다. 이미 그 순서면 그대로 돌려준다.
 * 유형, 확실성, 이유, hops 는 계산 차례와 상관없게 고르지만, 경로 앞부분(lead)은 조건을 처음 세운 단계를 따라 계산 차례를 탄다.
 * 판정이 간선과 노드를 이 순서로 보면 같은 그래프는 입력 순서와 상관없이 같은 경로를 낸다(#443 5단계)
 */
export function sortEdges(edges: JudgeEdge[]): JudgeEdge[] {
  for (let i = 1; i < edges.length; i++) if (edgeCmp(edges[i - 1], edges[i]) > 0) return [...edges].sort(edgeCmp)
  return edges
}

export function judge(g: JudgeGraph, opts: JudgeOptions = {}): JudgeResult {
  // 입력 순서와 상관없게 노드는 키 순, 간선은 sortEdges 순으로 본다
  const keys = opts.keepOrder ? Object.keys(g.nodes) : Object.keys(g.nodes).sort()
  const edges = opts.keepOrder ? g.edges : sortEdges(g.edges)
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    let c = x
    while (c !== r) { const n = parent.get(c)!; parent.set(c, r); c = n }
    return r
  }
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  for (const k of keys) parent.set(k, k)
  const link = (a: string, b: string) => { if (parent.has(a) && parent.has(b)) union(a, b) }
  for (const e of edges) {
    link(e.from, e.to)
    if (e.via) link(e.from, e.via)
    for (const p of e.gate ?? []) link(e.from, p)
  }
  for (const k of keys) {
    const n = g.nodes[k]
    for (const q of others(n.same)) link(k, q)
    for (const q of others(n.weak)) link(k, q)
  }
  const parts = new Map<string, JudgeGraph>()
  for (const k of keys) {
    const r = find(k)
    if (!parts.has(r)) parts.set(r, { nodes: {}, edges: [], ...(g.direct ? { direct: g.direct } : {}), ...(g.logged ? { logged: g.logged } : {}) })
    parts.get(r)!.nodes[k] = g.nodes[k]
  }
  for (const e of edges) if (parent.has(e.from)) parts.get(find(e.from))!.edges.push(e)
  const threats: JudgedThreat[] = []
  const trace: JudgedTrace[] = []
  const callers = new Map<string, Set<string>>()
  const excluded: JudgedThreat[] = []
  /** 대상이 든 묶음의 판정. Access Gap 원천을 물을 때 그 묶음에 묻는다 */
  const compOf = new Map<string, JudgeResult>()
  const comps: JudgeResult[] = []
  /** 사람이 없는 묶음. 판정할 위협은 없지만 자동화의 파생 접근은 묻는다(사건 기록 대조). 물을 때 색인을 한 번 만든다 */
  const autoOnly = new Map<string, JudgeGraph>()
  const autoIx = new Map<JudgeGraph, Index>()
  for (const part of parts.values()) {
    if (!Object.values(part.nodes).some(n => n.kind === 'person')) {
      for (const k of Object.keys(part.nodes)) if (part.nodes[k].kind === 'auto') autoOnly.set(k, part)
      continue
    }
    const r = judgeComponent(part, opts)
    comps.push(r)
    // 결과가 수십만 건이면 push(...) 가 인자 수 한도를 넘는다(#405)
    for (const t of r.threats) threats.push(t)
    for (const t of r.trace) trace.push(t)
    for (const [a, qs] of r.callers) callers.set(a, qs)
    for (const t of r.excluded) excluded.push(t)
    for (const k of Object.keys(part.nodes)) compOf.set(k, r)
  }
  // 파생 계산 차례와 상관없게 사람, 대상, 유형, 확실성 순으로 둔다(게시 위협 순서가 이 순서를 따른다)
  const key = (t: JudgedThreat) => `${t.person}\u0001${t.target}\u0001${t.types.join('+')}\u0001${t.certainty}`
  const order = (xs: JudgedThreat[]) => xs.map(t => [key(t), t] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(x => x[1])
  return {
    threats: order(threats), trace, callers, excluded: order(excluded),
    holders: t => compOf.get(t)?.holders(t), holderAccounts: (p, t) => compOf.get(t)?.holderAccounts(p, t) ?? [], reach: (t, point) => compOf.get(t)?.reach(t, point),
    derivedAt: (account, cap, t) => {
      const r = compOf.get(account)
      if (r) return r.derivedAt(account, cap, t)
      const part = autoOnly.get(account)
      if (!part) return undefined
      let ix = autoIx.get(part)
      if (!ix) autoIx.set(part, (ix = new Index(part)))
      return autoDerivedAt(ix, account, cap, t)
    },
    access: () => {
      const out: JudgedAccess[] = []
      for (const r of comps) for (const a of r.access()) out.push(a)
      return out
    },
    accountsOf: p => compOf.get(p)?.accountsOf(p) ?? [p],
  }
}

function judgeComponent(g: JudgeGraph, opts: JudgeOptions): JudgeResult {
  const ix = new Index(g, opts.directFrom)
  const node = (k: string): JudgeNode | undefined => g.nodes[k]
  const accounts = Object.keys(g.nodes).filter(k => g.nodes[k].kind === 'person').sort()

  // 같은 사람(4절): 단단한 연결로 이어진 계정 묶음을 한 사람으로 판정한다. 연결은 대칭, 이행으로 본다.
  // 대표는 허브 계정(Link 를 시작한 IdP, 메일 디렉터리 계정) 가운데 가장 작은 키, 허브가 없으면 가장 작은 키다.
  // 키 순서만 보면 새 SaaS 가 붙을 때 그 계정 키가 앞서면 대표가 바뀌어, 다른 SaaS 의 접근 표와 위협의 사람 키까지 바뀐다
  const up = new Map(accounts.map(k => [k, k]))
  const root = (x: string): string => { let r = x; while (up.get(r) !== r) r = up.get(r)!; return r }
  const before = (a: string, b: string): boolean => {
    const ha = node(a)!.hub === true, hb = node(b)!.hub === true
    return ha !== hb ? ha : a < b
  }
  for (const k of accounts) for (const q of others(node(k)!.same)) {
    if (!up.has(q)) continue
    const a = root(k), b = root(q)
    if (a !== b) { const [win, lose] = before(a, b) ? [a, b] : [b, a]; up.set(lose, win) }
  }
  const rep = new Map(accounts.map(k => [k, root(k)]))
  const members = new Map<string, string[]>()
  for (const k of accounts) push(members, rep.get(k)!, k)
  const P = [...members.keys()]
  const accountsOf = (p: string) => members.get(p) ?? [p]
  const isMember = (p: string, k: string) => rep.get(k) === p
  /** 약하게 이어진 다른 사람(대표 키) */
  const weakOf = new Map(P.map(p => [p, [...new Set(accountsOf(p).flatMap(k => others(node(k)!.weak))
    .filter(q => rep.has(q)).map(q => rep.get(q)!))].filter(q => q !== p).sort()]))

  const autos = Object.keys(g.nodes).filter(k => g.nodes[k].kind === 'auto')
  const borrowing = g.edges.some(e => e.kind === '실행 신원' && e.mode === 'caller')
  const only = opts.persons
  /** 파생 접근과 분류를 계산할 사람. 접속자 권한 차용이 있으면 다른 호출자도 필요해 전원. 호출자를 받았으면 그 사람들만 */
  const PJ = only && (!borrowing || opts.callers) ? P.filter(p => accountsOf(p).some(k => only.has(k))) : P

  // 직접 권한(directAccess.ts): 같은 사람의 모든 계정이 소속, 권한, 범위로 닿는 곳. 확정 근거만 넣는다.
  // 수준 모르는 권한, 불확실 간선, 상한을 확인 못 한 권한은 「모름」이라 넣지 않고, 거기 닿는 판정은 아래에서 미확정(8절 「모름」).
  // 누구나 공유는 모든 사람의 직접 권한이다(공개 문서). 조직 밖 수신자 판정은 누구나 노드가 따로 낸다(Dself)
  // 사람 키는 대표 계정 키라 계정 하나짜리 신원 키와 겹칠 수 있다. 사람은 따로 담는다
  // 전체 판정은 사람 순서대로 미리 센다. 차단 지점 확인(threatsOnly)은 다시 판정마다 판정할 몇 사람만 보므로 물을 때 센다
  const table = <V>(make: (p: string) => V): PersonTable<V> => (opts.threatsOnly ? lazyTable(P, make) : new Map(P.map(p => [p, make(p)])))
  const DP = table<Direct>(p => ix.direct(`person~${p}`, accountsOf(p)))
  const everyone = EVERYONE in g.nodes ? (DP.get(EVERYONE) ?? ix.direct(EVERYONE)) : undefined
  const DE: AccMap = everyone?.sure ?? new Map()
  const Dself = table<AccMap>(p => DP.get(p)!.sure)
  const D = table<AccMap>(p => {
    const own = Dself.get(p)!
    if (!DE.size || p === EVERYONE) return own
    const m = new Map(own)
    // 누구나 공유는 읽기만 합친다(공개 문서). 누구나 게시(폼 제출)를 쓰기로 합치면 파생으로 얻은 진짜 편집이 새 쓰기로 안 잡힌다
    for (const [t, l] of DE) if (l[0]) m.set(t, mx(get(m, t), [l[0], 0]))
    return m
  })
  /**
   * 관리자 신뢰(2026-11-16 결정): 테넌트에서 설정 관리까지 받은 관리자가 그 SaaS 안에서 얻는 파생 접근은 위협이 아니다.
   * 관리자는 원래 못 보는 데이터를 보거나 못 가는 길을 쓰는 나쁜 짓을 하지 않는다고 본다. 다른 SaaS 대상은 그대로 본다. 추적성 상실은 그대로.
   * 관리자: 테넌트 권한 간선이 설정 객체까지 관리로 내려가고(테넌트 범위 문턱) 그 권한이 확정. 채널, 저장소 같은 그릇 관리자는 일반 사용자
   */
  const trustMemo = new Map<string, string[]>()
  const adminTenants = (p: string): string[] => {
    let ts = trustMemo.get(p)
    if (ts) return ts
    ts = []
    for (const gv of DP.get(p)!.reached) {
      if (node(gv.to)?.kind !== 'tenant' || grantUnsure(gv) || (gv.reach?.config ?? Infinity) < LEVEL_RANK.admin) continue
      const r = spreadOf(ix.src, gv).get(gv.to)
      if (r && !r.reasons.length && r.bits & ADMIN_BIT) ts.push(gv.to)
    }
    trustMemo.set(p, (ts = [...new Set(ts)]))
    return ts
  }
  const tenantMembers = new Map<string, Set<string>>()
  const membersOf = (a: string) => tenantMembers.get(a) ?? tenantMembers.set(a, new Set(ix.inOf('소속', a).map(e => e.from))).get(a)!
  /** 테넌트 아래 같은 SaaS 객체. 하위 테넌트로는 내려가지 않는다(직접 권한과 같은 경계) */
  const ownDesc = new Map<string, Set<string>>()
  const tenantDesc = (a: string): Set<string> => {
    let d = ownDesc.get(a)
    if (d) return d
    d = new Set([a])
    const st = [a]
    while (st.length) for (const c of ix.scopeChildren.get(st.pop()!) ?? []) {
      if (d.has(c) || node(c)?.kind === 'tenant' || node(c)?.provider !== node(a)?.provider) continue
      d.add(c); st.push(c)
    }
    ownDesc.set(a, d)
    return d
  }
  /** 조직 안 관리자만. 조직 밖 사람의 판정은 관리자여도 그대로 */
  const trusted = (p: string, t: string): boolean => boundary(p) === 'in' && adminTenants(p).some(a => node(a)?.provider === node(t)?.provider &&
    (tenantDesc(a).has(t) || membersOf(a).has(t)))

  /** 직접 수준을 모르는 대상인가 */
  const unknownD = (p: string, t: string) => !!DP.get(p)?.unknownAt(t) || !!everyone?.unknownAt(t)

  // 파생 접근(derived.ts): 사람마다 파생 수준, 판정 이유와 연동 지점, 호출자
  const { tables, cellOf, dvAt, column, inv, idgrant, lead: leadOf, chain: chainOf, stepHops } = derivedAccess({ g, ix, PJ, autos, accountsOf, isMember, Dself, callers: opts.callers })

  const accountBoundary = (k: string): Boundary => {
    const nd = node(k)!
    let org = nd.org ?? 'in'
    if (nd.guest) org = 'out'
    if ('domain_owned_tenant' in nd) org = nd.domain_owned_tenant ? 'in' : 'out'
    return org
  }
  /** 같은 사람 계정 중 하나라도 조직 안이면 조직 안 사람. 아니면 모름이 하나라도 있으면 모름 */
  const boundary = (p: string): Boundary => {
    const bs = accountsOf(p).map(accountBoundary)
    return bs.includes('in') ? 'in' : bs.includes('unknown') ? 'unknown' : 'out'
  }

  /** 승인 범위(승인 목록에 있는 조직 밖 사람의 기준선). 승인은 읽기만 가린다(사례 N20, 2026-11-18 결정) */
  const APPROVED_SCOPE: Acc = [1, 0]
  const allowedOf = (p: string): Acc => (accountsOf(p).some(k => node(k)!.approved !== undefined) ? APPROVED_SCOPE : Z)
  /**
   * 조직 밖 사람의 직접 공유(누구나 공유를 뺀 확정 직접 권한). 읽기 없는 게시도 넣는다(쓰기 차원의 유형만).
   * 누구나 노드의 읽기 없는 게시(공개 폼 응답)는 넣지 않는다(2026-11-18 결정)
   */
  const shareOf = (p: string, t: string): Acc => { const s = get(Dself.get(p), t); return p === EVERYONE && s[0] < 1 ? Z : s }
  const lower = (a: Acc, b: Acc): Acc => [Math.min(a[0], b[0]), Math.min(a[1], b[1])]
  /**
   * Access Gap 대상 분류. 본인 객체(같은 사람 계정에 딸린 객체, 1절), 조직 밖 객체, 분류 없는 노드는 대상이 아니다.
   * 계정과 그룹, 신원은 제어 객체(규칙 3). 다른 사람 계정도 제어 객체지만 읽기는 프로필 내용(profile). 같은 사람 계정은 뺀다.
   * 약하게 이어진 사람 계정은 조직 안 사람만 뺀다. 조직 밖 계정은 직원 계정과 이어져도 같은 사람으로 보지 않아 그 직원 프로필을 읽으면 비인가 접근(2026-11-18 결정)
   */
  const gapClass = (p: string, t: string, own: (k: string) => boolean): { cls: 'content' | 'control'; profile: boolean } | undefined => {
    const tn = node(t)
    if (!tn || tn.org === 'out' || (tn.owner && own(tn.owner))) return undefined
    const profile = tn.kind === 'person' && !own(t) && (boundary(p) !== 'in' || !weakOf.get(p)!.includes(rep.get(t) ?? t))
    const cls = tn.kind === 'res' ? tn.cls : tn.kind === 'group' || tn.kind === 'identity' || profile ? 'control' : undefined
    return cls ? { cls, profile } : undefined
  }
  /**
   * Access Gap 한 줄(8절 「Access Gap」, 2026-11-18 결정). 유형은 이 줄만 읽고 가른다(typesOf).
   * base 기준선: 조직 안은 직접 권한 D(누구나 공유 읽기 포함). 조직 밖은 승인 목록 밖이면 없음(사내에 공유할 수 있는 권한이 밖에 공유해도 된다는 뜻은 아님),
   *   승인 목록 안이면 승인 범위(읽기). 조직 경계 모름은 조직 밖으로 본다
   * have, haveSure: 기준선과 비교할 가진 접근(전체 표, 확정 표). 조직 안은 파생 접근. 조직 밖은 직접 공유와 파생 접근 중 높은 것
   * share: 조직 밖 사람의 직접 공유 수준(조직 안은 없음). held: 벤에 보이는 직접 수준(조직 밖은 직접 공유 가운데 기준선 안)
   * open: 공개 의도 등록. hides: 제어 객체 아래 기준선으로 못 읽는 내용 객체가 있는가(관리를 얻으면 자기를 구성원으로 넣어 읽음). 물을 때 센다
   */
  type Gap = { t: string; cls: 'content' | 'control'; profile: boolean; open: boolean; base: Acc; held: Acc; share: Acc; have: Acc; haveSure: Acc; hides: () => boolean }
  /**
   * 사람 하나의 Access Gap 줄. Dp: 조직 안 사람의 기준선(같은 사람 후보를 합쳐 재검사할 때는 합친 표).
   * also: 같은 사람이라고 가정해 보는 다른 사람(대표 키). 그 사람 계정과 거기 딸린 객체도 본인 것으로 본다. only: 이 대상만 본다
   */
  const gapsOf = (p: string, Dp: AccMap, also: ReadonlySet<string> = new Set(), only?: ReadonlySet<string>): Gap[] => {
    const inside = boundary(p) === 'in'
    // 그 사람의 표 전체를 한 번 합쳐 쓴다(파생 표 묶음 참조)
    const { dv, dvs } = tables(p)!
    const own = (k: string) => isMember(p, k) || also.has(rep.get(k) ?? k)
    const allowed = inside ? Z : allowedOf(p)
    const out: Gap[] = []
    const scan = (t: string) => {
      if (only && !only.has(t)) return
      const c = gapClass(p, t, own)
      if (!c) return
      const v = get(dv, t)
      const vs = get(dvs, t)
      const open = !!node(t)!.public_by_design
      // 조직 밖 사람의 기준선은 승인 범위라 승인 목록 안이면 아래 내용도 기준선으로 읽는다
      const hides = () => allowed[0] < 1 && [...ix.descCached(t)].some(x => x !== t && node(x)?.cls === 'content' && !node(x)?.public_by_design && get(Dp, x)[0] < 1)
      if (inside) {
        const d = get(Dp, t)
        out.push({ t, ...c, open, base: d, held: d, share: Z, have: v, haveSure: vs, hides })
        return
      }
      const share = shareOf(p, t)
      out.push({ t, ...c, open, base: allowed, held: lower(share, allowed), share, have: mx(share, v), haveSure: mx(share, vs), hides })
    }
    for (const t of dv.keys()) scan(t)
    // 조직 밖 사람은 직접 공유로만 닿는 대상도 본다. 누구나 공유는 누구나 노드가 낸다(Dself 에 없음)
    if (!inside) for (const t of Dself.get(p)!.keys()) if (!dv.has(t)) scan(t)
    return out
  }
  /**
   * 유형 규칙(5절 규칙 4, 5, aegi-knowledge threat_types.yaml, 2026-11-19 결정). Access Gap 한 줄의 기준선과 가진 접근 수준 v 만 읽는다.
   * r, w: 읽기 경로, 쓰기 이상 경로의 유형. hid: 제어 객체 관리를 새로 얻고 그 아래 기준선으로 못 읽던 내용이 있다(관리를 얻으면 자기를 구성원으로 넣어 읽음).
   * 기준선에 읽기, 쓰기, 관리가 모두 없으면 비인가 접근, 있으면 권한 상승(게시 전용만 있던 사람이 읽기를 얻어도, 승인 목록의 조직 밖 사람이 승인 범위를 넘어도). 조직 안과 밖이 같다.
   * 내용 객체와 다른 사람 프로필은 새 읽기부터 센다(조직 밖 사람이 공개 의도 등록을 읽는 것은 뺌). 새 쓰기, 새 관리는 대상과 상관없이 센다.
   * hid 면 쓰기 이상 경로에 비인가 접근도 붙인다. 조직 밖 목적지에 닿는 데이터 흐름으로 얻은 읽기의 데이터 반출은 classify 가 가른다(outFlow)
   */
  const typesOf = (inside: boolean, g: Gap, v: Acc): { r: string[]; w: string[]; hid: boolean } => {
    const d = g.base
    const newR = d[0] < 1 && v[0] >= 1
    const newW = d[1] < 2 && v[1] >= 2
    const newA = d[1] < 3 && v[1] >= 3
    const kind = d[0] < 1 && d[1] < 2 ? UNAUTH : ESCALATE
    const hid = g.cls === 'control' && newA && g.hides()
    const r = (g.cls === 'content' || g.profile) && (inside || !g.open) && newR ? [kind] : []
    const w = newW || newA ? [...new Set([kind, ...(hid ? [UNAUTH] : [])])] : []
    return { r, w, hid }
  }
  /**
   * 그 읽기가 조직 밖 목적지에 닿는 데이터 흐름으로 왔는가. 읽기를 준 마지막 단계가 데이터 흐름이고, 그 단계부터 끊기지 않고 이어지는
   * 데이터 흐름 단계(자동화를 거쳐 여러 번 흐르는 것) 가운데 사본 쪽이 조직 밖인 것이 있다. 앞에 다른 단계(자격증명 꺼내 쓰기 등)를 거친
   * 흐름은 그 데이터의 흐름이 아니라 보지 않는다. f: 그 읽기의 판정 이유, sure: 확정 표
   */
  const outFlow = (p: string, f: Set<string> | undefined, sure: boolean): boolean => {
    const st = stepOf(f)
    return st?.kind === '데이터 흐름' && flowRun(chainOf(p, st, sure).steps).some(outStep)
  }
  /** 사슬 첫 단계(판정 단계)부터 끊기지 않고 이어지는 데이터 흐름 단계 */
  const flowRun = (steps: readonly Step[]): Step[] => {
    const run: Step[] = []
    for (const s of steps) { if (s.kind !== '데이터 흐름') break; run.push(s) }
    return run
  }
  /** 사본 쪽이 조직 밖인 데이터 흐름 단계 */
  const outStep = (s: Step) => s.kind === '데이터 흐름' && node(s.at)?.org === 'out'
  /**
   * 데이터 반출 판정 줄의 조직 밖으로 가는 흐름에 전송 기록이 있는가. 같은 두 끝의 데이터 흐름 간선 가운데 하나라도 기록이 있으면.
   * 흐름 자체가 추정인 간선(불확실, 입력 추정 등)은 사건 기록이 있어도 전송 기록으로 세지 않는다(2026-11-19 결정)
   */
  const sentOf = (th: ThreatRow): Pick<JudgedThreat, 'sent'> => {
    if (!baseTypes([th.label]).includes(EXFIL)) return {}
    // 읽기와 쓰기가 다른 단계에서 와 합친 줄은 두 단계를 다 본다
    const hit = [th.st, th.so].some(st => !!st && flowRun(chainOf(th.p, st, th.sure).steps).some(s => outStep(s) && !!s.edge && ix.outOf('데이터 흐름', s.edge.from).some(e => e.to === s.edge!.to && e.observed && !e.uncertain?.length)))
    return hit ? { sent: true } : {}
  }

  /** dim: 그 판정이 읽기(r), 쓰기 이상(w), 둘 다(rw)의 경로에서 왔는지 */
  /** got: 이 판정을 준 가진 접근 수준(그 행의 차원만), base: Access Gap 기준선, dl: 벤에 보이는 직접 수준, sh: 그 행 차원의 직접 공유 수준(조직 밖) */
  /** ex: 승인으로 위협에서 뺀 행, st: 이 판정의 수준을 준 마지막 파생 단계(경로 복원), sure: 확정 표의 행 */
  /** so: 읽기와 쓰기가 다른 단계에서 와 합친 rw 행에서 경로(st)로 고르지 않은 다른 단계. 심각도 가능성 신호는 두 단계를 다 본다 */
  /** parts: rw 행을 이룬 읽기 행과 쓰기 행. 같은 사람 후보로 한 차원만 사라지면(demote) 그 차원의 행으로 나눈다 */
  type Row = { t: string; ty: string[]; f: Set<string>; dim: 'r' | 'w' | 'rw'; got: Acc; base: Acc; dl: Acc; sh: Acc; ex?: '승인됨'; st?: Step; so?: Step; sure: boolean; parts?: [Row, Row] }
  /** 쓰기 이상 차원을 가진 행(rw 행은 그 쓰기 행도). 사유 「관리」, 「아래 내용 읽기」를 단다 */
  const writeRows = (rows: Row[]): Row[] => rows.flatMap(r => (r.dim === 'w' ? [r] : r.dim === 'rw' ? [r, r.parts![1]] : []))
  const pointOf = (f: Set<string> | undefined) => [...(f ?? [])].find(x => x.startsWith('@'))
  /**
   * 읽기와 쓰기 판정이 같은 연동 지점, 같은 확실성이면 한 건, 아니면 두 건. der: 그 표의 파생 접근 수준.
   * 직접 공유가 그 차원의 가장 높은 수준을 주면 대상 자신이 연동 지점(직접 공유). 아니면 파생 경로의 이유와 연동 지점.
   * 읽기 행은 읽기 수준만, 쓰기 행은 쓰기 차원만 싣는다. 두 차원이 다른 연동 지점에서 오면 각 벤은 자기 지점의 수준만 본다
   */
  /** 차원마다 가장 높은 수준을 준 경로(직접 공유면 대상 자신이 연동 지점). 읽기 없는 직접 공유 쓰기는 게시 전용. der: 그 표의 파생 접근 수준 */
  const srcOf = (g: Gap, fl: FlagMaps, der: Acc) => {
    const sR = g.share[0] >= 1 && g.share[0] >= der[0]
    const sW = g.share[1] >= 2 && g.share[1] >= der[1]
    const shared = (post = false) => new Set(['직접 공유', ...(post ? [POST_ONLY] : []), `@${g.t}`])
    const fR = sR ? shared() : fl.r.get(g.t) ?? new Set<string>()
    const fW = sW ? shared(g.share[0] < 1) : fl.w.get(g.t) ?? new Set<string>()
    return { sR, sW, fR, fW }
  }
  const rowsOf = (g: Gap, tyR: string[], tyW: string[], fl: FlagMaps, der: Acc, sure: boolean): Row[] => {
    const { t } = g
    const got = mx(g.share, der)
    const { sR, sW, fR, fW } = srcOf(g, fl, der)
    const sh: Acc = [sR ? g.share[0] : 0, sW ? g.share[1] : 0]
    const at = { base: g.base, dl: g.held, sure }
    const rRow: Row = { t, ty: tyR, f: new Set(fR), dim: 'r', got: [got[0], 0], sh: [sh[0], 0], ...at, st: stepOf(fR) }
    const wRow: Row = { t, ty: tyW, f: new Set(fW), dim: 'w', got: [0, got[1]], sh: [0, sh[1]], ...at, st: stepOf(fW) }
    if (tyR.length && tyW.length && pointOf(fR) === pointOf(fW) && unsure(fR) === unsure(fW)) {
      const st = firstStep(rRow.st, wRow.st)
      return [{ t, ty: [...new Set([...tyR, ...tyW])], f: new Set([...fR, ...fW]), dim: 'rw', got, sh, ...at, st, so: st === wRow.st ? rRow.st : wRow.st, parts: [rRow, wRow] }]
    }
    return [...(tyR.length ? [rRow] : []), ...(tyW.length ? [wRow] : [])]
  }
  /**
   * Access Gap 줄(gapsOf)을 유형 규칙(typesOf)으로 가른다. 판정 행은 Access Gap 값(기준선, 가진 접근, 직접 공유)을 그대로 싣는다.
   * also, only: gapsOf 와 같다
   */
  const classify = (p: string, Dp: AccMap, also?: ReadonlySet<string>, only?: ReadonlySet<string>): Row[] => {
    const res: Row[] = []
    const org = boundary(p)
    const inside = org === 'in'
    const approved = !inside && allowedOf(p) === APPROVED_SCOPE
    const { dv, dvs, fl, fls } = tables(p)!
    for (const g of gapsOf(p, Dp, also, only)) {
      const v = get(dv, g.t)
      const vs = get(dvs, g.t)
      // 확정 표로 서는 유형은 확정 경로의 이유로 내고, 전체 표에서만 서는 유형은 모름 경로의 이유로 낸다(미확정)
      const s = typesOf(inside, g, g.haveSure)
      const a = eq(g.haveSure, g.have) ? s : typesOf(inside, g, g.have)
      // 조직 밖 목적지에 닿는 데이터 흐름으로 얻은 읽기는 데이터 반출. 받는 사람에게 그 읽기의 비인가 접근, 권한 상승을 붙이지 않는다.
      // 공개 의도로 등록한 내용은 밖으로 흘러도 누가 읽든 데이터 반출이 아니다(2026-11-19 결정)
      const sR = s.r.length && !g.open && outFlow(p, srcOf(g, fls, vs).fR, true) ? [EXFIL] : s.r
      const aR = a.r.length && !g.open && outFlow(p, srcOf(g, fl, v).fR, false) ? [EXFIL] : a.r
      const sure = rowsOf(g, sR, s.w, fls, vs, true)
      // 미확정 경로에서만 서는 유형. 「아래 내용 읽기」는 확정 쓰기 판정과 이름이 같아도(비인가 접근) 미확정 경로에서만 서면 따로 낸다
      const more = rowsOf(g, aR.filter(x => !sR.includes(x)), a.w.filter(x => !s.w.includes(x) || (x === UNAUTH && a.hid && !s.hid)), fl, v, false)
      // 관리 수준을 새로 얻은 쓰기 판정은 사유 「관리」(판정 수준 관리). 확정 판정은 확정 수준으로 가른다
      const admin = (rows: Row[], lv: Acc) => { if (lv[1] >= 3 && g.base[1] < 3) for (const r of writeRows(rows)) r.f.add(ADMIN) }
      admin(sure, g.haveSure)
      admin(more, g.have)
      // 제어 객체 관리로 그 아래 못 읽던 내용을 읽게 된 비인가 접근은 사유 「아래 내용 읽기」(심각도 영향 기밀성)
      const hidden = (rows: Row[], on: boolean) => { if (on) for (const r of writeRows(rows)) if (r.ty.includes(UNAUTH)) r.f.add(HIDDEN) }
      hidden(sure, s.hid)
      hidden(more, a.hid)
      res.push(...sure, ...more)
      // 승인 범위 안의 읽기는 위협이 아니다. 기준선이 없을 때 서는 읽기 유형을 승인됨으로 Access Gap 벤에 남긴다
      // 조직 밖 목적지에 닿는 데이터 흐름으로 얻은 읽기는 위협 판정과 같이 데이터 반출로 남긴다
      if (approved) {
        const g0 = { ...g, base: Z }
        const eS0 = typesOf(false, g0, g.haveSure).r
        const eS = eS0.length && !g.open && outFlow(p, srcOf(g0, fls, vs).fR, true) ? [EXFIL] : eS0
        const eA0 = typesOf(false, g0, g.have).r
        const eA = eA0.length && !g.open && outFlow(p, srcOf(g0, fl, v).fR, false) ? [EXFIL] : eA0
        const ex = eS.length ? rowsOf(g0, eS, [], fls, vs, true) : rowsOf(g0, eA, [], fl, v, false)
        for (const r of ex) res.push({ ...r, ex: '승인됨' })
      }
    }
    // 받는 쪽 조직 경계를 모르면 유형 전체를 미확정으로 두고 사유를 남긴다
    return org === 'unknown' ? res.map(r => ({ ...r, ty: [`미확정:${labelOf(r.ty)}`], f: new Set([...r.f, '조직 경계 모름']) })) : res
  }

  /**
   * 같은 사람일 수도 있는 사람(also)의 직접 권한을 기준선에 합친 Access Gap 으로 다시 판정한다. 새 접근이 남는 차원(읽기, 쓰기 이상)은 그대로,
   * 사라지는 차원은 미확정(flag). 대상만이 아니라 차원마다 본다. 같은 대상에 쓰기가 남아도 이미 읽던 대상의 읽기는 사라진다.
   * 합친 기준선에서 유형만 바뀌고(비인가 접근이 권한 상승으로) 새 접근이 남으면 그대로 둔다. 유형은 그 사람 기준선대로(2026-11-19 결정). 조직 안 사람만 부른다.
   * 「아래 내용 읽기」도 차원처럼 본다(h). 합친 기준선으로 아래 내용을 이미 읽으면 쓰기 줄은 그 사유 없이 확정, 아래 내용 읽기는 미확정 비인가 접근(2026-11-19 결정)
   */
  const demote = (p: string, rows: Row[], also: string[], flag: string): Row[] => {
    if (!also.length || !rows.length) return rows
    const Dm = new MaxView([D.get(p)!, ...also.map(q => D.get(q)!)])
    const kept = new Map<string, Set<'r' | 'w' | 'h'>>()
    for (const r of classify(p, Dm, new Set(also), new Set(rows.map(r => r.t)))) if (!r.ex) {
      let k = kept.get(r.t)
      if (!k) kept.set(r.t, (k = new Set()))
      for (const d of DIMS[r.dim]) k.add(d)
      if (r.f.has(HIDDEN)) k.add('h')
    }
    const unsureOf = (r: Row): Row => ({ ...r, ty: [`미확정:${labelOf(r.ty)}`], f: new Set([...r.f, flag]) })
    return rows.flatMap(r => {
      const lost = DIMS[r.dim].filter(d => !kept.get(r.t)?.has(d))
      if (!lost.length) return [r]
      if (r.ty.some(x => x.startsWith('미확정'))) return [{ ...r, f: new Set([...r.f, flag]) }]
      // 읽기와 쓰기가 합쳐진 줄에서 한 차원만 사라지면 남는 차원의 줄과 사라진 차원의 미확정 줄로 나눈다
      if (lost.length < DIMS[r.dim].length) {
        const [rRow, wRow] = r.parts!
        return lost[0] === 'r' ? [wRow, unsureOf(rRow)] : [rRow, unsureOf(wRow)]
      }
      return [unsureOf(r)]
    }).flatMap(r => {
      if (!r.f.has(HIDDEN) || kept.get(r.t)?.has('h') || r.ty.some(x => x.startsWith('미확정'))) return [r]
      // 아래 내용 읽기만 사라짐: 그 사유로 붙은 비인가 접근(기준선이 있던 사람)과 사유를 빼고, 아래 내용 읽기는 미확정으로 따로 낸다
      const own = r.base[0] < 1 && r.base[1] < 2 ? UNAUTH : ESCALATE
      const strip = (x: Row): Row => {
        const f = new Set(x.f)
        f.delete(HIDDEN)
        return { ...x, ty: own === UNAUTH ? x.ty : x.ty.filter(y => y !== UNAUTH), f }
      }
      const w = r.dim === 'rw' ? r.parts![1] : r
      const keptRow = { ...strip(r), ...(r.parts ? { parts: [r.parts[0], strip(r.parts[1])] as [Row, Row] } : {}) }
      return [keptRow, { ...w, ty: [`미확정:${UNAUTH}`], f: new Set([...w.f, flag]) }]
    })
  }
  /**
   * 연결이 하나도 없는 조직 안 계정이 같은 사람일 수 있는 사람: 그 SaaS 계정이 없는 조직 안 사람.
   * 한 사람은 한 SaaS 에 계정 하나(규칙 3)라, 이미 그 SaaS 계정이 있는 사람은 후보가 아니다. 모든 사람이 연결됐으면 후보가 없다.
   * 허브가 그 SaaS 를 맞추고 있으면(matched) 허브에 연결된 사람도 후보가 아니다
   */
  const nolinkPeers = (p: string): string[] => {
    const acc = accountsOf(p)
    if (acc.length !== 1) return []
    const n0 = node(acc[0])!
    if (!n0.nolink || n0.provider === undefined || accountBoundary(acc[0]) !== 'in') return []
    return P.filter(q => q !== p && boundary(q) === 'in' &&
      accountsOf(q).every(k => node(k)!.provider !== n0.provider && !node(k)!.multi && (n0.nolink === 'open' || !!node(k)!.nolink)))
  }

  /** 판정 줄의 수준. 읽기 경로면 읽기, 쓰기 경로면 관리, 게시 전용, 쓰기 순. 읽기와 쓰기가 합쳐진 줄의 게시 전용은 읽기로 본다 */
  const levelOf = (r: Row): ThreatLevel =>
    r.dim === 'r' ? 'read' : r.f.has(ADMIN) ? 'admin' : r.f.has(POST_ONLY) ? (r.dim === 'rw' ? 'read' : 'post') : 'write'
  /**
   * lv: 심각도 수준. got, base, dl, sh: 그 판정을 낸 Access Gap 값(Row 와 같음, 벤이 쓴다).
   * dim: 읽기(r), 쓰기 이상(w), 둘 다(rw). 유형 이름이 차원을 담지 않아(읽기와 쓰기가 같은 비인가 접근) 판정 한 건을 가를 때 이름과 같이 본다
   */
  type ThreatRow = { p: string; t: string; label: string; dim: Row['dim']; f: string[]; lv: ThreatLevel; got: Acc; base: Acc; dl: Acc; sh: Acc; st?: Step; so?: Step; sure: boolean }
  let threats: ThreatRow[] = []
  /** 관리자 신뢰, 승인으로 뺀 행 */
  const exRows: (ThreatRow & { ex: '관리자' | '승인됨' })[] = []
  const labelOf = (ty: string[]) => [...ty].sort((a, b) => rank(a) - rank(b)).join('+')
  const rowOf = (p: string, r: Row): ThreatRow => ({ p, t: r.t, label: labelOf(r.ty), dim: r.dim, f: [...r.f].sort(), lv: levelOf(r), got: r.got, base: r.base, dl: r.dl, sh: r.sh, st: r.st, ...(r.so && r.so !== r.st ? { so: r.so } : {}), sure: r.sure })
  for (const p of PJ) {
    const all = classify(p, D.get(p)!)
    for (const r of all) if (r.ex || trusted(p, r.t)) exRows.push({ ...rowOf(p, r), ex: r.ex ?? '관리자' })
    let res = all.filter(r => !r.ex && !trusted(p, r.t))
    // 조직 밖 사람의 기준선은 직접 권한과 상관없이 없음이나 승인 범위라 직접 수준 모름이 판정을 바꾸지 않는다.
    // 개인 계정이 직원 계정과 이어져도 조직 밖 계정이라 같은 사람 연결도 보지 않는다(2026-11-18 결정)
    if (boundary(p) === 'in') {
      const weak = weakOf.get(p)!
      // 직접 수준을 모르는 대상(수준 없는 역할, 불확실 간선, 상한 모름)에서 나온 판정은 새 접근인지 모르므로 미확정(8절 「모름」). 약한 연결 사람 것도 본다
      const unknownHere = (t: string) => unknownD(p, t) || weak.some(q => unknownD(q, t))
      res = res.map(r => (!r.ty.some(x => x.startsWith('미확정')) && unknownHere(r.t)
        ? { ...r, ty: [`미확정:${r.ty.join('+')}`], f: new Set([...r.f, '직접 수준 모름']) } : r))
      res = demote(p, res, weak, '같은 사람 연결 약함')
      res = demote(p, res, nolinkPeers(p), '같은 사람 연결 없음')
    }
    for (const r of res) threats.push(rowOf(p, r))
  }

  // 한 경로에 한 건: 같은 연동 지점에서 범위 위 객체가 같은 판정을 가지면 아래 객체는 뺀다. 다른 연동 지점의 경로는 가리지 않는다
  if (!opts.keepAll) {
    // 직접 공유는 연동 지점이 대상 자신이라 가장 위의 공유 지점 하나로 묶는다(규칙 10)
    const pt = (f: string[]) => (f.includes('직접 공유') ? '직접 공유' : f.find(x => x.startsWith('@')) ?? '')
    // 게시 전용 판정은 같은 이름의 실제 쓰기 판정을 가리지 않는다(위 범위에 게시, 아래 대상에 쓰기)
    const kd = (f: string[]) => `${pt(f)}|${f.includes(POST_ONLY) ? 'post' : ''}`
    // 사람, 이름, 차원, 연동 지점이 같은 판정의 대상. 관리 수준을 새로 얻은 판정의 대상은 따로
    const group = threats.map(th => `${th.p}|${th.label}|${th.dim}|${kd(th.f)}`)
    const targetsOf = new Map<string, Set<string>>()
    const adminOf = new Map<string, Set<string>>()
    const add = (m: Map<string, Set<string>>, k: string, t: string) => { let s = m.get(k); if (!s) m.set(k, (s = new Set())); s.add(t) }
    threats.forEach((th, i) => { add(targetsOf, group[i], th.t); if (th.f.includes(ADMIN)) add(adminOf, group[i], th.t) })
    // 관리 수준을 새로 얻은 아래 대상은 관리가 없는 위 범위 판정에 가려지지 않는다(심각도 영향 가용성을 잃지 않게)
    threats = threats.filter((th, i) => {
      const parents = ix.scopeParents.get(th.t)
      if (!parents) return true
      const same = targetsOf.get(group[i])!
      const admin = th.f.includes(ADMIN) ? adminOf.get(group[i]) : undefined
      return !parents.some(par => same.has(par) && (!th.f.includes(ADMIN) || !!admin?.has(par)))
    })
  }

  // 심각도 가능성 신호와 범위(명세 「심각도」, 2026-11-18 OWASP Risk Rating 결정). 점수는 assemble 이 매긴다
  /** 테넌트(조직 전원). 테넌트가 받은 권한은 범위 아래로 내려가 위 객체(사이트, 프로젝트)에 걸린 권한도 조직 전원 것이다 */
  const tenants = Object.keys(g.nodes).filter(k => g.nodes[k].kind === 'tenant').sort()
  /** 테넌트가 받은 권한 간선. 사람 직접 권한이 이미 펴 둔 것이라 자리마다 그 간선 펴기만 본다(테넌트 전체 표를 만들지 않음). 수준 모르는 권한은 읽기 */
  const tenantGrants = tenants.flatMap(a => ix.src.grantsOf(a))
  const tenantAtMemo = new Map<string, Acc>()
  const tenantAt = (x: string): Acc => {
    let v = tenantAtMemo.get(x)
    if (!v) {
      v = Z
      for (const gv of tenantGrants) {
        const r = spreadOf(ix.src, gv).get(x)
        if (r?.bits) v = mx(v, gv.known ? accOf(r.bits) : [1, 0])
      }
      tenantAtMemo.set(x, v)
    }
    return v
  }
  /**
   * 자리 x 에 설 수 있는 사람(규모). d, lim: 그 자리에 필요한 차원과 수준. call: 그 자리에서 부르는 자동화.
   * 부르는 간선이 모두 구성원 제한(gate)이면 특정 구성원. 누구나 노드이거나 누구나 노드가 그 수준을 가지면 누구나.
   * 테넌트이거나 테넌트가 그 수준(부르는 자리면 부르는 데 필요한 수준)을 가지면 조직 전원.
   * 그룹이나 계정이 부르는 자리는 그 소속만 선다(그 주체를 읽을 수 있어도 들어가지 못한다).
   * 관리가 필요한 자리를 테넌트가 관리로 갖지 않으면 관리자만. 그 밖은 특정 채널이나 그룹 구성원. 같은 자리는 한 번만 센다
   */
  const spotMemoAt = new Map<string, Spot>()
  const spotAt = (x: string, d: 0 | 1, lim: number, call?: string): Spot => {
    const key = `${x}\u0001${d}${lim}\u0001${call ?? ''}`
    let s = spotMemoAt.get(key)
    if (!s) spotMemoAt.set(key, (s = spotOf(x, d, lim, call)))
    return s
  }
  const spotOf = (x: string, d: 0 | 1, lim: number, call?: string): Spot => {
    const calls = call ? ix.outOf('호출', x).filter(e => e.to === call) : []
    if (calls.length && calls.every(e => !!e.gate?.length)) return 'member'
    if (x === EVERYONE) return 'anyone'
    if (node(x)?.kind === 'tenant') return 'org'
    if (call && node(x)?.kind !== 'res') return 'member'
    if (everyone && get(DE, x)[d] >= lim) return 'anyone'
    const t = tenantAt(x)
    if (d === 1 && lim >= 3) return t[1] >= 3 ? 'org' : 'admin'
    return t[d] >= lim ? 'org' : 'member'
  }
  const SPOT_RANK: Record<Spot, number> = { admin: 0, member: 1, org: 2, anyone: 3 }
  const wider = (a: Spot | undefined, b: Spot): Spot => (!a || SPOT_RANK[b] > SPOT_RANK[a] ? b : a)
  /** 자동화 a 를 부를 수 있는 사람. 부르는 자리 가운데 가장 넓은 것. 다른 자동화가 부르면 그 자동화를 부르는 자리. 처음 부른 값만 담는다(고리 안 값은 잘린다) */
  const spotMemo = new Map<string, Spot>()
  const callSpot = (a: string, seen?: Set<string>): Spot => {
    if (!seen) {
      const hit = spotMemo.get(a)
      if (hit) return hit
      const s = callSpot(a, new Set())
      spotMemo.set(a, s)
      return s
    }
    seen.add(a)
    let best: Spot | undefined
    for (const e of ix.inOf('호출', a)) {
      // 부르는 조건은 파생 계산과 같다(쓰기 이상이 필요하면 쓰기)
      const need = L[e.need ?? 'write']
      const d: 0 | 1 = need[1] >= 2 ? 1 : 0
      best = wider(best, node(e.from)?.kind === 'auto' ? (seen.has(e.from) ? 'member' : callSpot(e.from, seen)) : spotAt(e.from, d, d ? 2 : need[0], a))
    }
    return best ?? 'member'
  }
  /** 대상에 한 일이 감사 로그에 그 사람으로 남는가. 사본을 읽는 데이터 흐름은 그 사본을 읽은 길을 본다. 호출은 자동화가 호출자를 남기고 사람이 직접 부를 때만 */
  const recordedOf = (c: Chain): boolean => {
    for (let i = 0; i < c.steps.length; i++) {
      const st = c.steps[i]
      if (st.kind === '데이터 흐름' && st.need !== 'call') {
        if (i + 1 < c.steps.length) continue
        return c.open.how === 'level'
      }
      if (st.need === 'call' && (st.kind === '실행 신원' || st.kind === '효과' || st.kind === '데이터 흐름')) return node(st.at)?.audit === 'caller_recorded' && !c.relayed.has(st)
      return false
    }
    return false
  }
  /** 길에서 가장 어려운 단계. 자동화를 고침(접속자 권한 차용은 자동화를 고쳐 다른 호출자 권한을 빌린다), 자원 안 자격증명 꺼내 쓰기, 평소대로 */
  const effortOf = (c: Chain): Likelihood['effort'] =>
    c.steps.some(s => s.kind === '자동화 편집' || s.kind === '접속자 권한 차용') ? 'edit' : c.steps.some(s => s.kind === '자격 보관') ? 'extract' : 'usual'
  /** 그 자리에 필요한 수준(기회). 부르기와 읽기는 read */
  const needAt = (o: Opening): Likelihood['need'] => (o.how === 'call' || o.d === 0 ? 'read' : o.lim >= 3 ? 'admin' : 'write')
  /** 범위가 그릇인가(범위 아래 객체가 있다) */
  const container = (t: string) => (ix.scopeChildren.get(t)?.length ?? 0) > 0 || !!node(t)?.holds
  /**
   * 범위 요약. n: 대상 수(둘부터는 2), one: 대상이 하나면 그 대상, pv: SaaS, all: 테넌트를 담음.
   * 요약끼리 합쳐도 대상 목록을 다시 훑지 않는다(같은 신원으로 도는 자동화가 많다)
   */
  type Span = { n: number; one?: string; pv: ReadonlySet<string>; all: boolean }
  const NO_SPAN: Span = { n: 0, pv: new Set(), all: false }
  const spanOf = (ts: Iterable<string>): Span => {
    let n = 0
    let one: string | undefined
    const pv = new Set<string>()
    let all = false
    for (const t of ts) {
      if (node(t)?.kind === 'tenant') all = true
      if (n < 2) { n++; one = n === 1 ? t : undefined }
      const v = node(t)?.provider
      if (v) pv.add(v)
    }
    return { n, ...(one !== undefined ? { one } : {}), pv, all }
  }
  const joinSpan = (a: Span, b: Span): Span => {
    const n = !a.n ? b.n : !b.n ? a.n : a.n >= 2 || b.n >= 2 || a.one !== b.one ? 2 : 1
    const one = n === 1 ? a.one ?? b.one : undefined
    return { n, ...(one !== undefined ? { one } : {}), pv: new Set([...a.pv, ...b.pv]), all: a.all || b.all }
  }
  /** 범위. 테넌트를 담거나 SaaS 가 둘 이상이면 전부, 여럿이면 넓게, 그릇 하나면 중간, 그 밖은 조금 */
  const extentOf = (s: Span): Extent => (s.all || s.pv.size >= 2 ? 'all' : s.n >= 2 ? 'wide' : s.n === 1 && container(s.one!) ? 'mid' : 'some')
  /** 들어가는 자리나 대상 가운데 AEGI 가 감사 로그를 수집하는 SaaS 가 있으면 logged */
  const logOn = (keys: (string | undefined)[], pv?: ReadonlySet<string>): { logged?: true } => {
    const L = g.logged
    if (!L?.size) return {}
    const hit = keys.some(k => { const v = k ? node(k)?.provider : undefined; return !!v && L.has(v) }) || [...(pv ?? [])].some(v => L.has(v))
    return hit ? { logged: true } : {}
  }

  // 추적성 상실: 고정 실행 신원마다
  const traces = new Map<string, JudgedTrace>()
  const sev = (lv: Acc): JudgedTrace['severity'] => (lv[1] >= 2 ? 'high' : 'low')
  /** lvW: 약하게 이어진 계정을 같은 사람으로 합쳐 다시 센 수준. 그 수준에서 사라지면 미확정. 같은 건이 확정으로도 나오면 확정 */
  /** way: 이 길의 심각도 신호. 같은 건이 여러 길로 나오면 길을 모두 남긴다 */
  const addTrace = (identity: string, lv: Acc, lvW: Acc, way: TraceWay) => {
    const t: JudgedTrace = { identity, severity: sev(lv), ...(eq(lvW, Z) || sev(lvW) !== sev(lv) ? { unsure: true as const } : {}), ways: [way] }
    const k = `${t.identity}|${t.severity}`
    const cur = traces.get(k)
    if (cur && !cur.unsure) { cur.ways.push(way); return }
    traces.set(k, cur ? { ...t, ways: [...cur.ways, way] } : t)
  }
  // 같은 고정 실행 신원으로 도는 자동화들의 호출자를 합쳐 센다(6절 조건 2).
  // 신원 주인이 아닌 호출자가 한 명이라도 있으면 그 사람이 한 일이 주인 이름으로 남는다(2026-11-17 결정).
  // 여러 사람을 대표하는 노드(공유 계정)는 주인이어도 다른 사람이 섞여 주인이 아닌 호출자로 본다.
  // weak: 약하게 이어진 사람도 주인으로 본다(합쳐서 사라지는지 보려고)
  /**
   * 신원 주인(대표 사람 키). 사람 계정이면 그 사람. 자격증명, 토큰처럼 사람 계정이 아닌 신원이 사람 계정으로 돌면(계정의 API 토큰)
   * 기록에 그 계정 이름이 남아 그 사람도 주인. 자동화, 앱은 자기 이름으로 남아 거쳐 가지 않는다. 봇, 앱, 사람으로 돌지 않는 키는 주인 없음
   */
  const ownerMemo = new Map<string, Set<string>>()
  const ownersOf = (id: string): Set<string> => {
    let o = ownerMemo.get(id)
    if (o) return o
    o = new Set()
    const seen = new Set([id])
    const st = [id]
    while (st.length) {
      const x = st.pop()!
      const r = rep.get(x)
      if (r) { o.add(r); continue }
      if (node(x)?.kind !== 'identity') continue
      for (const e of ix.outOf('실행 신원', x)) if (isFixed(e) && !seen.has(e.to)) { seen.add(e.to); st.push(e.to) }
    }
    ownerMemo.set(id, o)
    return o
  }
  const multi = (p: string) => Math.max(...accountsOf(p).map(k => node(k)?.multi ?? 1))
  const notOwner = (p: string, id: string, weak = false) => {
    if (multi(p) >= 2) return true
    const own = ownersOf(id)
    return !own.has(p) && !(weak && weakOf.get(p)!.some(q => own.has(q)))
  }
  // 6절: 호출자 전원이 이미 직접 읽을 수 있는 대상과 공개 대상은 읽기 단계에서 뺀다. 쓰기 이상은 그대로 센다
  const traceLevel = (t: string, l: Acc, callers: readonly string[]): Acc => {
    if (l[0] < 1) return l
    // 누구나 공유는 넣지 않는다(추적성 상실은 직접 권한 규칙 바뀜과 상관없이 그대로)
    const known = node(t)?.public_by_design || (callers.length > 0 && callers.every(p => get(Dself.get(p), t)[0] >= 1))
    return known ? [0, l[1]] : l
  }
  /** 신원 권한 표 하나의 추적성 상실 수준(lv)과 그 수준이 걸린 대상의 범위 요약(span). 같은 표와 같은 호출자면 한 번만 센다(같은 신원으로 도는 자동화가 많다) */
  const levelMemo = new Map<AccMap, Map<string, { lv: Acc; span: Span }>>()
  const traceOver = (gr: AccMap, callers: readonly string[]): { lv: Acc; span: Span } => {
    const key = JSON.stringify(callers)
    let m = levelMemo.get(gr)
    if (!m) levelMemo.set(gr, (m = new Map()))
    let o = m.get(key)
    if (!o) {
      let lv: Acc = Z
      const ts: string[] = []
      for (const [t, l] of gr) {
        const x = traceLevel(t, l, callers)
        if (eq(x, Z)) continue
        lv = mx(lv, x)
        ts.push(t)
      }
      m.set(key, (o = { lv, span: spanOf(ts) }))
    }
    return o
  }
  // 차단 지점 확인(threatsOnly)은 위협 행만 쓴다. 자원 안 자격증명 판정이 모든 사람의 직접 권한을 물어 건너뛴다
  if (!opts.threatsOnly) {
    const idCallers = new Map<string, Set<string>>()
    /** 고정 실행 신원마다 그 신원으로 도는 자동화(부르는 자리, 규모) */
    const idAutos = new Map<string, string[]>()
    for (const a of autos) for (const r of ix.outOf('실행 신원', a).filter(isFixed)) {
      if (!idCallers.has(r.to)) idCallers.set(r.to, new Set())
      for (const p of inv.get(a)!) idCallers.get(r.to)!.add(p)
      push(idAutos, r.to, a)
    }
    /** 신원으로 도는 자동화를 부르는 자리 가운데 가장 넓은 것. 신원마다 한 번 센다(같은 신원으로 도는 자동화가 많다) */
    const idSpot = new Map<string, Spot>()
    const spotOfId = (id: string): Spot => {
      let s = idSpot.get(id)
      if (!s) {
        for (const b of idAutos.get(id)!) s = wider(s, callSpot(b))
        idSpot.set(id, (s ??= 'member'))
      }
      return s
    }
    // 신원마다 조건 2를 보고, 조건을 채운 신원의 권한만 수준에 넣는다(주인만 부르는 신원의 권한은 주인 이름으로 남아 상실이 아니다)
    for (const a of autos) {
      const fx = ix.outOf('실행 신원', a).filter(isFixed)
      if (!fx.length) continue
      let lv: Acc = Z
      let lvW: Acc = Z
      let span = NO_SPAN
      let spot: Spot | undefined
      let outside = false
      for (const r of fx) {
        const callers = [...idCallers.get(r.to)!].sort()
        if (!callers.some(p => notOwner(p, r.to))) continue
        const o = traceOver(idgrant(r, true)[0], callers)
        lv = mx(lv, o.lv)
        span = joinSpan(span, o.span)
        // 같은 신원으로 도는 자동화를 부르는 사람이 모두 그 이름 뒤에 숨는다(규모는 그 자리 가운데 가장 넓은 것). 누구나 노드가 부르면 누구나
        spot = wider(spot, spotOfId(r.to))
        if (callers.includes(EVERYONE)) spot = 'anyone'
        if (callers.some(p => boundary(p) !== 'in')) outside = true
        // 사슬이 약하면 그 신원으로 도는지 모른다. 확정 수준에 넣지 않아 미확정
        if (!r.chainUnsure?.length && callers.some(p => notOwner(p, r.to, true))) lvW = mx(lvW, o.lv)
      }
      if (!eq(lv, Z) && node(a)?.audit !== 'caller_recorded') {
        addTrace(a, lv, lvW, { likelihood: { spot: spot ?? 'member', need: 'read', effort: 'usual', recorded: false, outside, ...logOn([a], span.pv) }, level: lv, extent: extentOf(span) })
      }
    }
    // 자원 안에 든 자격증명: 자원을 읽는 사람 가운데 신원 주인이 아닌 사람이 있으면 그 신원 이름만 남는다
    const scopes = ix.of('범위').filter(e => extractable(node(e.from)) && node(e.to)?.kind === 'res')
    // 자원마다 읽는 사람을 한 번에 모은다. 범위 간선마다 사람 전원을 훑으면 간선 수와 사람 수의 곱이 된다(#464)
    const readers = new Map<string, string[]>(scopes.map(e => [e.to, []]))
    // 파생 수준은 대상마다 그 대상을 가진 묶음만 접어 묻는다(dvAt). 사람 표 전체를 합치지 않는다(파생 표 묶음 참조)
    for (const [t, list] of readers) {
      const lv = dvAt(t)
      for (const p of P) if (mx(get(Dself.get(p), t), lv(p) ?? Z)[0] >= 1) list.push(p)
    }
    for (const list of readers.values()) list.sort()
    for (const e of scopes) {
      const holders = readers.get(e.to)!
      for (const id of ix.credentialIdentities(e.from)) {
        if (!holders.some(p => notOwner(p, id))) continue
        const { lv, span } = traceOver(ix.identityGrant(id), holders)
        const via = ix.outOf('실행 신원', e.from).filter(r => r.to === id)
        const weakChain = via.length > 0 && via.every(r => r.chainUnsure?.length)
        if (eq(lv, Z) || node(id)?.audit === 'caller_recorded') continue
        // 꺼내 쓰는 사람은 자원을 읽는 사람(규모는 자원을 읽을 수 있는 사람). 누구나 노드가 읽으면 누구나
        const spot = holders.includes(EVERYONE) ? 'anyone' : spotAt(e.to, 0, 1)
        const likelihood: Likelihood = { spot, need: 'read', effort: 'extract', recorded: false, outside: holders.some(p => boundary(p) !== 'in'), ...logOn([e.to], span.pv) }
        addTrace(id, lv, !weakChain && holders.some(p => notOwner(p, id, true)) ? lv : Z, { likelihood, level: lv, extent: extentOf(span) })
      }
    }
  }

  /**
   * 판정 하나의 경로. 파생 계산이 남긴 마지막 단계(연동 지점에서 대상까지)와, 그 단계에 서기까지 앞 단계를 이어 붙인 lead.
   * 직접 공유는 대상을 실제로 읽을 수 있는 같은 사람 계정의 권한 간선 하나
   */
  const routeOf = (th: ThreatRow, flags: string[], point: string): Pick<JudgedThreat, 'entry' | 'hops' | 'lead'> => {
    // 계정이 하나면 바로 그 계정. 여럿일 때만 계정마다 권한을 펼친다(테넌트 전체 권한이 있으면 비싸다)
    if (flags.includes('직접 공유')) {
      const accts = accountsOf(th.p)
      const from = accts.length > 1 ? accts.find(k => get(ix.identityGrant(k), th.t)[0] >= 1) ?? th.p : accts[0] ?? th.p
      return { hops: [{ kind: '권한', from, to: th.t }] }
    }
    if (!th.st) return { hops: [{ kind: '권한', from: point, to: th.t }] }
    const lead = leadOf(th.p, th.st, th.sure)
    return { lead, entry: lead[lead.length - 1], hops: stepHops(th.st, th.t) }
  }

  /**
   * 판정 행 길 하나의 가능성 신호(명세 「심각도」). 사람이 자기 권한으로 처음 서는 자리(chain open)로 규모와 기회를, 단계로 공격 쉬움을,
   * 대상에 한 일을 누구 이름으로 남기는지로 침입 탐지를 본다. 직접 공유는 공유받은 것 말고 더 필요한 접근이 없다(계정 없이).
   * 누구나 노드는 계정 없이 누구나 서고 이름이 남지 않는다. 단계가 없는 행(생기지 않아야 한다)은 특정 구성원, 읽기, 평소대로, 이름 모름으로 본다
   */
  const likelyOf = (th: ThreatRow, flags: string[], st: Step | undefined): Likelihood => {
    const outside = boundary(th.p) !== 'in'
    const anyone = th.p === EVERYONE
    const lg = logOn([th.t, st?.at])
    if (flags.includes('직접 공유')) return { spot: anyone ? 'anyone' : 'member', need: 'none', effort: 'usual', recorded: !anyone, outside, ...lg }
    if (!st) return { spot: anyone ? 'anyone' : 'member', need: anyone ? 'none' : 'read', effort: 'usual', recorded: false, outside, ...lg }
    const c = chainOf(th.p, st, th.sure)
    const effort = effortOf(c)
    if (anyone) return { spot: 'anyone', need: 'none', effort, recorded: false, outside, ...lg }
    const o = c.open
    return { spot: spotAt(o.at, o.d, o.lim, o.how === 'call' ? o.to : undefined), need: needAt(o), effort, recorded: recordedOf(c), outside, ...(lg.logged ? lg : logOn([o.at])) }
  }
  /** 신원이 테넌트에 걸린 권한으로 닿는 곳. 신원마다 한 번 */
  const tenantMemo = new Map<string, Set<string>>()
  const tenantReach = (id: string): Set<string> => {
    let s = tenantMemo.get(id)
    if (!s) {
      s = new Set()
      for (const gv of ix.direct(id).reached) if (node(gv.to)?.kind === 'tenant') for (const [t, r] of spreadOf(ix.src, gv)) if (r.bits) s.add(t)
      tenantMemo.set(id, s)
    }
    return s
  }
  /** 단계의 신원(실행 신원, 자동화 편집, 자격 보관)이 테넌트 권한으로 대상 t 에 닿는가(범위 전부) */
  const tenantWideAt = (st: Step | undefined, t: string) => !!st?.identity && tenantReach(st.identity).has(t)

  /** 조직 밖 표시. 조직 경계 모름도 조직 밖으로 본다 */
  const outsideOf = (p: string): Pick<JudgedThreat, 'external'> => (boundary(p) !== 'in' ? { external: true } : {})
  const accessOf = (th: ThreatRow): JudgedThreat['access'] => ({ direct: th.dl, derived: th.got, base: th.base, ...(th.sh[0] || th.sh[1] ? { share: th.sh } : {}) })
  const seen = new Set<string>()
  const out: JudgedThreat[] = []
  /** 사람, 연동 지점마다 판정 행의 대상과 테넌트 전체에 닿는가(범위는 같은 연동 지점으로 그 사람에게 열리는 대상 전체로 본다). ext: 묶음마다 한 번 센 범위 */
  const opened = new Map<string, Map<string, { ts: Set<string>; all: boolean; ext?: Extent }>>()
  // 같은 사람, 대상, 이름, 차원, 확실성의 판정은 한 건. 수준은 그중 가장 높은 것.
  // 확실성도 본다: 미확정 경로에서만 서는 「아래 내용 읽기」는 확정 쓰기 판정과 이름, 차원이 같아도 따로 낸다(classify)
  const keyOf = (th: ThreatRow) => `${th.p}|${th.t}|${th.label}|${th.dim}|${unsure(th.f) ? '?' : ''}`
  const LV_RANK: Record<ThreatLevel, number> = { post: 0, read: 1, write: 2, admin: 3 }
  const topLevel = new Map<string, ThreatLevel>()
  for (const th of threats) {
    const key = keyOf(th)
    const cur = topLevel.get(key)
    if (!cur || LV_RANK[th.lv] > LV_RANK[cur]) topLevel.set(key, th.lv)
  }
  for (const th of threats) {
    const key = keyOf(th)
    if (seen.has(key)) continue
    seen.add(key)
    const point = th.f.find(f => f.startsWith('@'))?.slice(1) ?? th.t
    const parsed = parseLabel(th.label)
    if (unsure(th.f)) parsed.certainty = '미확정'
    const flags = th.f.filter(f => !f.startsWith('@'))
    const path = routeOf(th, flags, point)
    // 읽기와 쓰기가 다른 단계에서 와 합친 행은 두 길을 다 본다(심각도는 더 높은 쪽)
    const likelihood = [likelyOf(th, flags, th.st), ...(th.so ? [likelyOf(th, flags, th.so)] : [])]
    let byPoint = opened.get(th.p)
    if (!byPoint) opened.set(th.p, (byPoint = new Map()))
    let o = byPoint.get(point)
    if (!o) byPoint.set(point, (o = { ts: new Set(), all: false }))
    o.ts.add(th.t)
    if (tenantWideAt(th.st, th.t) || tenantWideAt(th.so, th.t)) o.all = true
    out.push({ person: th.p, target: th.t, ...parsed, ...outsideOf(th.p), flags, point, ...path, level: topLevel.get(key)!, dim: th.dim, likelihood, access: accessOf(th), ...sentOf(th) })
  }
  for (const t of out) {
    const o = opened.get(t.person)!.get(t.point)!
    t.extent = (o.ext ??= o.all ? 'all' : extentOf(spanOf(o.ts)))
  }
  // 제외 행은 위협이 있는 대상만 남긴다(Access Gap 은 위협을 따른다)
  const targets = new Set(out.map(t => t.target))
  const excluded: JudgedThreat[] = exRows.filter(th => targets.has(th.t)).map(th => {
    const parsed = parseLabel(th.label)
    if (unsure(th.f)) parsed.certainty = '미확정'
    const point = th.f.find(f => f.startsWith('@'))?.slice(1) ?? th.t
    // 제외 행은 심각도를 매기지 않아 경로와 가능성 신호를 따지지 않는다. Access Gap 벤의 접근 계정만 경로 첫 간선에서 읽는다
    const from = th.st ? leadOf(th.p, th.st, th.sure)[0]?.from : undefined
    const via = from && accountsOf(th.p).includes(from) ? from : undefined
    return { person: th.p, target: th.t, ...parsed, ...outsideOf(th.p), flags: th.f.filter(f => !f.startsWith('@')), point, hops: [], level: th.lv, dim: th.dim, likelihood: [], access: accessOf(th), excluded: th.ex, ...(via ? { via } : {}) }
  })
  /**
   * 사람 p, 대상 t 의 Access Gap 기준선(gapsOf 와 같음). base: 기준선, held: 벤에 보이는 직접 수준, share: 조직 밖 직접 공유.
   * 조직 밖 사람의 기준선이 승인 범위가 되는 곳은 Access Gap 대상(gapClass)만. 그 밖의 대상(본인 객체, 조직 밖 객체)은 조직 안과 같다
   */
  const baseAt = (p: string, t: string): { base: Acc; held: Acc; share: Acc } => {
    if (boundary(p) === 'in' || !gapClass(p, t, k => isMember(p, k))) { const d = get(D.get(p), t); return { base: d, held: d, share: Z } }
    const allowed = allowedOf(p)
    const share = shareOf(p, t)
    return { base: allowed, held: lower(share, allowed), share }
  }
  // Access Gap 직접 권한 원: 대상에 확정 직접 권한(누구나 공유 뺌)이 기준선 안에 있는 사람. 승인 목록 밖 조직 밖 사람의 직접 공유는 원 밖
  const holders = (t: string): ReadonlyMap<string, Acc> | undefined => {
    let m: Map<string, Acc> | undefined
    for (const p of P) {
      let l = Dself.get(p)!.get(t)
      if (l && boundary(p) !== 'in' && gapClass(p, t, k => isMember(p, k))) l = lower(l, allowedOf(p))
      if (l && (l[0] >= 1 || l[1] >= 2)) (m ??= new Map()).set(p, l)
    }
    return m
  }
  const holderAccounts = (p: string, t: string): string[] => ix.directAccountsAt(`person~${p}`, [...accountsOf(p)], t)
  // Access Gap 파생 접근 원: 대상에 이 연동 지점으로 파생 접근이 닿지만 그 지점에서 기준선보다 높아진 권한이 없는 사람.
  // 새로 생긴 권한이 있는 사람은 위협 행이나 제외 행이 맡는다. 차원마다 가장 높은 수준을 준 경로의 연동 지점만 본다
  const reach = (t: string, point: string): JudgedReach[] => {
    const out: JudgedReach[] = []
    // 대상 하나를 사람 전원에게 묻는다. 그 대상을 가진 표만 접는다(표마다 대상 역색인)
    const col = column(t)
    for (const p of PJ) {
      const c = col(p)
      if (!c) continue
      const fr = c.r
      const fw = c.w
      const r = pointOf(fr)?.slice(1) === point && fr
      const w = pointOf(fw)?.slice(1) === point && fw
      if (!r && !w) continue
      const derived: Acc = [r ? c.v0 : 0, w ? c.v1 : 0]
      const b = baseAt(p, t)
      if (gainedOf(b.base, derived).length) continue
      const own = accountsOf(p)
      // 연동 지점은 전체 표(확정, 모름 전부)의 단계라 lead 도 확정 자취만 따르지 않는다. 같은 사람 계정이 아니면(자취가 끊긴 경우) 싣지 않는다
      const accounts = [...new Set([r, w].flatMap(f => {
        const st = f ? stepOf(f) : undefined
        const from = st ? leadOf(p, st, false)[0]?.from : undefined
        return from && own.includes(from) ? [from] : []
      }))].sort()
      out.push({ person: p, point, derived, direct: b.held, certainty: (r && unsure(r)) || (w && unsure(w)) ? '미확정' : '확정', ...(accounts.length ? { accounts } : {}) })
    }
    return out
  }
  const callers = new Map<string, Set<string>>()
  for (const a of autos) if (ix.outOf('실행 신원', a).some(r => r.mode === 'caller')) callers.set(a, new Set(inv.get(a)!))
  const derivedAt = (account: string, cap: 'read' | 'write' | 'admin', t: string): DerivedAnswer | undefined => {
    const d: 0 | 1 = cap === 'read' ? 0 : 1
    const lim = cap === 'read' ? 1 : cap === 'write' ? 2 : 3
    if (node(account)?.kind === 'auto') return autoDerivedAt(ix, account, cap, t)
    const p = rep.get(account)
    const c = p ? cellOf(p, t) : undefined
    if (!p || !c || get(c.dv, t)[d] < lim) return undefined
    const sure = get(c.dvs, t)[d] >= lim
    const fl = sure ? c.fls : c.fl
    const f = (d === 0 ? fl.r : fl.w).get(t)
    const st = stepOf(f)
    const need = d === 0 ? 'r' as const : lim >= 3 ? 'a' as const : 'w' as const
    // 연동 지점은 판정 행과 같은 규칙(이유의 「@」 값, 없으면 대상)
    return { sure, point: pointOf(f)?.slice(1) ?? t, person: p, hops: st ? [...leadOf(p, st, sure), ...stepHops(st, t).map(h => (h.kind === '권한' && h.to === t ? { ...h, need } : h))] : [] }
  }
  /**
   * 새로 생긴 권한(기준선보다 높아진 수준, gainedOf)을 위협 판정과 같은 Access Gap 으로 가른다(baseAt, gapsOf).
   * 조직 안: 기준선은 D(확정 직접 권한과 누구나 공유 읽기), 가진 접근은 파생 접근. 미확정은 확정 경로로는 안 서는 수준(경로 모름 사유),
   *   직접 수준 모름(약하게 이어진 사람 것 포함), 약하게 이어진 사람이나 연결 없는 계정이 같은 사람일 수 있는 사람의 직접 권한을 합치면 사라지는 수준(demote).
   * 조직 밖의 Access Gap 대상: 기준선은 없음이나 승인 범위, 가진 접근은 직접 공유와 파생 접근. 미확정은 경로 모름 사유와 조직 경계 모름.
   *   직접 공유로 선 수준은 share
   */
  const gainOf = (p: string, t: string, x: Acc, xs: Acc, fl: FlagMaps | undefined, peers: () => string[]): JudgedAccess['gained'] => {
    const org = boundary(p)
    if (org !== 'in' && gapClass(p, t, k => isMember(p, k))) {
      const allowed = allowedOf(p)
      const share = shareOf(p, t)
      const lv = gainedOf(allowed, mx(share, x))
      if (!lv.length) return {}
      const sureLv = gainedOf(allowed, mx(share, xs))
      const shareLv = gainedOf(allowed, share)
      const gained: JudgedAccess['gained'] = {}
      for (const l of lv) {
        const reasons = [
          ...(sureLv.includes(l) ? [] : unsureReasons(l === '읽기' ? fl?.r.get(t) : fl?.w.get(t))),
          ...(org === 'unknown' ? ['조직 경계 모름'] : []),
        ]
        gained[l] = { certainty: !sureLv.includes(l) || reasons.length ? '미확정' : '확정', ...(reasons.length ? { reasons } : {}), ...(shareLv.includes(l) ? { share: true as const } : {}) }
      }
      return gained
    }
    const dj = get(D.get(p), t)
    const lv = gainedOf(dj, x)
    if (!lv.length) return {}
    const sureLv = gainedOf(dj, xs)
    const weak = weakOf.get(p)!
    const unknown = unknownD(p, t) || weak.some(q => unknownD(q, t))
    const kept = (also: string[]) => (also.length ? gainedOf(also.reduce((m, q) => mx(m, get(D.get(q), t)), dj), x) : lv)
    const keptWeak = kept(weak)
    const keptPeer = kept(peers())
    const outside = org === 'unknown'
    const gained: JudgedAccess['gained'] = {}
    for (const l of lv) {
      const reasons = [
        ...(sureLv.includes(l) ? [] : unsureReasons(l === '읽기' ? fl?.r.get(t) : fl?.w.get(t))),
        ...(unknown ? ['직접 수준 모름'] : []),
        ...(keptWeak.includes(l) ? [] : ['같은 사람 연결 약함']),
        ...(keptPeer.includes(l) ? [] : ['같은 사람 연결 없음']),
        ...(outside ? ['조직 경계 모름'] : []),
      ]
      gained[l] = !sureLv.includes(l) || reasons.length ? { certainty: '미확정', ...(reasons.length ? { reasons } : {}) } : { certainty: '확정' }
    }
    return gained
  }
  const access = (): JudgedAccess[] => {
    const out: JudgedAccess[] = []
    for (const p of P) {
      const all = ix.directReach(`person~${p}`, accountsOf(p))
      const sure = Dself.get(p)!
      // 표 전체를 사람 하나씩 합쳐 쓴다(파생 표 묶음 참조). 파생을 계산하지 않은 사람은 표가 없다
      const tb = tables(p)
      const dv = tb?.dv, dvs = tb?.dvs, fl = tb?.fl, fls = tb?.fls
      let nolink: string[] | undefined
      const peers = () => (nolink ??= nolinkPeers(p))
      const targets = new Set([...all.keys(), ...sure.keys(), ...(dv?.keys() ?? [])])
      for (const t of targets) {
        const ds = get(sure, t)
        const d = mx(get(all, t), ds)
        const x = get(dv, t), xs = get(dvs, t)
        if (!d[0] && !d[1] && !x[0] && !x[1]) continue
        const points: JudgedAccess['points'] = {}
        if (x[0]) points.r = pointOf(fl?.r.get(t))?.slice(1)
        if (x[1]) points.w = pointOf(fl?.w.get(t))?.slice(1)
        if (xs[0]) points.rs = pointOf(fls?.r.get(t))?.slice(1)
        if (xs[1]) points.ws = pointOf(fls?.w.get(t))?.slice(1)
        for (const k of Object.keys(points) as Array<keyof typeof points>) if (points[k] === undefined) delete points[k]
        out.push({ person: p, target: t, direct: d, directSure: ds, derived: x, derivedSure: xs, points, gained: gainOf(p, t, x, xs, fl, peers) })
      }
    }
    return out
  }
  return { threats: out, trace: [...traces.values()], callers, excluded, holders, holderAccounts, reach, derivedAt, access, accountsOf }
}

/**
 * 자동화가 고정 실행 신원의 직접 권한으로 대상에 닿는가(사람과 상관없다). 확실: 실행 신원 사슬이 확실하고 신원의 확정 권한이 그 수준.
 * 수준 모르는 역할처럼 신원 권한에 「모름」이 닿으면 수준이 모자라도 미확정으로 답한다
 */
function autoDerivedAt(ix: Index, account: string, cap: 'read' | 'write' | 'admin', t: string): DerivedAnswer | undefined {
  const d: 0 | 1 = cap === 'read' ? 0 : 1
  const lim = cap === 'read' ? 1 : cap === 'write' ? 2 : 3
  const need = d === 0 ? 'r' as const : lim >= 3 ? 'a' as const : 'w' as const
  let best: DerivedAnswer | undefined
  for (const r of ix.outOf('실행 신원', account)) {
    if (!isFixed(r)) continue
    const has = get(ix.identityGrant(r.to), t)[d] >= lim
    if (!has && !ix.direct(r.to).unknownAt(t)) continue
    const sure = has && !r.chainUnsure?.length && get(ix.direct(r.to).sure, t)[d] >= lim
    if (best && (best.sure || !sure)) continue
    best = { sure, point: account, hops: [{ kind: '실행 신원', from: account, to: r.to }, { kind: '권한', from: r.to, to: t, need }] }
  }
  return best
}

/** 판정 줄 차원이 담는 차원 */
const DIMS = { r: ['r'], w: ['w'], rw: ['r', 'w'] } as const

/** 판정 유형 이름들. 미확정 표시를 떼고 합친 이름(a+b)을 나눈다 */
const baseTypes = (ty: string[]): string[] => ty.flatMap(x => x.replace(/^미확정:/, '').split('+'))

/**
 * 읽기와 쓰기가 한 판정으로 합쳐지면 이 순서로 앞선 단계를 경로로 쓴다(옛 경로 복원이 이유 이름을 본 순서).
 * 순서가 같으면 쓰기 단계. 읽기만 준 신원은 쓰기를 설명하지 못한다
 */
const STEP_ORDER: Record<Step['kind'], number> = { '실행 신원': 0, '자동화 편집': 0, '자격 보관': 1, '데이터 흐름': 2, 효과: 3, '접속자 권한 차용': 4 }
const firstStep = (r?: Step, w?: Step): Step | undefined => (!r ? w : !w ? r : STEP_ORDER[r.kind] < STEP_ORDER[w.kind] ? r : w)

/** 대표 유형 순서(threat_types.yaml order). 미확정 표시가 붙은 합친 이름은 그 안의 가장 앞선 유형으로 센다 */
function rank(type: string): number {
  const i = TYPE_ORDER.findIndex(n => type.includes(n))
  return i < 0 ? TYPE_ORDER.length : i
}

function parseLabel(label: string): Pick<JudgedThreat, 'types' | 'certainty'> {
  let certainty: JudgedThreat['certainty'] = '확정'
  let t = label
  if (t.startsWith('미확정:')) { certainty = '미확정'; t = t.slice('미확정:'.length) }
  return { types: t.split('+'), certainty }
}
