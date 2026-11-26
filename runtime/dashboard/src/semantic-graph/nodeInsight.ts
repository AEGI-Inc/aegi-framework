import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { FixtureObject } from '../model/object'
import type { FindingV2 } from '../model/findingV2'
import type { EffectiveAccessRow } from '../detection/v2/effectiveAccess/types'
import { EA_RULE_LABEL, explainEaRow, type EaExplanation } from '../findings/eaExplain'
import { linkLevelCopy, objectRef, type ObjectRef } from './edgeExplain'
import { BASIS_PROPERTIES } from './projectEdges'
import { providerName } from '../findings/providers'
import type { SecurityScopeKind } from './types'
import { objectName } from '../utils/objectPhrase'
import { providerText, typeText } from '../data/displayTextStore'

/**
 * Cross-SaaS Graph 상세 패널에 쓰는 "이게 뭔가 · 보안상 무슨 뜻인가" 풀이.
 *
 * 수집한 값(식별자 · 카탈로그 ID)을 늘어놓는 대신
 * - SaaS 요약(L1): 그 SaaS 가 회사에서 맡는 역할, 규모, Effective Access 가 걸린 곳
 * - 조직 · 그룹(L2 · L3): 무엇이 들어 있고 무엇과 이어지는가
 * - 개별 항목(L4): 자연어 설명, 이 항목에 걸린 Effective Access, 연결된 항목
 * 을 만든다. 모든 문장은 저장된 객체 · 관계 · Link 와 계산 결과(effective_access)에서만 나온다.
 */

type Graph = GraphStore | GraphStoreV2

// ---------------------------------------------------------------------------
// SaaS · 인터페이스 · 객체 종류의 뜻
// ---------------------------------------------------------------------------

/**
 * SaaS 하나의 역할과 특징. 문구의 정본은 aegi-adapter-engine display-text/types/<provider>.yaml 이고,
 * 게시 때 스냅샷의 display_text 문서로 온다(data/displayTextStore.ts). 문서에 없는 SaaS 는 undefined 다.
 */
export const providerProfile = (provider: string): { role: string; points: string[] } | undefined => providerText(provider)

export const INTERFACE_COPY: Record<string, { label: string; meaning: string }> = {
  Tenant: { label: '테넌트', meaning: '조직, 워크스페이스 자체' },
  Principal: { label: '주체', meaning: '권한을 갖고 행동하는 사람, 그룹, 서비스' },
  Resource: { label: '리소스', meaning: '데이터, 코드, 채널처럼 접근 대상이 되는 것' },
  Policy: { label: '정책, 역할', meaning: '무엇을 할 수 있는지 정하는 규칙' },
  Assignment: { label: '배정', meaning: '누구에게 무엇을 줬는지의 기록' },
  Integration: { label: '연동', meaning: '다른 서비스와 연결하는 앱' },
  Credential: { label: '자격증명', meaning: '토큰, 키, MFA 처럼 인증에 쓰는 것' },
  Endpoint: { label: '엔드포인트', meaning: '데이터 송수신 주소, 웹훅 등' },
  Automation: { label: '자동화', meaning: '사람 없이 실행되는 스크립트, 워크플로' },
}

export const SCOPE_KIND_MEANING: Partial<Record<SecurityScopeKind, string>> = {
  Group: '권한을 일괄 부여하는 사용자 그룹',
  Identity: '그룹 미소속 계정, 주체 모음',
  'Tenant Policy': '테넌트 전체에 적용되는 정책, 역할 모음',
  Team: '저장소 권한을 묶는 팀',
  Repository: '저장소와 그 안의 코드, 워크플로',
  'Access Role': '권한을 정하는 역할 모음',
  Integration: '다른 서비스와 연결하는 연동 앱 모음',
  'File / Resource': '문서, 파일 같은 데이터 모음',
  Workspace: '워크스페이스 전체',
  Channel: '채널과 그 안의 메시지, 멤버십',
  'User Group': '사용자 그룹과 그 구성원',
  'Automation / Endpoint': '자동화, 웹훅, 명령 주소 모음',
  'Tenant / Administration': '테넌트 관리 항목',
}

