import type { FixtureObject } from './object'
import type { ResolvedRelation } from './relation'
import type { FixtureResolution } from './resolution'
import type { IdentityLink } from './link'

export interface GraphStore {
  // Object indexes
  objectsByKey: Map<string, FixtureObject>
  objectsByProvider: Map<string, FixtureObject[]>
  objectsByInterface: Map<string, FixtureObject[]>

  // Relation indexes
  relationsByKey: Map<string, ResolvedRelation>
  relationsByType: Map<string, ResolvedRelation[]>
  outgoingRelationsByObject: Map<string, ResolvedRelation[]>
  incomingRelationsByObject: Map<string, ResolvedRelation[]>

  // Resolution indexes (legacy v1/v2 compatibility)
  resolutionsById: Map<string, FixtureResolution>
  resolutionsByMemberObject: Map<string, FixtureResolution[]>

  // Identity Links (v2)
  linksById?: Map<string, IdentityLink>
  linkIdsByObject?: Map<string, string[]>

  // Unresolved references tracking (should be 0)
  unresolvedRelationCount: number
}

export interface GraphStoreV2 {
  objectsByKey: Map<string, FixtureObject>
  objectsByProvider: Map<string, FixtureObject[]>
  objectsByInterface: Map<string, FixtureObject[]>

  relationsByKey: Map<string, ResolvedRelation>
  relationsByType: Map<string, ResolvedRelation[]>
  outgoingRelationsByObject: Map<string, ResolvedRelation[]>
  incomingRelationsByObject: Map<string, ResolvedRelation[]>

  linksById: Map<string, IdentityLink>
  linkIdsByObject: Map<string, string[]>

  // Legacy compatibility maps (always initialized empty Maps for safety)
  resolutionsById: Map<string, FixtureResolution>
  resolutionsByMemberObject: Map<string, FixtureResolution[]>

  unresolvedRelationCount: number
}
