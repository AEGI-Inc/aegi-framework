import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { FindingV2 } from '../model/findingV2'
import type { IdentityLink } from '../model/link'
import type { SemanticEdge, SemanticNode } from './types'
import { getPrimaryIdentifierValue } from '../utils/identifier'
import { josa, objectName, shownKind } from '../utils/objectPhrase'

/**
 * Explains why two graph nodes are connected, for the edge inspector.
 * An edge at any semantic level is a bundle of canonical relations and/or identity links;
 * this turns each constituent into a readable sentence with its source evidence.
 */

type Graph = GraphStore | GraphStoreV2

export interface ObjectRef {
  key: string
  label: string
  type: string
  provider: string
}

export interface RelationExplanation {
  key: string
  type: string
  sentence: string
  source: ObjectRef
  target: ObjectRef
  role?: string
  basis?: string
  api?: string
  callId?: string
  collectedAt?: string
  findingIds: string[]
}

export interface RelationGroup {
  type: string
  label: string
  meaning: string
  items: RelationExplanation[]
}

export interface LinkExplanation {
  id: string
  level: IdentityLink['level']
  levelLabel: string
  levelMeaning: string
  basis: string
  person?: string
  /** 무엇이 같은가: 사람(기본) · 자동화 · 그룹(Okta Group Push 로 복제된 그룹, D-22) */
  kind: 'person' | 'automation' | 'group'
  /** 그룹일 때 방향: Okta → Slack 복제(Group Push) 또는 Slack → Okta 가져오기 */
  sync?: 'push' | 'import'
  members: Array<ObjectRef & { onEdge: boolean }>
  findingIds: string[]
}

export interface EdgeExplanation {
  title: string
  summary: string
  relationGroups: RelationGroup[]
  links: LinkExplanation[]
  evidenceCount: number
}

/** Relation Schema v3 — source --type--> target (docs/project.md §관계) */
const RELATION_COPY: Record<string, { label: string; meaning: string; sentence: (s: string, t: string, r?: string) => string }> = {
  has_role_on: { label: '역할 보유', meaning: '대상에 대한 권한을 주는 역할', sentence: (s, t, r) => `${josa(s, '이/가')} ${t}에서 ${r ? `${r} ` : ''}역할 보유` },
  permits: { label: '허용', meaning: '정책이나 토큰의 접근 허용', sentence: (s, t) => `${josa(s, '이/가')} ${t} 접근 허용` },
  member_of: { label: '멤버십', meaning: '소속 대상의 권한 상속', sentence: (s, t) => `${josa(s, '이/가')} ${t}의 구성원` },
  owned_by: { label: '소유', meaning: '만들고 관리하는 주체', sentence: (s, t) => `${s}의 소유자 ${t}` },
  registered_in: { label: '설치 위치', meaning: '앱이 설치된 조직', sentence: (s, t) => `${josa(s, '이/가')} ${t}에 설치됨` },
  registered_by: { label: '설치자', meaning: '앱 설치자', sentence: (s, t) => `${josa(t, '이/가')} ${josa(s, '을/를')} 설치함` },
  acts_as: { label: '대리 실행', meaning: '계정으로 대리 실행하는 앱', sentence: (s, t) => `${josa(s, '이/가')} ${t} 계정으로 대리 실행` },
  authenticates_with: { label: '로그인 수단', meaning: '로그인에 쓰는 수단', sentence: (s, t) => `${josa(s, '이/가')} ${josa(t, '으로/로')} 로그인함` },
  runs_as: { label: '실행 계정', meaning: '자동화를 실행하는 권한의 소유자', sentence: (s, t) => `${josa(s, '이/가')} ${t}의 권한으로 실행됨` },
  triggered_by: { label: '트리거', meaning: '자동화 실행 원인', sentence: (s, t) => `${josa(t, '이/가')} ${josa(s, '을/를')} 실행시킴` },
  receives_into: { label: '전달', meaning: '수신 내용 전달 대상', sentence: (s, t) => `${josa(s, '으로/로')} 보낸 내용이 ${t}에 게시됨` },
  shared_with: { label: '외부 공유', meaning: '다른 조직과의 공유', sentence: (s, t) => `${josa(s, '이/가')} ${josa(t, '과/와')} 공유됨` },
  applies_to: { label: '적용', meaning: '정책이 적용되는 대상', sentence: (s, t) => `${s} 정책이 ${t}에 적용됨` },
  excludes: { label: '제외', meaning: '정책에서 빠지는 대상', sentence: (s, t) => `${s} 정책이 ${josa(t, '을/를')} 제외함` },
  evaluates: { label: '평가', meaning: '다른 정책을 평가하는 정책', sentence: (s, t) => `${s} 정책이 ${josa(t, '을/를')} 평가함` },
  trusts: { label: '신뢰', meaning: '조직 사이의 신뢰 관계', sentence: (s, t) => `${josa(s, '이/가')} ${josa(t, '을/를')} 신뢰함` },
  contained_in: { label: '포함', meaning: '상위 항목', sentence: (s, t) => `${josa(s, '이/가')} ${t} 안에 있음` },
}