/** 묶음 종류의 화면 이름 */
export const SCOPE_KIND_LABEL: Record<SecurityScopeKind, string> = {
  Group: '그룹',
  Identity: '계정',
  'Tenant Policy': '조직 정책',
  Team: '팀',
  Repository: '저장소',
  'Access Role': '역할',
  Integration: '연동 앱',
  'File / Resource': '파일',
  Workspace: '워크스페이스',
  Channel: '채널',
  'User Group': '사용자 그룹',
  'Automation / Endpoint': '자동화',
  'Tenant / Administration': '조직 관리',
}

export function providerLabel(provider: string): string {
  return providerName(provider)
}

function objName(graph: Graph, key: string): string {
  return 'linksById' in graph ? objectName(graph as GraphStoreV2, key) : String(graph.objectsByKey.get(key)?.fixture_meta?.display_name ?? key)
}

function principalWord(obj: FixtureObject): string {
  const kind = obj.canonical.judged?.principal_kind
  const type = obj.canonical.object_type.toLowerCase()
  if (kind === 'group' || /group|team/.test(type)) return '그룹'
  if (kind === 'service' || /bot|client|app/.test(type)) return '서비스 주체'
  if (kind === 'human') return '사람 계정'
  return '계정'
}

export function typeMeaning(obj: FixtureObject): string {
  // 정본은 engine display-text/types. 문서에 없는 종류는 인터페이스로 기계적으로 풀어 쓴다
  const own = typeText(obj.canonical.provider, obj.canonical.object_type)
  if (own) return own
  const iface = obj.canonical.interfaces[0]
  if (iface === 'Principal') return `${obj.canonical.object_type} ${principalWord(obj)}`
  const copy = iface ? INTERFACE_COPY[iface] : undefined
  return copy ? `${obj.canonical.object_type} (${copy.label})` : obj.canonical.object_type
}

/** 뜻풀이를 한 줄 명사형으로. 「Slack 채널 — 들어온 사람이 내용을 보는」은 「들어온 사람이 내용을 보는 Slack 채널」 */
export function typePhrase(obj: FixtureObject): string {
  const [head, tail] = typeMeaning(obj).split(' — ')
  return tail ? `${tail} ${head}` : head
}

// ---------------------------------------------------------------------------
// 개별 항목 설명
// ---------------------------------------------------------------------------

export interface ObjectDescription {
  /** "Slack 채널 — 들어온 사람이 내용을 보는" */
  meaning: string
  /** 한 줄 명사형 뜻풀이. "들어온 사람이 내용을 보는 Slack 채널" */
  summary: string
  /** 관계에서 읽은 핵심 사실 몇 줄. 문장 대신 「구성원 14명」처럼 이름표와 값으로 둔다 */
  facts: ObjectFact[]
}

export interface ObjectFact {
  label: string
  value: string
}

const count = (n: number, unit: string) => `${n}${unit}`

