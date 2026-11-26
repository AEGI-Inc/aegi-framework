import type { InterfaceType, FixtureObject, Provider } from '../model/object'
import type { FindingV2 } from '../model/findingV2'
import type {ServicePath} from './servicePaths'
import type { ProviderId } from '../providerOverviewData'

export type SemanticLevel = 'ecosystem' | 'tenant' | 'scope' | 'object'

export const SEMANTIC_LEVEL_ORDER: readonly SemanticLevel[] = [
  'ecosystem',
  'tenant',
  'scope',
  'object',
] as const

/* name에는 레벨 번호를 넣지 않는다. 컨트롤이 이미 `L{step} · {name}`으로
   보여주고 있어 "L1 · SaaS 전체 (L1)"처럼 두 번 나왔다. */
export const SEMANTIC_LEVEL_LABELS: Record<SemanticLevel, { name: string; step: number }> = {
  ecosystem: { name: 'SaaS 요약', step: 1 },
  tenant: { name: '조직, 워크스페이스', step: 2 },
  scope: { name: '그룹, 리소스', step: 3 },
  object: { name: '개별 객체', step: 4 },
}

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info'

export type SecurityScopeKind =
  | 'Group'
  | 'Identity'
  | 'Tenant Policy'
  | 'Team'
  | 'Repository'
  | 'Access Role'
  | 'Integration'
  | 'File / Resource'
  | 'Workspace'
  | 'Channel'
  | 'User Group'
  | 'Automation / Endpoint'
  | 'Tenant / Administration'

export interface SemanticNode {
  id: string
  level: SemanticLevel
  label: string
  provider: Provider
  tenantKey?: string
  /** 조직 단계에서 service 로 따로 묶은 원이면 그 service (canonical.service) */
  service?: string
  /** service 원이 SaaS 로고 대신 쓰는 제품 로고 */
  logoId?: ProviderId
  objectType?: string
  scopeKind?: SecurityScopeKind
  scopeAnchorObjectKey?: string
  interfaces: InterfaceType[]
  memberObjectKeys: string[]
  parentSemanticNodeId?: string

  objectCount: number
  relationCount: number

  findingIds: string[]
  findingCount: number
  selectedFindingIds?: string[]
  selectedFindingCount?: number
  highestSeverity?: Severity

  x: number
  y: number
  /** 원 단계에서 자리를 잡으며 정한 반지름(조직 단계). 없으면 circleRadius 가 객체 수로 정한다 */
  radius?: number
  rawObject?: FixtureObject
}

export type EdgeBundleKind = 'canonical_bundle' | 'resolution_bundle' | 'mixed_bundle' | 'policy_assignment' | 'service_path'

/**
 * 수집된 관계 밖에서 넘겨받아 그리는 객체 사이 선(예: Explorer 가 엔진 간선으로 찾은 연결). relationTypes 는 선 이름으로 보인다.
 * 객체 단계에서만 그리고, 같은 두 객체 사이에 수집된 관계가 이미 있으면 그리지 않는다
 */
export interface ExtraLinkEdge { from: string; to: string; relationTypes: string[] }

export interface SemanticEdge {
  servicePaths?:ServicePath[]
  /** Evidence view uses the selected Link_Schema_v3 pair's level, rather than the weakest level of the entire set. */
  identityLevel?: string
  id: string
  sourceSemanticNodeId: string
  targetSemanticNodeId: string

  relationTypes: string[]
  relationKeys: string[]
  resolutionIds: string[]

  relationCount: number
  resolutionCount: number

  findingIds: string[]
  findingCount: number
  selectedFindingIds?: string[]
  selectedFindingCount?: number
  highestSeverity?: Severity

  kind: EdgeBundleKind
}

export interface SemanticHierarchy {
  objectKey: string
  ecosystemNodeId: string
  tenantNodeId: string
  scopeNodeId: string
  objectNodeId: string
  provider: Provider
  tenantKey: string
  objectType: string
  scopeKind: SecurityScopeKind
  scopeLabel: string
  scopeAnchorObjectKey?: string
}

export interface ProjectedGraphData {
  level: SemanticLevel
  nodes: SemanticNode[]
  edges: SemanticEdge[]
  hierarchyByObject: Map<string, SemanticHierarchy>
  globalFindings: Array<{
    findingId: string
    ruleId: string
    ruleName: string
    severity: Severity
    score: number
    title: string
    evidenceKeys: string[]
  }>
  v2Findings?: FindingV2[]
}
