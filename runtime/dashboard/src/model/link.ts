import type { Provider } from './object'
import type { LinkLevel } from '../ontology/generated'

export interface IdentityLinkMember {
  provider: Provider
  object_key: string
}

export interface IdentityLinkSource {
  method: 'manual_fixture' | 'deterministic_rule' | 'computed'
  view_version: number
  basis: string
}

export interface IdentityLink {
  link_id: string
  set: IdentityLinkMember[]
  /**
   * v1: resolved · candidate · inferred.
   * v2(aegi-schema Link_Schema_v3): disclosed_relation · resolved · possibly_same · possibly_related · different —
   * 집합의 level 은 가장 약한 간선의 것이고, 간선마다의 level 은 meta.edges 에 있다.
   * 목록은 개념 사전(identity.yaml 의 engine_level_grades)에서 온다
   */
  level: LinkLevel
  source: IdentityLinkSource
  meta?: {
    person_name?: string
    display_name?: string
    notes?: string
    [key: string]: unknown
  }
}