export function describeObject(graph: Graph, key: string): ObjectDescription | null {
  const obj = graph.objectsByKey.get(key)
  if (!obj) return null
  const meaning = typeMeaning(obj)
  const out = graph.outgoingRelationsByObject.get(key) ?? []
  const inc = graph.incomingRelationsByObject.get(key) ?? []
  const nameOf = (k: string) => objName(graph, k)
  const listNames = (keys: string[], unit: string, max = 2) => {
    const uniq = [...new Set(keys)]
    const shown = uniq.slice(0, max).map(nameOf).join(', ')
    return uniq.length > max ? `${shown} 외 ${uniq.length - max}${unit}` : shown
  }
  const outOf = (type: string) => out.filter(r => r.relationType === type)
  const inOf = (type: string) => inc.filter(r => r.relationType === type)
  const facts: ObjectFact[] = []
  const fact = (label: string, value: string) => facts.push({ label, value })

  const parent = outOf('contained_in')[0]
  if (parent) fact('위치', nameOf(parent.targetKey))
  const memberships = outOf('member_of')
  if (memberships.length) fact('소속', listNames(memberships.map(r => r.targetKey), '곳'))
  const members = inOf('member_of')
  if (members.length) fact('멤버', count(members.length, '명'))
  for (const r of outOf('has_role_on').slice(0, 2)) {
    const role = r.roleName ?? (r.roleKey ? nameOf(r.roleKey) : undefined)
    fact('역할', role ? `${role} (${nameOf(r.targetKey)})` : nameOf(r.targetKey))
  }
  const holders = inOf('has_role_on')
  if (holders.length) fact('역할 보유자', listNames(holders.map(r => r.sourceKey), '개'))
  const owner = outOf('owned_by')[0]
  if (owner) fact('소유자', nameOf(owner.targetKey))
  const owns = inOf('owned_by')
  if (owns.length) fact('소유 리소스', listNames(owns.map(r => r.sourceKey), '개'))
  const installed = outOf('registered_in')[0]
  if (installed) fact('설치 위치', nameOf(installed.targetKey))
  const apps = inOf('registered_in')
  if (apps.length) fact('연동 앱', count(apps.length, '개'))
  for (const r of outOf('runs_as')) fact('실행 계정', nameOf(r.targetKey))
  for (const r of outOf('acts_as')) fact('대리 실행', nameOf(r.targetKey))
  for (const r of outOf('authenticates_with')) fact('인증 수단', nameOf(r.targetKey))
  for (const r of outOf('receives_into')) fact('전송 대상', nameOf(r.targetKey))
  for (const r of inOf('receives_into')) fact('데이터 출처', nameOf(r.sourceKey))
  for (const r of outOf('applies_to').slice(0, 2)) fact('적용 대상', nameOf(r.targetKey))
  const contained = inOf('contained_in')
  if (contained.length) fact('하위 항목', count(contained.length, '개'))

  const linkIds = graph.linkIdsByObject?.get(key) ?? []
  const otherSaas = new Set<string>()
  for (const id of linkIds) for (const m of graph.linksById?.get(id)?.set ?? []) {
    if (m.object_key !== key && m.provider !== obj.canonical.provider) otherSaas.add(providerLabel(m.provider))
  }
  if (otherSaas.size) fact('연결 계정', `${[...otherSaas].join(', ')} 계정`)

  // 이름은 패널 제목에, SaaS는 로고에 있으므로 뜻풀이만 명사형 한 줄로 둔다
  return {
    meaning,
    summary: typePhrase(obj),
    facts: facts.slice(0, 5),
  }
}

// ---------------------------------------------------------------------------
// 연결된 항목 (관계 탭)
// ---------------------------------------------------------------------------

/** 이 항목 입장에서 본 관계 이름. [나가는 쪽, 들어오는 쪽] */
const PERSPECTIVE: Record<string, { out: string; in: string; rank: number }> = {
  has_role_on: { out: '권한 대상', in: '권한 보유자', rank: 0 },
  permits: { out: '접근 허용 대상', in: '접근 허용 정책', rank: 1 },
  runs_as: { out: '실행 계정', in: '이 계정으로 실행되는 자동화', rank: 2 },
  acts_as: { out: '대리 실행', in: '대리 실행 앱', rank: 2 },
  authenticates_with: { out: '인증 수단', in: '이 수단을 쓰는 계정', rank: 3 },
  receives_into: { out: '전송 대상', in: '데이터 출처', rank: 3 },
  triggered_by: { out: '트리거', in: '트리거하는 자동화', rank: 3 },
  shared_with: { out: '공유 대상', in: '공유된 리소스', rank: 4 },
  member_of: { out: '소속 그룹, 채널', in: '멤버', rank: 5 },
  owned_by: { out: '소유자', in: '소유 리소스', rank: 6 },
  registered_in: { out: '설치 위치', in: '설치된 앱', rank: 7 },
  registered_by: { out: '등록자', in: '등록한 앱', rank: 7 },
  applies_to: { out: '적용 대상', in: '적용 정책', rank: 8 },
  excludes: { out: '제외 대상', in: '제외 정책', rank: 8 },
  evaluates: { out: '평가 대상 정책', in: '평가 정책', rank: 8 },
  trusts: { out: '신뢰 대상', in: '신뢰하는 조직', rank: 8 },
  contained_in: { out: '상위 항목', in: '하위 항목', rank: 9 },
}

