import type { GraphStoreV2 } from '../../model/graph'
import type { FixtureObject } from '../../model/object'

const GROUP_TYPES = new Set(['group', 'usergroup', 'team'])

function objectOf(key: string, graph: GraphStoreV2): FixtureObject | undefined {
  return graph.objectsByKey.get(key)
}

/** 그룹처럼 멤버를 가지는 주체인가 (principal_kind group, 그룹 타입, 또는 들어오는 member_of 가 있는 Principal) */
export function isGroupPrincipal(key: string, graph: GraphStoreV2): boolean {
  const obj = objectOf(key, graph)
  if (!obj || !obj.canonical.interfaces.includes('Principal')) return false
  if (obj.canonical.judged?.principal_kind === 'group') return true
  if (GROUP_TYPES.has(obj.canonical.object_type.toLowerCase())) return true
  return (graph.incomingRelationsByObject.get(key) ?? []).some(rel => rel.relationType === 'member_of')
}
