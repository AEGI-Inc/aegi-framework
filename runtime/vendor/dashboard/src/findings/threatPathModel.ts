import type { FindingV2, ThreatSubjectV2 } from '../model/findingV2'
import type { GraphStoreV2 } from '../model/graph'
import type { EvidenceObservation, FindingEvidenceLink } from '../model/evidence'
import type { FixtureObject, Provider } from '../model/object'
import { kindNoun, objectName } from '../utils/objectPhrase'
import { relationLabel } from '../semantic-graph/edgeExplain'
import { observationKindLabel } from './observationKind'
import { sortProviders } from './providers'
import { headcountText } from './headcount'

/*
 * 탐지 경로 그림의 뼈대.
 *
 * 관측 경로와 잠재 경로는 같은 판(SaaS 상자 × 단계 칸)에 그린다. 칸은 「시작」(누가, 어디서),
 * 「경유」(어떤 연동을 거쳐, 누구 권한으로), 「대상」(어디에 닿았나) 순이고, SaaS 마다 상자가
 * 하나다. 상자 사이를 건너는 선이 곧 SaaS 경계를 넘는 구간이라 따로 「핵심 경로」 표시를 달지 않는다.
 *
 * 잠재 경로는 관측 경로를 그대로 두고 구조상 가능한 선을 더한다. 두 보기에서
 * 같은 객체는 같은 자리에 있어, 탭을 바꿔도 눈이 따라간다.
 *
 * 대시보드는 판정하지 않는다. 그림에 오르는 것은 Finding 이 넘긴 객체, 증적,
 * 관계뿐이고, 그래프에서 더 찾는 것은 그 객체들 사이의 관계(실행 계정, 전달 위치 등)다.
 */

export type PathMode = 'observed' | 'possible'

/** 칸. 0 시작, 1 경유, 2 대상, 3 새로 접근하는 사람 */
export type PathRole = 'actor' | 'source' | 'via' | 'as' | 'target' | 'affected' | 'reader' | 'external'

export interface ThreatPathNode {
  id: string
  /** 눌렀을 때 고를 객체 키. 사람은 이 경로에 쓰인 계정 */
  refId: string
  role: PathRole
  column: number
  /** 같은 칸 안에서의 순서 */
  rank: number
  lane: string
  label: string
  sub: string
  objectType?: string
  interfaces?: string[]
  /** 관측된 선이 닿는 노드 */
  observed: boolean
  /** 이 위협의 대상(Finding 이 고른 대상) */
  isTarget: boolean
  /** 안에 든 기록(메시지, 커밋). 따로 점을 찍지 않고 담긴 곳 아래에 센다 */
  contents?: string
  /** 마우스를 올리면 보이는 글(사람 묶음의 이름 목록) */
  title?: string
  x: number
  y: number
}

export interface ThreatPathEdge {
  id: string
  from: string
  to: string
  kind: 'observed' | 'possible' | 'relation' | 'identity'
  label?: string
  /** 관측 시각(KST 문자열). 여럿이면 처음 ~ 끝 */
  time?: string
  /** 관측된 차례 */
  step?: number
  /** 이 선을 눌렀을 때 고를 것(증적, 관계) */
  refIds: string[]
  /** 선 이름의 전체 문장(줄인 이름일 때) */
  title?: string
}

export interface ThreatPathLane {
  id: string
  provider?: Provider
  label: string
  top: number
  height: number
}

export interface ThreatPathColumn {
  label: string
  x: number
}

export interface ThreatPathLayout {
  nodes: ThreatPathNode[]
  edges: ThreatPathEdge[]
  lanes: ThreatPathLane[]
  columns: ThreatPathColumn[]
  width: number
  height: number
  /** 위협 판정 V2 경로(buildThreatV2Path). 그림이 노드 이름 뒤를 흰 바탕으로 막아 선이 이름을 가리지 않게 한다 */
  variant?: 'v2'
}

/* ---------- 배치 치수(px) ---------- */
/** 왼쪽 여백. SaaS 이름은 상자 위 테두리에 얹어 따로 칸을 두지 않는다 */
export const LANE_GUTTER = 36
export const COLUMN_WIDTH = 300
/** 시작 칸은 이름이 점 왼쪽에 붙어 더 넓다. 사람 점과 다음 칸 사이에 선 이름 자리가 남는다 */
const FIRST_COLUMN_WIDTH = 380
const HEADER_HEIGHT = 40
const LANE_PAD = 34
/** SaaS 상자 머리(이름표) 자리 */
const LANE_HEAD = 30
/** SaaS 상자 사이 틈. 줄을 건너는 선이 이 틈을 지나며 SaaS 경계가 보인다 */
const LANE_GAP = 20
/** 아래에 이름 두 줄이 붙는 노드 한 칸 */
const ROW_BELOW = 136
/** 옆에 이름이 붙는 노드(사람 목록) 한 칸 */
const ROW_SIDE = 60
export const NODE_RADIUS = 20
const MAX_PEOPLE = 8