export interface ConnectionItem {
  obj: ObjectRef
  /** 역할 이름 · 연결 판정 수준 등 짧은 보충 */
  note?: string
  crossSaas: boolean
  findingIds: string[]
}

export interface ConnectionGroup {
  id: string
  label: string
  relationType: string
  direction: 'out' | 'in' | 'link'
  items: ConnectionItem[]
  evidence: boolean
}

export function connectionsOf(graph: Graph, key: string, findings: FindingV2[] = []): ConnectionGroup[] {
  const self = graph.objectsByKey.get(key)
  const provider = self?.canonical.provider
  const groups = new Map<string, ConnectionGroup & { rank: number }>()
  const push = (id: string, label: string, relationType: string, direction: ConnectionGroup['direction'], rank: number, item: ConnectionItem) => {
    const g = groups.get(id) ?? { id, label, relationType, direction, items: [], evidence: false, rank }
    if (!g.items.some(i => i.obj.key === item.obj.key && i.note === item.note)) g.items.push(item)
    if (item.findingIds.length) g.evidence = true
    groups.set(id, g)
  }
  const relFindings = (k: string) => findings.filter(f => f.involvedRelationKeys.includes(k)).map(f => f.id)
  for (const [direction, rels] of [['out', graph.outgoingRelationsByObject.get(key) ?? []], ['in', graph.incomingRelationsByObject.get(key) ?? []]] as const) {
    for (const r of rels) {
      const otherKey = direction === 'out' ? r.targetKey : r.sourceKey
      const other = objectRef(graph, otherKey)
      const copy = PERSPECTIVE[r.relationType]
      const role = r.roleName ?? (r.roleKey ? objectRef(graph, r.roleKey).label : undefined)
      push(`${direction}:${r.relationType}`, copy ? copy[direction] : `${r.relationType} (${direction === 'out' ? '→' : '←'})`, r.relationType, direction, copy?.rank ?? 8, {
        obj: other,
        note: role ? `역할 ${role}` : undefined,
        crossSaas: !!provider && other.provider !== provider,
        findingIds: relFindings(r.relationKey),
      })
    }
  }
  // 이 객체가 관계의 근거(역할, 배정 행)인 경우: 그 관계의 시작, 끝을 보인다. 관계 종류마다 따로 묶는다
  // (권한 관계면 「권한 보유자」, 「권한 대상」, 포함 관계면 「하위 항목」, 「상위 항목」)
  for (const r of graph.relationsByKey?.values() ?? []) {
    const props = (r as { properties?: Record<string, unknown> }).properties
    const basis = r.roleKey === key || BASIS_PROPERTIES.some(name => {
      const v = props?.[name]
      return Array.isArray(v) ? v.includes(key) : v === key
    })
    if (!basis) continue
    const copy = PERSPECTIVE[r.relationType]
    const role = r.roleKey === key ? undefined : r.roleName ?? (r.roleKey ? objectRef(graph, r.roleKey).label : undefined)
    const findingIds = relFindings(r.relationKey)
    for (const [end, otherKey] of [['in', r.sourceKey], ['out', r.targetKey]] as const) {
      const other = objectRef(graph, otherKey)
      // 시작 쪽은 그 관계에서 들어오는 쪽 말(권한 보유자), 끝 쪽은 나가는 쪽 말(권한 대상)
      const side = copy ? copy[end] : end === 'in' ? '시작 항목' : '끝 항목'
      push(`basis:${r.relationType}:${end}`, `이 근거로 연결된 ${side}`, r.relationType, end, -0.5, {
        obj: other,
        note: role ? `역할 ${role}` : undefined,
        crossSaas: !!provider && other.provider !== provider,
        findingIds,
      })
    }
  }
  for (const id of graph.linkIdsByObject?.get(key) ?? []) {
    const link = graph.linksById?.get(id)
    if (!link) continue
    const kind = link.meta?.kind === 'group' ? '같은 그룹' : link.meta?.kind === 'automation' ? '같은 자동화' : '동일인 계정'
    const fIds = findings.filter(f => f.involvedLinkIds.includes(id)).map(f => f.id)
    for (const m of link.set) {
      if (m.object_key === key) continue
      push(`link:${kind}`, kind, 'identity_link', 'link', -1, {
        obj: objectRef(graph, m.object_key),
        note: linkLevelCopy(link.level).label,
        crossSaas: m.provider !== provider,
        findingIds: fIds,
      })
    }
  }
  return [...groups.values()]
    .sort((a, b) => Number(b.evidence) - Number(a.evidence) || a.rank - b.rank || b.items.length - a.items.length)
    .map(({ rank: _rank, ...g }) => g)
}

