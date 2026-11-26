import type { SemanticEdge } from './types'

/**
 * Relation lenses are presentation filters, not new canonical relation types.
 * Structure/Authority/Trust follow the Relation Schema v3 view groups.
 * Flow is a separate investigation preset and does not redefine Trust.
 */
export type RelationLens = 'all' | 'structure' | 'authority' | 'trust' | 'flow'

/* 이름은 묶음 안에 든 것과 맞춘다. 「구조」에는 contained_in 하나뿐이고, 소속(member_of)은 스키마대로 「권한」에 있다.
   전에는 「소속, 구조」라 적어 멤버십이 거기 있는 줄 알았다. */
export const RELATION_LENS_LABELS: Record<RelationLens, string> = {
  all: '전체',
  structure: '구조',
  authority: '권한',
  trust: '신뢰, 인증',
  flow: '실행, 전달',
}

const GROUPS: Record<Exclude<RelationLens, 'all' | 'flow'>, ReadonlySet<string>> = {
  structure: new Set(['contained_in']),
  authority: new Set(['has_role_on', 'permits', 'member_of', 'owned_by', 'applies_to', 'excludes', 'evaluates']),
  trust: new Set(['authenticates_with', 'runs_as', 'triggered_by', 'acts_as', 'trusts', 'registered_in', 'registered_by', 'receives_into', 'shared_with']),
}

// Investigation preset only: an edge matching this set is not proof that an
// execution or data-transfer event actually happened.
const FLOW_PRESET = new Set(['triggered_by', 'runs_as', 'acts_as', 'receives_into', 'shared_with', 'service_path'])

/** 관계선 메뉴에서 고를 수 있는 값. 세 보기 묶음(structure · authority · trust) 가운데 몇 개, 또는 조사 프리셋 flow 하나 */
export type RelationLensGroup = Exclude<RelationLens, 'all'>

/** Relation Schema v3 의 보기 묶음. 서로 겹치지 않고, 셋을 다 고르면 「전체」다 */
export type RelationViewGroup = Exclude<RelationLensGroup, 'flow'>
export const RELATION_VIEW_GROUPS: RelationViewGroup[] = ['structure', 'authority', 'trust']

export const RELATION_LENS_HINTS: Record<RelationLensGroup, string> = {
  structure: '무엇 안에 있는지 나타내는 포함 관계',
  authority: '역할, 멤버십, 소유, 정책 관계',
  trust: '인증, 등록, 위임, 신뢰 관계',
  flow: '실행과 데이터 전달 관계',
}

/** 관계 종류가 든 보기 묶음. 스키마에 없는 종류는 null */
export function relationViewGroup(type: string): RelationViewGroup | null {
  for (const group of RELATION_VIEW_GROUPS) if (GROUPS[group].has(type)) return group
  return null
}

export function isFlowRelation(type: string): boolean {
  return FLOW_PRESET.has(type)
}

/** 세 보기 묶음을 다 골랐는가 (「전체」) */
export function allRelationViewsSelected(lenses: ReadonlySet<RelationLensGroup>): boolean {
  return !lenses.has('flow') && RELATION_VIEW_GROUPS.every(group => lenses.has(group))
}

/**
 * 저장된 값을 메뉴가 쓰는 모양으로 맞춘다: 보기 묶음 몇 개, 또는 {flow} 하나.
 * 전에는 flow 도 나란히 체크하는 넷째 묶음이었다(신뢰, 인증과 겹친다). 넷을 다 고른 옛 값은 「전체」가 되고,
 * 보기 묶음과 flow 를 같이 고른 옛 값은 보기 묶음만 남긴다.
 */
export function normalizeRelationLenses(saved: readonly unknown[]): Set<RelationLensGroup> {
  const groups = RELATION_VIEW_GROUPS.filter(group => saved.includes(group))
  if (groups.length) return new Set(groups)
  return saved.includes('flow') ? new Set<RelationLensGroup>(['flow']) : new Set()
}

/** 고른 묶음 중 하나라도 맞으면 참. 「전체」면 스키마에 없는 종류도 참 */
export function relationMatchesAnyLens(type: string, lenses: ReadonlySet<RelationLensGroup>): boolean {
  if (allRelationViewsSelected(lenses)) return true
  for (const lens of lenses) if (relationMatchesLens(type, lens)) return true
  return false
}

/** 도구 막대 단추에 적을 요약: 전체 · 없음 · 「권한 + 신뢰, 인증」 · 「실행, 전달만」.
    이름 안에 쉼표가 있어 묶음 사이는 + 로 가른다(전에는 「권한, 신뢰, 인증」이 둘인지 셋인지 몰랐다) */
export function relationLensSummary(lenses: ReadonlySet<RelationLensGroup>): string {
  if (lenses.has('flow')) return `${RELATION_LENS_LABELS.flow}만`
  const names = RELATION_VIEW_GROUPS.filter(lens => lenses.has(lens)).map(lens => RELATION_LENS_LABELS[lens])
  if (names.length === RELATION_VIEW_GROUPS.length) return RELATION_LENS_LABELS.all
  if (names.length === 0) return '없음'
  return names.join(' + ')
}

export function relationMatchesLens(type: string, lens: RelationLens): boolean {
  if (lens === 'all') return true
  if (lens === 'flow') return FLOW_PRESET.has(type)
  return GROUPS[lens].has(type)
}

export function filterEdgesByLens(edges: SemanticEdge[], lens: RelationLens, includeIdentityLinks = true, relationTypeByKey?: ReadonlyMap<string, string>): SemanticEdge[] {
  if (lens === 'all' && includeIdentityLinks) return edges
  return edges.reduce<SemanticEdge[]>((result, edge) => {
      if(edge.kind==='service_path'){
        if(lens==='all'||lens==='flow')result.push(edge)
        return result
      }
    const relationKeys = edge.relationKeys.filter(key => relationMatchesLens(relationTypeByKey?.get(key) ?? edge.relationTypes[0] ?? '', lens))
    const relationTypes = edge.relationTypes.filter(type => relationMatchesLens(type, lens))
    // A policy-assignment edge is a visual projection of has_role_on, not a
    // new canonical relation. Keep it only with the Authority lens or All.
    if (edge.kind === 'policy_assignment' && (lens === 'all' || lens === 'authority')) {
      result.push(edge)
      return result
    }
    const keepRelations = relationKeys.length > 0
    const keepLinks = includeIdentityLinks && edge.resolutionIds.length > 0
    if (!keepRelations && !keepLinks) return result
    result.push({
      ...edge,
      relationTypes,
      relationKeys: keepRelations ? relationKeys : [],
      resolutionIds: keepLinks ? edge.resolutionIds : [],
      relationCount: relationKeys.length,
      resolutionCount: keepLinks ? edge.resolutionCount : 0,
      kind: keepRelations && keepLinks ? 'mixed_bundle' : keepLinks ? 'resolution_bundle' : edge.kind,
    })
    return result
  }, [])
}