const ARTIFACT_TYPES = /^(message|commit|pull request)$/i
const VIA_TYPES = /project|slash command|webhook|oauth2client|app installation|^bot$|workflow|grouprule|token|forwarding/i
const RUN_AS_RELATIONS = new Set(['runs_as', 'acts_as'])
/** 그림에 같이 올릴 관계. 자리를 설명하는 것만 고른다 */
const CONTEXT_RELATIONS = new Set(['runs_as', 'acts_as', 'receives_into', 'has_role_on', 'member_of', 'registered_in', 'permits', 'applies_to', 'authenticates_with', 'owned_by'])
/** 행위자 쪽에서 일어나는 기록. 이름을 첫 선에 단다. 나머지(전송, 변경, 설정)는 대상에 닿는 선에 단다 */
const ACTOR_SIDE_KINDS = new Set(['agent_run', 'slash_request', 'credential_use', 'request_log'])
const EVIDENCE_SHORT: Record<string, string> = {
  attributed_as: '기록된 계정',
  context_used_by: '연결됨',
  correlates_by: '시각 대조',
  observed_as: '기록',
  produced: '결과',
  requested_via: '요청',
}

const kst = (iso?: string) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const k = new Date(date.getTime() + 9 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`
}

function timeRange(times: string[]): string {
  const sorted = times.filter(Boolean).sort()
  if (!sorted.length) return ''
  const first = kst(sorted[0])
  const last = kst(sorted[sorted.length - 1])
  if (first === last) return first
  // 같은 날이면 끝 시각만 줄여 적는다
  return first.slice(0, 5) === last.slice(0, 5) ? `${first} ~ ${last.slice(6)}` : `${first} ~ ${last}`
}

interface Draft {
  id: string
  refId: string
  role: PathRole
  provider: string
  label: string
  sub: string
  objectType?: string
  interfaces?: string[]
  observed: boolean
  isTarget: boolean
  contents: Map<string, number>
  title?: string
}

export function buildThreatPath(
  mode: PathMode,
  finding: FindingV2,
  graph: GraphStoreV2,
  evidenceLinks: FindingEvidenceLink[],
  observationsById: Map<string, EvidenceObservation>
): ThreatPathLayout {
  const observations = finding.evidenceObservationIds
    .map(id => observationsById.get(id))
    .filter((obs): obs is EvidenceObservation => Boolean(obs))

  /* ---------- 실행 계정(웹앱이 누구 권한으로 도는가, 커밋이 누구로 남았나) ---------- */
  const asAccounts = new Set<string>()
  for (const link of evidenceLinks) if (link.evidenceType === 'attributed_as' && link.to.kind === 'object') asAccounts.add(link.to.id)

  /* ---------- 그림에 올릴 객체 ---------- */
  const observedKeys = new Set<string>()
  for (const link of evidenceLinks) {
    if (link.from.kind === 'object') observedKeys.add(link.from.id)
    if (link.to.kind === 'object') observedKeys.add(link.to.id)
  }
  for (const obs of observations) for (const key of obs.objectKeys) observedKeys.add(key)

  const candidate = new Set<string>(observedKeys)
  if (mode === 'possible') for (const key of finding.involvedObjectKeys) candidate.add(key)

  const objectOf = (key: string) => graph.objectsByKey.get(key)
  const typeOf = (key: string) => String(objectOf(key)?.canonical.object_type ?? '')
  const isArtifact = (key: string) => ARTIFACT_TYPES.test(typeOf(key))
  const isUserAccount = (key: string) => {
    const obj = objectOf(key)
    if (!obj) return false
    return obj.canonical.interfaces.includes('Principal') && /user|account|member/i.test(obj.canonical.object_type)
  }
  const isVia = (key: string) => {
    const obj = objectOf(key)
    if (!obj) return false
    if (VIA_TYPES.test(obj.canonical.object_type)) return true
    if (obj.canonical.object_type === 'Application') return true
    return obj.canonical.interfaces.some(i => i === 'Integration' || i === 'Endpoint' || i === 'Automation' || i === 'Credential')
  }

  // 연동이 누구 권한으로 도는지는 Finding 에 없어도 그래프에서 한 번만 찾아 붙인다
  for (const key of [...candidate]) {
    if (!isVia(key)) continue
    for (const relation of graph.outgoingRelationsByObject.get(key) ?? []) {
      if (!RUN_AS_RELATIONS.has(relation.relationType) || !graph.objectsByKey.has(relation.targetKey)) continue
      asAccounts.add(relation.targetKey)
      candidate.add(relation.targetKey)
    }
  }

  /* 담긴 기록(메시지, 커밋)은 담긴 곳에 모은다 */
  const containerOf = new Map<string, string>()
  for (const key of candidate) {
    if (!isArtifact(key)) continue
    const container = (graph.outgoingRelationsByObject.get(key) ?? []).find(rel => rel.relationType === 'contained_in')?.targetKey
    if (container && graph.objectsByKey.has(container)) {
      containerOf.set(key, container)
      candidate.add(container)
    }
  }

  /* 실행 기록에 같이 적힌 사람: 증적이 그 사람에서 시작하는 계정 */
  const evidenceSources = new Set(evidenceLinks.filter(l => l.from.kind === 'object' && l.to.kind === 'observation').map(l => l.from.id))
  const producedTargets = new Set(evidenceLinks.filter(l => l.evidenceType === 'produced' && l.to.kind === 'object').map(l => l.to.id))
  const contextSources = new Set(evidenceLinks.filter(l => l.evidenceType === 'context_used_by' && l.from.kind === 'object').map(l => l.from.id))

  /* ---------- 역할 ---------- */
  const nodeIdOf = new Map<string, string>()
  const drafts = new Map<string, Draft>()

  const roleOf = (key: string): PathRole | null => {
    if (asAccounts.has(key)) return 'as'
    if (isUserAccount(key)) {
      if (producedTargets.has(key)) return 'affected'
      if (evidenceSources.has(key)) return 'actor'
      return null
    }
    if (isVia(key)) return 'via'
    if (contextSources.has(key)) return 'source'
    if ([...containerOf.values()].includes(key)) return 'target'
    return null
  }

  const addDraft = (key: string, role: PathRole) => {
    nodeIdOf.set(key, key)
    if (drafts.has(key)) return
    const obj = objectOf(key)
    drafts.set(key, {
      id: key,
      refId: key,
      role,
      provider: String(obj?.canonical.provider ?? 'external'),
      label: objectName(graph, key),
      sub: kindNoun(obj),
      objectType: obj?.canonical.object_type,
      interfaces: obj?.canonical.interfaces,
      observed: false,
      isTarget: false,
      contents: new Map(),
    })
  }

  for (const key of candidate) {
    if (!graph.objectsByKey.has(key)) continue
    if (containerOf.has(key)) continue
    const role = roleOf(key)
    if (role) addDraft(key, role)
  }
  // 담긴 기록은 담긴 곳의 노드로 이어 붙인다
  for (const [artifact, container] of containerOf) {
    const id = nodeIdOf.get(container)
    if (!id) continue
    nodeIdOf.set(artifact, id)
    const noun = kindNoun(objectOf(artifact)) || '기록'
    const draft = drafts.get(id)!
    if (observedKeys.has(artifact) || mode === 'possible') draft.contents.set(noun, (draft.contents.get(noun) ?? 0) + 1)
  }

  const columnOf = (role: PathRole) =>
    role === 'actor' || role === 'source' ? 0 : role === 'via' || role === 'as' ? 1 : role === 'reader' || role === 'external' ? 3 : 2
  // 같은 칸 안 순서: 명령, 토큰(들어가는 곳) → 스크립트 → 앱 → 웹훅(나가는 곳) → 실행 계정
  const rankOf = (draft: Draft) => {
    if (draft.role === 'as') return 5
    const type = (draft.objectType ?? '').toLowerCase()
    if (/slash command|endpoint|token|credential/.test(type)) return 0
    if (/project|workflow|grouprule/.test(type)) return 1
    if (/webhook/.test(type)) return 3
    return 2
  }

  // 메일 자동 전달처럼 조직 밖으로 나가는 곳은 객체가 없다. 설정 값의 주소로 점을 하나 둔다
  const externalEdges: Array<{ from: string; to: string; obs: EvidenceObservation }> = []
  for (const obs of observations) {
    const address = obs.attributes?.emailAddress
    if (typeof address !== 'string' || !address.includes('@')) continue
    const id = `external:${address}`
    if (drafts.has(id)) continue
    drafts.set(id, { id, refId: obs.id, role: 'external', provider: 'external', label: address, sub: '조직 밖 주소', observed: true, isTarget: false, contents: new Map() })
    for (const key of obs.objectKeys) {
      const from = nodeIdOf.get(key)
      if (from) externalEdges.push({ from, to: id, obs })
    }
  }

  /* ---------- 선 ---------- */
  type EdgeDraft = ThreatPathEdge & { times: string[]; kinds: Map<string, number> }
  const edges = new Map<string, EdgeDraft>()
  const touch = (from: string, to: string, kind: ThreatPathEdge['kind'], refId: string) => {
    const id = `${from}|${to}`
    const existing = edges.get(id) ?? edges.get(`${to}|${from}`)
    if (existing) {
      if (!existing.refIds.includes(refId)) existing.refIds.push(refId)
      if (kind === 'observed' && existing.kind !== 'observed') existing.kind = 'observed'
      return existing
    }
    const edge: EdgeDraft = { id, from, to, kind, refIds: [refId], times: [], kinds: new Map() }
    edges.set(id, edge)
    return edge
  }

  const order = (ids: string[]) =>
    [...new Set(ids)]
      .filter(id => drafts.has(id))
      .sort((a, b) => {
        const da = drafts.get(a)!
        const db = drafts.get(b)!
        return columnOf(da.role) - columnOf(db.role) || rankOf(da) - rankOf(db)
      })

  // 기록 하나에 같이 적힌 객체를 칸 순서로 잇는다
  const evidenceNeighbors = new Map<string, Set<string>>()
  const near = (a: string, b: string) => {
    if (!evidenceNeighbors.has(a)) evidenceNeighbors.set(a, new Set())
    evidenceNeighbors.get(a)!.add(b)
  }
  for (const link of evidenceLinks) {
    near(link.from.id, link.to.id)
    near(link.to.id, link.from.id)
  }

  for (const obs of observations) {
    // 기록에 적힌 객체 + 증적이 그 기록에서 이어 가는 객체(두 걸음까지)
    const keys = new Set(obs.objectKeys)
    for (const first of evidenceNeighbors.get(obs.id) ?? []) {
      if (observationsById.has(first)) continue
      keys.add(first)
      for (const second of evidenceNeighbors.get(first) ?? []) if (!observationsById.has(second)) keys.add(second)
    }
    const ids = order([...keys].map(key => nodeIdOf.get(key)).filter((id): id is string => Boolean(id)))
    if (ids.length < 2) continue
    const groups: string[][] = []
    for (const id of ids) {
      const column = columnOf(drafts.get(id)!.role)
      const last = groups[groups.length - 1]
      if (last && columnOf(drafts.get(last[0])!.role) === column) last.push(id)
      else groups.push([id])
    }
    const chain: Array<[string, string]> = []
    groups.forEach((group, index) => {
      // 경유 칸 안에서는 연동 → 실행 계정 순으로 잇는다
      if (columnOf(drafts.get(group[0])!.role) === 1) for (let i = 1; i < group.length; i++) chain.push([group[i - 1], group[i]])
      const next = groups[index + 1]
      if (!next) return
      const exits = columnOf(drafts.get(group[0])!.role) === 1 ? [group[group.length - 1]] : group
      for (const from of exits) chain.push([from, next[0]])
    })
    if (!chain.length) continue
    // 기록 이름은 사람에서 나가는 선이나 대상에 닿는 선에만 단다. 작성자가 자기 웹앱을 연 기록처럼
    // 둘 다 없으면 선만 빨갛게 하고 이름은 관계(실행 계정)를 쓴다
    const startsAtActor = columnOf(drafts.get(chain[0][0])!.role) === 0
    const endsAtTarget = columnOf(drafts.get(chain[chain.length - 1][1])!.role) >= 2
    const labelAt = ACTOR_SIDE_KINDS.has(obs.kind)
      ? (startsAtActor ? 0 : endsAtTarget ? chain.length - 1 : -1)
      : (endsAtTarget ? chain.length - 1 : startsAtActor ? 0 : -1)
    chain.forEach(([from, to], index) => {
      const edge = touch(from, to, 'observed', obs.id)
      if (index === labelAt) {
        edge.kinds.set(obs.kind, (edge.kinds.get(obs.kind) ?? 0) + 1)
        if (obs.occurredAt) edge.times.push(obs.occurredAt)
      }
      drafts.get(from)!.observed = true
      drafts.get(to)!.observed = true
    })
  }

  // 객체끼리 바로 잇는 증적(커밋 → 기록된 계정, 시트 → 붙은 스크립트)
  for (const link of evidenceLinks) {
    if (link.from.kind !== 'object' || link.to.kind !== 'object') continue
    const from = nodeIdOf.get(link.from.id)
    const to = nodeIdOf.get(link.to.id)
    if (!from || !to || from === to) continue
    const [a, b] = order([from, to])
    if (!a || !b) continue
    const edge = touch(a, b, 'observed', link.id)
    if (!edge.label) {
      edge.label = EVIDENCE_SHORT[link.evidenceType] ?? link.evidenceType
      edge.title = link.label
    }
    drafts.get(a)!.observed = true
    drafts.get(b)!.observed = true
  }

  for (const { from, to, obs } of externalEdges) {
    const edge = touch(from, to, 'observed', obs.id)
    edge.kinds.set(obs.kind, (edge.kinds.get(obs.kind) ?? 0) + 1)
    if (obs.occurredAt) edge.times.push(obs.occurredAt)
    drafts.get(from)!.observed = true
  }

  // 그림에 오른 객체 사이의 관계(실행 계정, 전달 위치, 권한)
  const relationKeys = new Set(finding.involvedRelationKeys)
  for (const [key, id] of nodeIdOf) {
    for (const relation of graph.outgoingRelationsByObject.get(key) ?? []) {
      const other = nodeIdOf.get(relation.targetKey)
      if (!other || other === id) continue
      if (!CONTEXT_RELATIONS.has(relation.relationType) && !relationKeys.has(relation.relationKey)) continue
      // 관측 보기에는 관측된 객체끼리의 관계만
      if (mode === 'observed' && !(drafts.get(id)!.observed && drafts.get(other)!.observed)) continue
      const [a, b] = order([id, other])
      if (!a || !b) continue
      // 사람끼리, 같은 칸의 대상끼리는 잇지 않는다(멤버십이 대상 칸을 어지럽힌다)
      if (columnOf(drafts.get(a)!.role) === columnOf(drafts.get(b)!.role) && columnOf(drafts.get(a)!.role) !== 1) continue
      // 시작 칸 사람의 다른 권한(조직 역할 등)은 그림을 가로지르는 긴 선이 되어 경로를 가린다. 상세에서 본다
      if (drafts.get(a)!.role === 'actor') continue
      const edge = touch(a, b, 'relation', relation.relationKey)
      if (!edge.label && !edge.kinds.size) edge.label = relationLabel(relation.relationType)
    }
  }

  /* ---------- 잠재 경로: 구조상 가능한 선 ---------- */
  if (mode === 'possible') {
    const all = [...drafts.values()]
    const vias = all.filter(d => d.role === 'via').sort((a, b) => rankOf(a) - rankOf(b))
    const target = all.find(d => d.role === 'target')
    // 경유 칸에서 이어지지 않은 앞뒤(그룹 규칙 → 그룹)는 가능한 경로로 잇는다
    for (let i = 1; i < vias.length; i++) {
      const [a, b] = [vias[i - 1], vias[i]]
      if (![...edges.values()].some(e => (e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id))) touch(a.id, b.id, 'possible', finding.id)
    }
    if (target) {
      const reaches = [...edges.values()].some(e => e.to === target.id || e.from === target.id)
      if (!reaches) {
        // 대상과 같은 SaaS 의 경유 노드가 있으면 그쪽에서, 없으면 마지막 경유에서
        const from = [...vias].reverse().find(d => d.provider === target.provider) ?? vias[vias.length - 1]
        if (from && from.id !== target.id) touch(from.id, target.id, 'possible', finding.id)
      }
    }
  }

  /* ---------- 관측 보기는 관측된 것만 ---------- */
  const nodeList = [...drafts.values()].filter(d => mode === 'possible' || d.observed)
  const visible = new Set(nodeList.map(d => d.id))
  const edgeList = [...edges.values()].filter(e => visible.has(e.from) && visible.has(e.to))

  // 관측 차례: 처음 기록된 시각 순
  const timed = edgeList.filter(e => e.kind === 'observed' && e.times.length).sort((a, b) => [...a.times].sort()[0].localeCompare([...b.times].sort()[0]))
  timed.forEach((edge, index) => { edge.step = index + 1 })

  const finalEdges: ThreatPathEdge[] = edgeList.map(edge => {
    let label = edge.label
    if (edge.kinds.size) {
      label = [...edge.kinds.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([kind, count]) => `${observationKindLabel(kind)}${count > 1 ? ` ${count}건` : ''}`)
        .join(', ')
    }
    return { id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, label, time: timeRange(edge.times) || undefined, step: edge.step, refIds: edge.refIds, title: edge.title }
  })

  const COLUMN_LABEL: Record<number, string> = { 0: '시작', 1: '경유', 2: '대상', 3: '도착' }
  return place(nodeList, finalEdges, draft => columnOf(draft.role), rankOf, column => COLUMN_LABEL[column])
}

/**
 * 위협 판정 V2 위협의 잠재 경로.
 *
 * 엔진이 준 경로(path.hops)를 그대로 그린다. 칸은 시작(위협 사람), 경유(point 와 실행 신원 같은 중간 객체),
 * 대상(target), 권한이 생기는 인원이다. 선 이름은 간선 종류(호출, 실행 신원, 권한, 데이터 흐름 등)이고,
 * 사람에서 point 로 가는 선은 그 사람의 entry 종류다. 마지막 칸은 새로 권한이 생기는 사람(subjects)과
 * 대상에 원래 직접 닿는 사람을 두 점으로 나눈다. 직접 접근 인원은 그래프의 소속, 역할 관계로 센다(directAccessPeople).
 */
export function buildThreatV2Path(finding: FindingV2, graph: GraphStoreV2): ThreatPathLayout {
  const path = finding.threatPath
  if (!path || !path.hops.length) return { nodes: [], edges: [], lanes: [], columns: [], width: 0, height: 0 }
  const subjects = finding.threatSubjects ?? []
  const objectOf = (key: string) => graph.objectsByKey.get(key)

  /* ---------- 노드 키 → 그림 노드. 가상 키(mail:, outside:, attr:, @everyone)는 보이는 객체로 바꾼다 ---------- */
  const drafts = new Map<string, Draft>()
  const column = new Map<string, number>()
  const rank = new Map<string, number>()
  const virtual = (key: string): { ref: string; provider: string; label: string; sub: string; obj?: FixtureObject } => {
    if (key.startsWith('mail:')) {
      const account = key.slice('mail:'.length)
      const obj = objectOf(account)
      // 메일 내용은 계정의 메일함으로 보인다
      return { ref: account, provider: String(obj?.canonical.provider ?? 'external'), label: obj ? objectName(graph, account) : account, sub: '메일함', obj }
    }
    if (key.startsWith('outside')) return { ref: key, provider: 'external', label: '조직 밖 주소', sub: '' }
    if (key.startsWith('attr:')) {
      const owner = key.slice('attr:'.length).replace(/:[^:]*$/, '')
      const obj = objectOf(owner)
      return { ref: owner, provider: String(obj?.canonical.provider ?? 'external'), label: obj ? objectName(graph, owner) : '사용자 속성', sub: '사용자 속성' }
    }
    if (key === '@everyone') return { ref: key, provider: 'external', label: '누구나', sub: '' }
    const obj = objectOf(key)
    return { ref: key, provider: String(obj?.canonical.provider ?? 'external'), label: obj ? objectName(graph, key) : key, sub: kindNoun(obj), obj }
  }
  const addNode = (id: string, key: string, role: PathRole, at: number, order: number, isTarget = false) => {
    if (drafts.has(id)) return
    const v = virtual(key)
    drafts.set(id, {
      id,
      refId: v.ref,
      role,
      provider: v.provider,
      label: v.label,
      sub: v.sub,
      objectType: v.obj?.canonical.object_type,
      interfaces: v.obj?.canonical.interfaces,
      observed: false,
      isTarget,
      contents: new Map(),
    })
    column.set(id, at)
    rank.set(id, order)
  }

  // point 는 경유, target 은 대상, 그 사이 객체(실행 신원 등)는 경유 칸의 point 아래. point 가 곧 target 이면 대상 칸 하나
  const target = path.target
  addNode(target, target, 'target', 2, 0, true)
  addNode(path.point, path.point, 'via', 1, 0)
  for (const hop of path.hops) for (const key of [hop.from, hop.to]) addNode(key, key, 'as', 1, 5)

  /* ---------- 선. 이름은 간선 종류 ---------- */
  const edges = new Map<string, ThreatPathEdge>()
  const relationBetween = (a: string, b: string) =>
    (graph.outgoingRelationsByObject.get(a) ?? []).find(rel => rel.targetKey === b)?.relationKey
    ?? (graph.outgoingRelationsByObject.get(b) ?? []).find(rel => rel.targetKey === a)?.relationKey
  const link = (from: string, to: string, kind: ThreatPathEdge['kind'], label: string | undefined, refId: string) => {
    const id = `${from}|${to}`
    const existing = edges.get(id)
    if (existing) {
      if (label && !(existing.label ?? '').split(', ').includes(label)) existing.label = existing.label ? `${existing.label}, ${label}` : label
      return
    }
    edges.set(id, { id, from, to, kind, label, refIds: [refId] })
  }
  for (const hop of path.hops) {
    // 자기 자신으로 가는 간선(저장소가 자기 비밀값을 보관)은 점 하나라 선을 그리지 않는다
    if (hop.from === hop.to) continue
    link(hop.from, hop.to, 'possible', hop.kind, relationBetween(virtual(hop.from).ref, virtual(hop.to).ref) ?? virtual(hop.to).ref)
  }

  /* ---------- 시작 칸: 위협 사람. 많으면 앞의 몇 명과 「외 N명」 ---------- */
  const shown = subjects.slice(0, subjects.length > MAX_PEOPLE ? MAX_PEOPLE - 1 : MAX_PEOPLE)
  const rest = subjects.slice(shown.length)
  const labelled = new Set<string>()
  // 같은 종류 이름은 한 번만 단다. 사람이 많으면 「호출」이 줄줄이 쌓인다
  const entryLabel = (entry: string | undefined) => {
    if (!entry || labelled.has(entry)) return undefined
    labelled.add(entry)
    return entry
  }
  for (const subject of shown) {
    const id = `person:${subject.person}`
    addNode(id, subject.person, 'actor', 0, 0)
    link(id, path.point, 'possible', entryLabel(subject.entry), virtual(subject.person).ref)
  }
  if (rest.length) {
    const id = 'people-rest:actor'
    const lane = drafts.get(`person:${shown[shown.length - 1].person}`)!.provider
    drafts.set(id, { id, refId: virtual(rest[0].person).ref, role: 'actor', provider: lane, label: `외 ${rest.length}명`, sub: rest.map(s => virtual(s.person).label).join(', '), observed: false, isTarget: false, contents: new Map() })
    column.set(id, 0)
    rank.set(id, 9)
    const entries = [...new Set(rest.map(s => s.entry))]
    link(id, path.point, 'possible', entries.length === 1 ? entryLabel(entries[0]) : undefined, virtual(rest[0].person).ref)
  }

  /* ---------- 차단 지점 선. 엔진은 사람이 대상에 닿는 모든 경로에서 차단 지점을 찾는데 그림은 대표 경로 하나다.
     그림에 없는 차단 선과 그 끝 객체를 경유 칸에 더해, 차단 지점 표의 줄을 누르면 그 선이 빨갛게 남게 한다.
     11-13 실측에서 차단 선 35개 중 대표 경로에 있던 것은 5개였다 ---------- */
  const shownNode = (key: string) => (drafts.has(`person:${key}`) ? `person:${key}` : key)
  for (const cut of finding.threatCuts ?? []) for (const at of [cut.at, ...(cut.with ?? [])]) {
    const id = `${at.from}|${at.to}`
    // 자기 자신 간선은 노드에 배지만 단다. 호출 제한(from *)은 사람마다 선이 이미 있다
    if (at.from === at.to || at.from === '*' || at.to === '*' || edges.has(id)) continue
    const from = shownNode(at.from)
    const to = shownNode(at.to)
    addNode(from, at.from, 'as', 1, 6)
    addNode(to, at.to, 'as', 1, 6)
    edges.set(id, { id, from, to, kind: 'possible', label: at.kind, refIds: [relationBetween(virtual(at.from).ref, virtual(at.to).ref) ?? virtual(at.to).ref] })
  }

  /* ---------- 권한이 생기는 인원: 위협 사람, 직접 접근 ---------- */
  const targetDraft = drafts.get(target)!
  if (subjects.length) {
    const id = 'people-derived'
    drafts.set(id, { id, refId: virtual(subjects[0].person).ref, role: 'reader', provider: targetDraft.provider, label: finding.threatHeadcount ? headcountText(finding.threatHeadcount) : `${subjects.length}명`, sub: '', title: subjects.map(s => virtual(s.person).label).join(', '), observed: false, isTarget: false, contents: new Map() })
    column.set(id, 3)
    rank.set(id, 0)
    edges.set(`${target}|${id}`, { id: `${target}|${id}`, from: target, to: id, kind: 'possible', label: gainLabel(subjects), refIds: [targetDraft.refId] })
  }
  // 경로 위 객체(실행 신원 계정 등)는 사람으로 세지 않는다. 대상 자신(메일함 주인 계정)은 센다
  const pathKeys = new Set(path.hops.flatMap(hop => [virtual(hop.from).ref, virtual(hop.to).ref]))
  pathKeys.delete(targetDraft.refId)
  const direct = directAccessPeople(graph, target, pathKeys, subjects.map(s => s.person))
  if (direct.length) {
    const id = 'people-direct'
    drafts.set(id, { id, refId: direct[0], role: 'reader', provider: targetDraft.provider, label: `직접 접근 ${direct.length}명`, sub: '', title: direct.map(key => objectName(graph, key)).join(', '), observed: false, isTarget: false, contents: new Map() })
    column.set(id, 3)
    rank.set(id, 1)
    edges.set(`${target}|${id}`, { id: `${target}|${id}`, from: target, to: id, kind: 'relation', label: '원래 접근', refIds: [direct[0]] })
  }

  const COLUMN_LABEL: Record<number, string> = { 0: '시작', 1: '경유', 2: '대상', 3: '권한이 생기는 인원' }
  // 대상 칸을 넓혀 대상에서 인원 두 점으로 가는 선 이름이 대상 이름과 겹치지 않게 한다
  const layout = place([...drafts.values()], [...edges.values()], draft => column.get(draft.id) ?? 1, draft => rank.get(draft.id) ?? 0, at => COLUMN_LABEL[at], { 2: V2_TARGET_COLUMN_WIDTH, 3: V2_PEOPLE_COLUMN_WIDTH })
  return { ...layout, variant: 'v2' }
}

/** V2 경로의 대상 칸 폭. 선 이름(최대 200px)이 대상 이름(최대 210px) 오른쪽에 놓인다 */
const V2_TARGET_COLUMN_WIDTH = 480
/** V2 경로의 마지막 칸 폭. 점이 칸 왼쪽에 붙고 이름(「30명과 누구나」)이 오른쪽에 붙는다 */
const V2_PEOPLE_COLUMN_WIDTH = 220

/**
 * 위협 사람에게 새로 생기는 것. 엔진이 사람마다 실은 새로 얻은 수준(levels, 2026-11-19)을 읽는다. 유형 이름은 읽기와 쓰기를 담지 않는다.
 * 새 읽기는 새로 읽기 가능(데이터 반출 사람이면 조직 밖에서 읽기 가능), 새 쓰기나 관리는 새로 수정 가능
 */
function gainLabel(subjects: ThreatSubjectV2[]): string {
  const has = new Set<string>()
  for (const s of subjects) {
    const lv = s.levels ?? []
    if (lv.includes('읽기')) has.add(s.types.includes('데이터 반출') ? 'out' : 'read')
    if (lv.includes('쓰기') || lv.includes('관리')) has.add('write')
  }
  return [...(has.has('read') ? ['새로 읽기 가능'] : []), ...(has.has('out') ? ['조직 밖에서 읽기 가능'] : []), ...(has.has('write') ? ['새로 수정 가능'] : [])].join(', ')
}

/** 대상에 직접 닿는 관계. 소속(멤버), 역할 */
const DIRECT_ACCESS_RELATIONS = new Set(['member_of', 'has_role_on'])

/**
 * 대상에 원래 직접 닿는 사람의 계정. 대상으로 들어오는 소속, 역할 관계를 거꾸로 세 걸음까지 따라가
 * 사용자 계정을 모으고(그룹, 팀은 거쳐 간다), 대상의 소유자(owned_by)와 메일함 주인(mail:계정)을 더한다.
 * 경로 위 객체(실행 신원)와 위협 사람(같은 사람의 다른 계정 포함)은 뺀다. 같은 사람의 계정은 한 명으로 센다.
 */
function directAccessPeople(graph: GraphStoreV2, targetKey: string, pathKeys: Set<string>, derived: string[]): string[] {
  const isUser = (key: string) => {
    const obj = graph.objectsByKey.get(key)
    // GitHub 저장소 협업자(simple-user)는 Principal 표시 없이 들어온다. 종류 이름으로 사용자 계정을 고른다
    return Boolean(obj && !obj.canonical.interfaces.includes('Credential') && /user|account|member/i.test(obj.canonical.object_type))
  }
  const isGroup = (key: string) => /group|team|role/i.test(String(graph.objectsByKey.get(key)?.canonical.object_type ?? ''))
  const personOf = (key: string) => graph.linkIdsByObject?.get(key)?.[0] ?? key
  const accounts = new Set<string>()
  const start = targetKey.startsWith('mail:') ? targetKey.slice('mail:'.length) : targetKey
  if (start !== targetKey && isUser(start)) accounts.add(start)
  for (const rel of graph.outgoingRelationsByObject.get(start) ?? []) if (rel.relationType === 'owned_by' && isUser(rel.targetKey)) accounts.add(rel.targetKey)
  let frontier = [start]
  const seen = new Set(frontier)
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next: string[] = []
    for (const key of frontier) {
      for (const rel of graph.incomingRelationsByObject.get(key) ?? []) {
        if (!DIRECT_ACCESS_RELATIONS.has(rel.relationType) || seen.has(rel.sourceKey)) continue
        seen.add(rel.sourceKey)
        if (isUser(rel.sourceKey)) accounts.add(rel.sourceKey)
        else if (isGroup(rel.sourceKey)) next.push(rel.sourceKey)
      }
    }
    frontier = next
  }
  const excluded = new Set(derived.map(personOf))
  const people = new Map<string, string>()
  for (const key of accounts) {
    if (pathKeys.has(key) || excluded.has(personOf(key))) continue
    if (!people.has(personOf(key))) people.set(personOf(key), key)
  }
  return [...people.values()]
}

function place(
  drafts: Draft[],
  edges: ThreatPathEdge[],
  columnOf: (draft: Draft) => number,
  rankOf: (draft: Draft) => number,
  columnLabel: (column: number, last: boolean) => string,
  /** 칸마다 따로 정한 폭. 없으면 시작 칸 FIRST_COLUMN_WIDTH, 나머지 COLUMN_WIDTH */
  widths: Record<number, number> = {}
): ThreatPathLayout {
  if (!drafts.length) return { nodes: [], edges: [], lanes: [], columns: [], width: 0, height: 0 }

  const usedColumns = [...new Set(drafts.map(d => columnOf(d)))].sort((a, b) => a - b)
  const columnIndex = new Map(usedColumns.map((column, index) => [column, index]))
  const widthOf = (column: number) => widths[column] ?? (column === 0 ? FIRST_COLUMN_WIDTH : COLUMN_WIDTH)
  const columnBox = (column: number) => {
    let left = LANE_GUTTER
    for (const used of usedColumns) {
      if (used === column) break
      left += widthOf(used)
    }
    return { center: left + widthOf(column) / 2, width: widthOf(column) }
  }

  // SaaS 줄 순서: 흐름이 먼저 지나는 SaaS 부터
  const firstColumn = new Map<string, number>()
  for (const draft of drafts) {
    const column = columnOf(draft)
    firstColumn.set(draft.provider, Math.min(firstColumn.get(draft.provider) ?? 9, column))
  }
  const providerOrder = sortProviders([...firstColumn.keys()].filter(p => p !== 'external'))
  const laneIds = [...firstColumn.keys()].sort((a, b) => {
    if (a === 'external') return 1
    if (b === 'external') return -1
    return firstColumn.get(a)! - firstColumn.get(b)! || providerOrder.indexOf(a as Provider) - providerOrder.indexOf(b as Provider)
  })

  const sideLabelled = (draft: Draft) => draft.role === 'actor' || draft.role === 'source' || draft.role === 'reader' || draft.role === 'external'
  const cells = new Map<string, Draft[]>()
  for (const draft of drafts) {
    const key = `${draft.provider}|${columnOf(draft)}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key)!.push(draft)
  }
  for (const list of cells.values()) {
    list.sort((a, b) => Number(b.observed) - Number(a.observed) || rankOf(a) - rankOf(b) || Number(a.id.startsWith('people-rest')) - Number(b.id.startsWith('people-rest')) || a.label.localeCompare(b.label))
  }

  const cellHeight = (list: Draft[]) => list.reduce((sum, d) => sum + (sideLabelled(d) ? ROW_SIDE : ROW_BELOW), 0)
  const lanes: ThreatPathLane[] = []
  let top = HEADER_HEIGHT
  const nodes: ThreatPathNode[] = []
  for (const laneId of laneIds) {
    const heights = usedColumns.map(column => cellHeight(cells.get(`${laneId}|${column}`) ?? []))
    const height = Math.max(...heights) + LANE_PAD * 2 + LANE_HEAD
    lanes.push({ id: laneId, provider: laneId === 'external' ? undefined : (laneId as Provider), label: laneId === 'external' ? '조직 밖' : laneId, top, height })
    for (const column of usedColumns) {
      const list = cells.get(`${laneId}|${column}`) ?? []
      const used = cellHeight(list)
      // 칸 안에서 세로 가운데에 모은다
      let y = top + LANE_HEAD + LANE_PAD + (height - LANE_HEAD - LANE_PAD * 2 - used) / 2
      const { center, width } = columnBox(column)
      for (const draft of list) {
        const side = sideLabelled(draft)
        const row = side ? ROW_SIDE : ROW_BELOW
        // 왼쪽 칸 사람은 이름을 점 왼쪽에, 오른쪽 끝 칸은 오른쪽에 둔다
        const x = draft.role === 'reader' || draft.role === 'external' ? center - width / 2 + 40 : side ? center + width / 2 - 130 : center
        nodes.push({
          id: draft.id,
          refId: draft.refId,
          role: draft.role,
          column: columnIndex.get(column)!,
          rank: rankOf(draft),
          lane: laneId,
          label: draft.label,
          sub: draft.sub,
          objectType: draft.objectType,
          interfaces: draft.interfaces,
          observed: draft.observed,
          isTarget: draft.isTarget,
          contents: draft.contents.size ? [...draft.contents.entries()].map(([noun, count]) => `${noun} ${count}개`).join(', ') : undefined,
          title: draft.title,
          x,
          y: y + (side ? ROW_SIDE / 2 : NODE_RADIUS + 14),
        })
        y += row
      }
    }
    top += height + LANE_GAP
  }

  const columns = usedColumns.map((column, index) => ({ label: columnLabel(column, index === usedColumns.length - 1), x: columnBox(column).center }))
  const last = columnBox(usedColumns[usedColumns.length - 1])
  return { nodes, edges, lanes, columns, width: last.center + last.width / 2 + 24, height: top - LANE_GAP + 12 }
}
