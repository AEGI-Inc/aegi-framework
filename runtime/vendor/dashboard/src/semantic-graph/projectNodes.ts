import type { InterfaceType, Provider } from '../model/object'
import type { GraphStore } from '../model/graph'
import type { SemanticLevel, SemanticNode, SemanticHierarchy } from './types'
import { ecosystemAnchor, orderedProviders, PROVIDER_GRID, tenantAnchorKey, type Point } from './layoutAnchors'
import { providerName, serviceDisplay } from '../findings/providers'
import { SERVICE_TENANT_MARK } from './hierarchy'
import { objectDisplayName } from './objectChip'


/**
 * Projects GraphStore objects into SemanticNodes for the specified level.
 */
export function projectNodes(
  graph: GraphStore,
  hierarchyMap: Map<string, SemanticHierarchy>,
  level: SemanticLevel,
  anchors: Map<string, Point>
): SemanticNode[] {
  const nodes: SemanticNode[] = []

  if (level === 'ecosystem') {
    // 기본 네 SaaS는 늘 자리를 두고, 데이터에 들어온 다른 SaaS(Atlassian 등)는 모두 더한다
    const present = new Set<string>([...PROVIDER_GRID.flat(), ...[...graph.objectsByKey.values()].map(obj => obj.canonical.provider)])
    const providers = orderedProviders(present)

    for (const provider of providers) {
      const memberKeys: string[] = []
      const ifacesSet = new Set<InterfaceType>()

      for (const obj of graph.objectsByKey.values()) {
        const h = hierarchyMap.get(obj.fixture_key)
        if (h?.ecosystemNodeId === provider) {
          memberKeys.push(obj.fixture_key)
          obj.canonical.interfaces.forEach(i => ifacesSet.add(i))
        }
      }

      // Count internal relations
      let relationCount = 0
      for (const rel of graph.relationsByKey.values()) {
        const srcH = hierarchyMap.get(rel.sourceKey)
        const tgtH = hierarchyMap.get(rel.targetKey)
        if (srcH?.ecosystemNodeId === provider && tgtH?.ecosystemNodeId === provider) {
          relationCount++
        }
      }

      const anchor = ecosystemAnchor(provider, present)

      nodes.push({
        id: provider,
        level: 'ecosystem',
        label: providerName(provider),
        provider,
        interfaces: Array.from(ifacesSet),
        memberObjectKeys: memberKeys,
        objectCount: memberKeys.length,
        relationCount,
        findingIds: [],
        findingCount: 0,
        x: anchor.x,
        y: anchor.y,
      })
    }
    return nodes
  }

  if (level === 'tenant') {
    // Tenant Nodes
    const tenantGroups = new Map<string, { provider: Provider; keys: string[]; ifaces: Set<InterfaceType> }>()

    for (const obj of graph.objectsByKey.values()) {
      const h = hierarchyMap.get(obj.fixture_key)
      if (!h) continue
      let group = tenantGroups.get(h.tenantNodeId)
      if (!group) {
        group = { provider: h.provider, keys: [], ifaces: new Set() }
        tenantGroups.set(h.tenantNodeId, group)
      }
      group.keys.push(obj.fixture_key)
      obj.canonical.interfaces.forEach(i => group!.ifaces.add(i))
    }

    for (const [tenantId, group] of tenantGroups.entries()) {
      const anchor = anchors.get(tenantAnchorKey(tenantId)) || { x: 1200, y: 900 }
      const tenantObj = graph.objectsByKey.get(tenantId)
      const mark = tenantId.indexOf(SERVICE_TENANT_MARK)
      const service = mark < 0 ? undefined : tenantId.slice(mark + SERVICE_TENANT_MARK.length)
      const display = service ? serviceDisplay(group.provider, service, group.keys.map(key => graph.objectsByKey.get(key)!.canonical)) : undefined
      const label = display?.name ||
        tenantObj?.fixture_meta?.display_name ||
        tenantObj?.canonical.properties?.name ||
        tenantId

      // Internal relations
      let relationCount = 0
      for (const rel of graph.relationsByKey.values()) {
        const srcH = hierarchyMap.get(rel.sourceKey)
        const tgtH = hierarchyMap.get(rel.targetKey)
        if (srcH?.tenantNodeId === tenantId && tgtH?.tenantNodeId === tenantId) {
          relationCount++
        }
      }

      nodes.push({
        id: tenantId,
        level: 'tenant',
        label: String(label),
        provider: group.provider,
        tenantKey: tenantId,
        service,
        logoId: display?.logo,
        parentSemanticNodeId: group.provider,
        interfaces: Array.from(group.ifaces),
        memberObjectKeys: group.keys,
        objectCount: group.keys.length,
        relationCount,
        findingIds: [],
        findingCount: 0,
        x: anchor.x,
        y: anchor.y,
        rawObject: tenantObj,
      })
    }
    return nodes
  }

  if (level === 'scope') {
    // Provider-native Security Scope clusters.
    // A scope can be anchored by a real Group/Team/Repository/Channel/etc.
    // object or be a synthetic fallback bucket such as Identity.
    const scopeGroups = new Map<string, {
      provider: Provider
      tenantKey: string
      scopeKind: NonNullable<SemanticHierarchy['scopeKind']>
      scopeLabel: string
      scopeAnchorObjectKey?: string
      keys: string[]
      ifaces: Set<InterfaceType>
    }>()

    for (const obj of graph.objectsByKey.values()) {
      const h = hierarchyMap.get(obj.fixture_key)
      if (!h) continue
      let group = scopeGroups.get(h.scopeNodeId)
      if (!group) {
        group = {
          provider: h.provider,
          tenantKey: h.tenantKey,
          scopeKind: h.scopeKind,
          scopeLabel: h.scopeLabel,
          scopeAnchorObjectKey: h.scopeAnchorObjectKey,
          keys: [],
          ifaces: new Set(),
        }
        scopeGroups.set(h.scopeNodeId, group)
      }
      group.keys.push(obj.fixture_key)
      obj.canonical.interfaces.forEach(i => group!.ifaces.add(i))
    }

    for (const [scopeId, group] of scopeGroups.entries()) {
      const anchor = anchors.get(scopeId) || { x: 1200, y: 900 }

      let relationCount = 0
      for (const rel of graph.relationsByKey.values()) {
        const srcH = hierarchyMap.get(rel.sourceKey)
        const tgtH = hierarchyMap.get(rel.targetKey)
        if (srcH?.scopeNodeId === scopeId && tgtH?.scopeNodeId === scopeId) {
          relationCount++
        }
      }

      nodes.push({
        id: scopeId,
        level: 'scope',
        label: group.scopeLabel,
        provider: group.provider,
        tenantKey: group.tenantKey,
        objectType: group.scopeKind,
        scopeKind: group.scopeKind,
        scopeAnchorObjectKey: group.scopeAnchorObjectKey,
        parentSemanticNodeId: group.tenantKey,
        interfaces: Array.from(group.ifaces),
        memberObjectKeys: group.keys,
        objectCount: group.keys.length,
        relationCount,
        findingIds: [],
        findingCount: 0,
        x: anchor.x,
        y: anchor.y,
      })
    }
    return nodes
  }

  // Level === 'object' (L4)
  for (const obj of graph.objectsByKey.values()) {
    const h = hierarchyMap.get(obj.fixture_key)
    const anchor = anchors.get(obj.fixture_key) || { x: 1200, y: 900 }
    const displayName = objectDisplayName(obj)

    const outgoing = graph.outgoingRelationsByObject.get(obj.fixture_key) || []

    nodes.push({
      id: obj.fixture_key,
      level: 'object',
      label: String(displayName),
      provider: obj.canonical.provider.toLowerCase() as Provider,
      tenantKey: h?.tenantKey,
      objectType: obj.canonical.object_type,
      parentSemanticNodeId: h?.scopeNodeId,
      interfaces: obj.canonical.interfaces,
      memberObjectKeys: [obj.fixture_key],
      objectCount: 1,
      relationCount: outgoing.length,
      findingIds: [],
      findingCount: 0,
      x: anchor.x,
      y: anchor.y,
      rawObject: obj,
    })
  }

  return nodes
}
