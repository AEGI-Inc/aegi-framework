// 위협 판정 V2 간선 어휘 (docs/spec/AEGI_THREAT_JUDGMENT_V2.md 3절)
//
// 지금 EdgeIndex 간선 7종(M U G T A F E)에 이름만 붙인다. 판정 쪽에서 새 간선 종류를 만들지 않는다(2026-11-15 결정).
// 자원 안에 든 자격증명은 relation 효과 표가 낸 범위 간선으로 닿는다. relation 규칙과 object 스키마는 고치지 않는다.
import type { Edge, EdgeRef } from '../v2/engine/types'
import type { GraphStoreV2 } from '../../model/graph'
import { allows, edgeCaps, needOf } from '../v2/engine/semantic/ceiling'

export type EdgeName = '소속' | '범위' | '권한' | '호출' | '실행 신원' | '데이터 흐름' | '효과'

export const DIRECT: ReadonlySet<EdgeName> = new Set<EdgeName>(['소속', '범위', '권한'])

const NAME: Record<string, EdgeName> = { M: '소속', U: '범위', G: '권한', T: '호출', A: '실행 신원', F: '데이터 흐름', E: '효과' }

/** 행위 수준 비트. 세 값이 따로 켜진다 */
export const READ = 1
export const WRITE = 2
export const ADMIN = 4

/** capabilities.yaml rank(읽기 1, 쓰기 3, 관리 5)를 비트로. 모르면 0 */
export function levelBits(rank: number | undefined): number {
  if (rank === undefined) return 0
  return (rank >= 1 ? READ : 0) | (rank >= 3 ? WRITE : 0) | (rank >= 5 ? ADMIN : 0)
}

/**
 * 권한 간선 하나가 자기 대상에 주는 수준 비트. 직접 권한 규칙(directAccess.ts grantAt)과 같은 판단(allows)이라
 * 로그인(authenticate)과 권한 주기만 있는 간선은 수준이 없다(capabilities.yaml capability_levels none)
 */
export function edgeLevelBits(e: Pick<Edge, 'caps' | 'rank'>): number {
  if (e.caps === undefined && e.rank === undefined) return 0
  const caps = edgeCaps(e)
  return (allows(caps, e.rank, needOf('read')) ? READ : 0) | (allows(caps, e.rank, needOf('write')) ? WRITE : 0) | (allows(caps, e.rank, needOf('admin')) ? ADMIN : 0)
}

/** 호출자 목록을 모른다고 보는 사유. 입구의 호출 제한을 확인 못 함 */
const CALLERS_UNKNOWN = new Set(['invoker_gate_not_stored'])
/** 실행 신원의 동작 범위를 모른다고 보는 사유 */
const SCOPE_UNKNOWN = new Set(['automation_behavior_unknown', 'token_scope_unmapped', 'token_scope_limited'])
/** 누구나 내용 입력(폼 제출)으로 보는 사유. 응답자를 모르는 것을 누구나 게시로 옮겨 적은 것이라 직접 권한의 「모름」이 아니다 */
export const SUBMIT_ONLY: ReadonlySet<string> = new Set(['form_responders_unknown'])

export interface VocabEdge {
  id: string
  name: EdgeName
  derived: boolean
  from: string
  to: string
  /** READ, WRITE, ADMIN 비트 */
  level: number
  /** 웹훅 게시, 폼 제출. 쓰기만 있고 읽기 없음 */
  postOnly: boolean
  /** 호출 간선만. 호출할 수 있는 사람이 확인됐는가 */
  allowedCallers?: 'known' | 'unknown'
  /** 실행 신원 간선만. 신원이 할 수 있는 동작 범위를 아는가 */
  actionScope?: 'known' | 'unknown'
  certain: boolean
  reasons: string[]
  refs: EdgeRef[]
  /** 설정으로 회수할 수 있는 간선. 벤더가 적어 준 부여(basis stated, decomposable 이 false 아님)만. Path_Rule_Schema_v1 「회수 지점」과 같은 기준 */
  revocable: boolean
  /** 권한 간선. 상위 범위에서 내려올 때 닿는 객체 종류(소문자). 없으면 전부 */
  appliesTo?: string[]
}

/** 어휘가 읽는 것. EdgeIndex 가 그대로 맞는다 */
export interface VocabSource {
  readonly edges: Map<string, Edge>
  readonly graph: GraphStoreV2
  has(key: string, iface: string): boolean
}

function relationTypes(src: VocabSource, refs: EdgeRef[]): Set<string> {
  const out = new Set<string>()
  for (const r of refs) if (r.type === 'relation') {
    const rel = src.graph.relationsByKey.get(r.id)
    if (rel) out.add(rel.relationType)
  }
  return out
}

/** 지금 간선 하나를 어휘 간선으로 */
export function fromEdge(src: VocabSource, e: Edge): VocabEdge {
  const name = NAME[e.kind]
  const reasons = [...e.uncertain]
  let level = 0
  let postOnly = false
  if (name === '권한') {
    level = edgeLevelBits(e)
    const endpointPost = src.has(e.from, 'Endpoint') && relationTypes(src, e.refs).has('receives_into')
    const submit = e.uncertain.some(r => SUBMIT_ONLY.has(r.split(':')[0]))
    if (endpointPost || submit) {
      postOnly = true
      level = WRITE
    }
  } else if (name === '실행 신원' || name === '효과') {
    level = WRITE
  } else if (name === '데이터 흐름') {
    level = READ
  }
  const out: VocabEdge = { id: e.id, name, derived: !DIRECT.has(name), from: e.from, to: e.to, level, postOnly, certain: reasons.length === 0, reasons, refs: e.refs, revocable: e.revocable }
  if (e.appliesTo?.length) out.appliesTo = e.appliesTo
  if (name === '호출') out.allowedCallers = e.uncertain.some(r => CALLERS_UNKNOWN.has(r.split(':')[0])) ? 'unknown' : 'known'
  if (name === '실행 신원') out.actionScope = e.uncertain.some(r => SCOPE_UNKNOWN.has(r.split(':')[0])) ? 'unknown' : 'known'
  return out
}

/**
 * 능력이 「남에게 권한 주기(grant)」뿐인 권한 간선. 대상의 내용을 읽거나 대상을 고치는 길이 아니어서 위협 판정 어휘에 넣지 않는다.
 * 세기(rank 5)로 옮기면 관리가 되어 「자동화 편집」으로 읽히기 때문이다. 예: 설정 조건 표의 「구성원이 앱에 scope 를 준다」는 앱을 고치는 것이 아니다
 */
export const grantOnly = (e: Pick<Edge, 'caps'>) => !!e.caps?.length && e.caps.every(c => c === 'grant')

/** 판정이 쓰는 간선 전부 */
export function buildVocabulary(src: VocabSource): VocabEdge[] {
  return [...src.edges.values()].filter(e => !grantOnly(e)).map(e => fromEdge(src, e))
}
