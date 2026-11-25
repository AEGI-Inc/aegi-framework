import type { FixtureObject } from '../model/object'
import type { FixtureRelation, ResolvedRelation } from '../model/relation'
import { isNameKeyRole } from '../model/relation'
import type { IdentityLink } from '../model/link'
import type { EvidenceObservation, FindingEvidenceLink, EvidenceStore } from '../model/evidence'
import type { GraphStoreV2 } from '../model/graph'

export function buildGraphStoreV2(
  objects: FixtureObject[],
  relations: FixtureRelation[],
  links: IdentityLink[]
): GraphStoreV2 {
  const objectsByKey = new Map<string, FixtureObject>()
  const objectsByProvider = new Map<string, FixtureObject[]>()
  const objectsByInterface = new Map<string, FixtureObject[]>()

  for (const obj of objects) {
    objectsByKey.set(obj.fixture_key, obj)

    const p = obj.canonical.provider
    if (!objectsByProvider.has(p)) objectsByProvider.set(p, [])
    objectsByProvider.get(p)!.push(obj)

    for (const iface of obj.canonical.interfaces || []) {
      if (!objectsByInterface.has(iface)) objectsByInterface.set(iface, [])
      objectsByInterface.get(iface)!.push(obj)
    }
  }

  const relationsByKey = new Map<string, ResolvedRelation>()
  const relationsByType = new Map<string, ResolvedRelation[]>()
  const outgoingRelationsByObject = new Map<string, ResolvedRelation[]>()
  const incomingRelationsByObject = new Map<string, ResolvedRelation[]>()

  let unresolvedRelationCount = 0

  for (const rel of relations) {
    const srcKey = String(rel.canonical.references.source.value)
    const tgtKey = String(rel.canonical.references.target.value)
    const roleRef = rel.canonical.references.role
    // 기본 제공 역할은 이름만 있고 객체가 없다. 객체로 풀지 않는다.
    const roleKey = roleRef && !isNameKeyRole(roleRef) ? String(roleRef.value) : undefined
    const roleObject = roleKey ? objectsByKey.get(roleKey) : undefined
    // A reviewed named-role Policy retains the exact source role name. Existing
    // access readers can use it while the ternary relation keeps its Policy key.
    const roleName = isNameKeyRole(roleRef) ? String(roleRef.value)
      : roleObject?.canonical.properties.definition_kind === 'vendor_named_role' && typeof roleObject.canonical.properties.role_name === 'string'
        ? roleObject.canonical.properties.role_name : undefined

    if (!objectsByKey.has(srcKey) || !objectsByKey.has(tgtKey) || (roleKey && !objectsByKey.has(roleKey))) {
      unresolvedRelationCount++
    }

    const resolved: ResolvedRelation = {
      relationKey: rel.fixture_key,
      relationType: rel.canonical.relation_type,
      provider: rel.canonical.provider,
      template: rel.canonical.template,
      sourceKey: srcKey,
      targetKey: tgtKey,
      roleKey,
      roleName,
      properties: rel.canonical.properties,
      source: rel.canonical.source,
      raw: rel,
    }

    relationsByKey.set(resolved.relationKey, resolved)

    if (!relationsByType.has(resolved.relationType)) relationsByType.set(resolved.relationType, [])
    relationsByType.get(resolved.relationType)!.push(resolved)

    if (!outgoingRelationsByObject.has(srcKey)) outgoingRelationsByObject.set(srcKey, [])
    outgoingRelationsByObject.get(srcKey)!.push(resolved)

    if (!incomingRelationsByObject.has(tgtKey)) incomingRelationsByObject.set(tgtKey, [])
    incomingRelationsByObject.get(tgtKey)!.push(resolved)
  }

  const linksById = new Map<string, IdentityLink>()
  const linkIdsByObject = new Map<string, string[]>()

  for (const link of links) {
    linksById.set(link.link_id, link)
    for (const member of link.set) {
      if (!linkIdsByObject.has(member.object_key)) {
        linkIdsByObject.set(member.object_key, [])
      }
      linkIdsByObject.get(member.object_key)!.push(link.link_id)
    }
  }

  return {
    objectsByKey,
    objectsByProvider,
    objectsByInterface,
    relationsByKey,
    relationsByType,
    outgoingRelationsByObject,
    incomingRelationsByObject,
    linksById,
    linkIdsByObject,
    unresolvedRelationCount,
  }
}

export function buildEvidenceStore(
  observations: EvidenceObservation[],
  evidenceLinks: FindingEvidenceLink[]
): EvidenceStore {
  const observationsById = new Map<string, EvidenceObservation>()
  for (const obs of observations) observationsById.set(obs.id, obs)

  const evidenceLinksById = new Map<string, FindingEvidenceLink>()
  for (const link of evidenceLinks) evidenceLinksById.set(link.id, link)

  return {
    observationsById,
    evidenceLinksById,
  }
}