// ---------------------------------------------------------------------------
// 구성 (L1 ~ L3)
// ---------------------------------------------------------------------------

/** 이 묶음 밖으로 나가는 연결 수: 다른 SaaS 계정과의 동일인 연결, 묶음 밖 항목과의 관계 */
export function outsideLinks(graph: Graph, keys: readonly string[]): { identityLinks: number; outsideRelations: number; internalRelations: number } {
  const set = new Set(keys)
  const links = new Set<string>()
  for (const key of keys) for (const id of graph.linkIdsByObject?.get(key) ?? []) {
    const link = graph.linksById?.get(id)
    if (link?.set.some(m => !set.has(m.object_key))) links.add(id)
  }
  let outside = 0
  let internal = 0
  for (const rel of graph.relationsByKey.values()) {
    const a = set.has(rel.sourceKey)
    const b = set.has(rel.targetKey)
    if (a && b) internal += 1
    else if (a || b) outside += 1
  }
  return { identityLinks: links.size, outsideRelations: outside, internalRelations: internal }
}

// ---------------------------------------------------------------------------
// 보안 요약: Effective Access
// ---------------------------------------------------------------------------

export interface EaNote {
  rowId: string
  level: EffectiveAccessRow['level']
  levelLabel: string
  /** 닿는 방식 (그룹을 거친 권한 등) */
  ruleLabel: string
  /** 이 항목이 결론의 어디에 있나: 시작 주체, 닿는 대상, 거쳐 가는 칸 */
  where: 'source' | 'target' | 'via'
  chain: EaExplanation['chain']
  /** 닿는 대상(같은 대상끼리 묶는 데 쓴다) */
  targetKey: string
}

export interface SecuritySummary {
  ea: EaNote[]
}

export function securityFor(
  graph: Graph,
  keys: readonly string[],
  opts: { eaRows?: EffectiveAccessRow[] },
): SecuritySummary {
  const set = new Set(keys)
  const ea: EaNote[] = []
  for (const row of opts.eaRows ?? []) {
    if (row.level === 'denied') continue
    const { source, target } = row.references
    const onVia = row.via.some(v => v.kind === 'relation' ? set.has(v.source) || set.has(v.target) : set.has(v.a) || set.has(v.b))
    if (!set.has(source) && !set.has(target) && !onVia) continue
    const x = explainEaRow(graph, row)
    const where = set.has(source) ? 'source' : set.has(target) ? 'target' : 'via'
    ea.push({ rowId: row.id, level: row.level, levelLabel: x.levelLabel, ruleLabel: EA_RULE_LABEL[row.source.rule], where, chain: x.chain, targetKey: target })
  }
  return { ea }
}
