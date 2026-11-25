import type { FixtureObject } from './object'
import type { ResolvedRelation } from './relation'
import type { IdentityLink } from './link'

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

  unresolvedRelationCount: number
}