const LINK_LEVEL_COPY: Record<IdentityLink['level'], { label: string; meaning: string }> = {
  resolved: { label: '확인', meaning: 'SSO, SAML, 앱 배정 등 SaaS가 직접 알려 준 식별자로 같은 주체 확인' },
  candidate: { label: '후보', meaning: '이메일 일치처럼 약한 근거뿐, 같은 주체일 가능성은 높으나 미확정' },
  inferred: { label: '추정', meaning: '로그 등 간접 근거로 연결, 추가 확인 필요' },
  disclosed_relation: { label: 'SaaS 제공', meaning: 'Okta 앱 사용자의 외부 id 등 SaaS가 직접 알려 준 상대 계정 id' },
  possibly_same: { label: '가능성 있음', meaning: '이메일, 로그처럼 약한 근거로 연결' },
  possibly_related: { label: '약한 연관', meaning: '표시 이름 수준의 더 약한 근거' },
  different: { label: '다른 주체', meaning: '같은 주체가 아니라는 판정' },
}

export function objectRef(graph: Graph, key: string): ObjectRef {
  const obj = graph.objectsByKey.get(key)
  if (!obj) return { key, label: key, type: '', provider: '' }
  const label = 'linksById' in graph ? objectName(graph as GraphStoreV2, key) : obj.fixture_meta?.display_name ?? obj.canonical.properties?.name ?? obj.canonical.properties?.login ?? getPrimaryIdentifierValue(obj)
  return {
    key,
    label: String(label ?? key),
    type: shownKind(obj) || String(obj.catalog_ref?.provider_term ?? obj.canonical.object_type ?? ''),
    provider: obj.canonical.provider,
  }
}

function nodeName(node: SemanticNode | undefined, fallback: string): string {
  return node?.label || fallback
}

export function relationLabel(type: string): string {
  return RELATION_COPY[type]?.label ?? type
}

/** 동일인 연결 판정 수준의 이름과 뜻 */
export function linkLevelCopy(level: IdentityLink['level']): { label: string; meaning: string } {
  return LINK_LEVEL_COPY[level] ?? { label: level, meaning: '' }
}

