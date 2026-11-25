import type { Provider } from '../model/object'
import type { SemanticLevel } from './types'
import type { RelationLens, RelationLensGroup } from './relationLens'
import type { InvestigationPath } from './investigationQuery'
import { activeDataset } from '../data/datasetBootstrap'

export interface GraphSession {
  level: SemanticLevel
  focus: string
  target: string
  expanded: string[]
  queryObjects: string[]
  queryRelations: string[]
  queryLinks: string[]
  queryExecuted: boolean
  queryPath?: InvestigationPath | null
  findingIds: string[]
  /** 옛 저장값 (한 개만 고르던 때). 읽기만 한다 */
  lens?: RelationLens
  /** 체크한 관계선 묶음 */
  lenses: RelationLensGroup[]
  /** Effective Access 선 겹쳐 보기 */
  showEffectiveAccess: boolean
  includeLinks: boolean
  provider: 'all' | Provider
  providers?: Array<Provider>
  pathHops: number
  pathDirected: boolean
  showAll: boolean
  selectedNode: string | null
  selectedObject?: string | null
  selectedEdge: string | null
  camera?: { zoom: number; pan: { x: number; y: number } }
}

// Scoped per dataset: synthetic and measured object ids differ, so one must not restore the other's focus.
const storageKey = () => `aegi:graph-investigation:v1:${activeDataset}`
let current: Partial<GraphSession> | null = null

/** Retain investigation scope when navigating Graph -> Threat -> Graph. */
export function readGraphSession(): Partial<GraphSession> {
  if (current) return current
  try {
    const saved = sessionStorage.getItem(storageKey())
    if (saved) {
      const value: unknown = JSON.parse(saved)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        current = value as Partial<GraphSession>
        return current
      }
    }
  } catch {
    // Session storage can be disabled; in-memory navigation still works.
  }
  return {}
}

export function writeGraphSession(value: GraphSession): void {
  current = value
  try { sessionStorage.setItem(storageKey(), JSON.stringify(value)) } catch {}
}