export function explainEdge(
  graph: Graph,
  edge: SemanticEdge,
  endpoints: { source?: SemanticNode; target?: SemanticNode },
  findings: FindingV2[] = [],
): EdgeExplanation {
  if(edge.kind==='service_path')return {title:'경유 연결',summary:`${endpoints.source?.label??edge.sourceSemanticNodeId} → ${endpoints.target?.label??edge.targetSemanticNodeId}, 중계 실행기 경유`,relationGroups:[],links:[],evidenceCount:0}
  const relationFindings = (key: string) => findings.filter(f => f.involvedRelationKeys.includes(key)).map(f => f.id)
  const linkFindings = (id: string) => findings.filter(f => f.involvedLinkIds.includes(id)).map(f => f.id)

  const groups = new Map<string, RelationGroup>()
  for (const key of edge.relationKeys) {
    const rel = graph.relationsByKey.get(key)
    if (!rel) continue
    const source = objectRef(graph, rel.sourceKey)
    const target = objectRef(graph, rel.targetKey)
    const role = rel.roleName ?? (rel.roleKey ? objectRef(graph, rel.roleKey).label : undefined)
    const copy = RELATION_COPY[rel.relationType]
    const params = (rel.source?.params ?? {}) as Record<string, unknown>
    const item: RelationExplanation = {
      key,
      type: rel.relationType,
      sentence: copy ? copy.sentence(source.label, target.label, role) : `${source.label} --${rel.relationType}--> ${target.label}`,
      source,
      target,
      role,
      basis: rel.properties?.basis,
      api: rel.source?.api,
      callId: typeof params.call_id === 'string' ? params.call_id : undefined,
      collectedAt: rel.source?.collected_at,
      findingIds: relationFindings(key),
    }
    const group = groups.get(rel.relationType) ?? { type: rel.relationType, label: copy?.label ?? rel.relationType, meaning: copy?.meaning ?? '', items: [] }
    group.items.push(item)
    groups.set(rel.relationType, group)
  }
  const relationGroups = [...groups.values()]
    .map(group => ({ ...group, items: group.items.sort((a, b) => b.findingIds.length - a.findingIds.length || a.sentence.localeCompare(b.sentence)) }))
    .sort((a, b) => Number(b.items.some(i => i.findingIds.length)) - Number(a.items.some(i => i.findingIds.length)) || b.items.length - a.items.length)

  const onEdge = new Set([...(endpoints.source?.memberObjectKeys ?? [edge.sourceSemanticNodeId]), ...(endpoints.target?.memberObjectKeys ?? [edge.targetSemanticNodeId])])
  const links: LinkExplanation[] = []
  for (const id of edge.resolutionIds) {
    const link = (graph as GraphStoreV2).linksById?.get(id)
    if (!link) continue
    const level = (edge.identityLevel ?? link.level) as IdentityLink['level']
    const copy = LINK_LEVEL_COPY[level] ?? { label: level, meaning: '' }
    links.push({
      id,
      level,
      levelLabel: copy.label,
      levelMeaning: copy.meaning,
      basis: link.source?.basis ?? '',
      person: link.meta?.display_name ?? link.meta?.person_name,
      kind: link.meta?.kind === 'group' ? 'group' : link.meta?.kind === 'automation' ? 'automation' : 'person',
      sync: link.meta?.sync === 'import' ? 'import' : link.meta?.sync === 'push' ? 'push' : undefined,
      members: link.set.map(m => ({ ...objectRef(graph, m.object_key), onEdge: onEdge.has(m.object_key) })),
      findingIds: linkFindings(id),
    })
  }

  const s = nodeName(endpoints.source, edge.sourceSemanticNodeId)
  const t = nodeName(endpoints.target, edge.targetSemanticNodeId)
  const relationCount = relationGroups.reduce((n, g) => n + g.items.length, 0)
  const breakdown = relationGroups.map(g => `${g.label} ${g.items.length}`).join(', ')
  const single = relationCount === 1 && !links.length ? relationGroups[0].items[0] : null

  let title = '관계'
  let summary: string
  if (edge.kind === 'policy_assignment') {
    title = '역할 부여'
    summary = single
      ? single.sentence
      : `${josa(s, '과/와')} ${t} 사이 역할 관계 ${relationCount}개`
  } else if (relationCount && links.length) {
    title = '관계와 동일인 연결'
    summary = `관계 ${relationCount}개(${breakdown}), 동일인 연결 ${links.length}개`
  } else if (links.length && edge.identityLevel === 'different') {
    title = '다른 사람'
    summary = '서로 다른 사람'
  } else if (links.length && edge.identityLevel === 'possibly_related') {
    title = '약한 연관'
    summary = '동일인 여부 미확인'
  } else if (links.length && edge.identityLevel && !['resolved', 'disclosed_relation'].includes(edge.identityLevel)) {
    title = '동일인 연결 추정'
    summary = '동일인이라는 연결은 추정'
  } else if (links.length === 1 && links[0].kind === 'group' && links[0].sync === 'import') {
    title = '같은 그룹, Slack → Okta 가져오기'
    summary = `Okta가 Slack 그룹을 가져와 만든 같은 그룹${links[0].person ? `: ${links[0].person}` : ''}`
  } else if (links.length === 1 && links[0].kind === 'group') {
    title = '같은 그룹, Okta → Slack Group Push'
    summary = `Group Push로 Okta 그룹을 Slack에 복제한 같은 그룹${links[0].person ? `: ${links[0].person}` : ''}, Okta 구성원 변경이 Slack 그룹에 그대로 반영`
  } else if (links.length) {
    title = '동일인 연결'
    summary = links.length === 1 && links[0].person
      ? `${links[0].person}의 동일인 계정`
      : `동일인 연결 ${links.length}개`
  } else if (single) {
    summary = single.sentence
  } else {
    summary = `관계 ${relationCount}개: ${breakdown}`
  }

  const evidenceCount = relationGroups.reduce((n, g) => n + g.items.filter(i => i.findingIds.length).length, 0) + links.filter(l => l.findingIds.length).length
  return { title, summary, relationGroups, links, evidenceCount }
}
