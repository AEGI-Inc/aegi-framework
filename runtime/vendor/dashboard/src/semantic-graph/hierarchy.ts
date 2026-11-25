import type { FixtureObject, ObjectReferenceWrapper, Provider } from '../model/object'
import type { GraphStore } from '../model/graph'
import type { SecurityScopeKind, SemanticHierarchy } from './types'

function getDisplayName(obj: FixtureObject): string {
  const props = obj.canonical.properties
  const profile = typeof props.profile === 'object' && props.profile !== null
    ? props.profile as Record<string, unknown>
    : undefined
  const metaName = obj.fixture_meta?.display_name
  const candidates = [
    metaName,
    props.name,
    props.displayName,
    props.login,
    props.title,
    profile?.name,
    props.email,
  ]
  const found = candidates.find(value => typeof value === 'string' && value.trim().length > 0)
  return found ? String(found) : obj.fixture_key
}

export function resolveReferenceObjects(
  wrapper: ObjectReferenceWrapper | undefined,
  source: FixtureObject,
  graph: GraphStore
): FixtureObject[] {
  if (!wrapper?.targets?.length) return []
  const matches: FixtureObject[] = []

  for (const target of wrapper.targets) {
    // `primary` 참조의 값은 fixture_key 다(D-03). identifiers.primary 는 필드 이름 배열이라
    // 아래의 값 대조로는 풀리지 않는다 — 그대로 두면 tenant·parent 참조가 모두 빠져
    // 사용자·메시지가 가짜 테넌트(SLK-ENT-001 등)로 떨어진다.
    if (target.identifier_type === 'primary') {
      const candidate = graph.objectsByKey.get(String(target.value))
      if (candidate && candidate.canonical.provider === target.provider &&
        candidate.canonical.object_type.toLowerCase() === target.object_type.toLowerCase()) {
        matches.push(candidate)
      }
      continue
    }
    for (const candidate of graph.objectsByKey.values()) {
      if (candidate.canonical.provider !== target.provider) continue
      if (candidate.canonical.object_type.toLowerCase() !== target.object_type.toLowerCase()) continue
      const detail = candidate.canonical.identifiers[target.identifier_type]
      if (
        typeof detail === 'object' &&
        detail !== null &&
        'value' in detail &&
        String((detail as { value: string | number }).value) === String(target.value)
      ) {
        matches.push(candidate)
      }
    }
  }

  // A reference to another provider is valid for cross-provider metadata, but
  // security scope assignment stays provider-local.
  return matches.filter(candidate => candidate.canonical.provider === source.canonical.provider)
}

function nativeScopeKind(obj: FixtureObject): SecurityScopeKind | null {
  const provider = obj.canonical.provider.toLowerCase()
  const type = obj.canonical.object_type.toLowerCase()

  if (provider === 'okta') {
    if (type === 'group') return 'Group'
    if (type === 'org') return 'Tenant Policy'
  }

  if (provider === 'github') {
    if (type === 'team') return 'Team'
    if (type === 'repository') return 'Repository'
    if (type === 'repositoryrole') return 'Access Role'
    if (type === 'webhook') return 'Integration'
  }

  if (provider === 'gws') {
    if (type === 'group') return 'Group'
    if (type === 'file') return 'File / Resource'
  }

  if (provider === 'slack') {
    if (type === 'enterprise' || type === 'team') return 'Workspace'
    if (type === 'channel') return 'Channel'
    if (type === 'usergroup') return 'User Group'
    if (type === 'workflow' || type === 'incoming-webhook') return 'Automation / Endpoint'
  }

  return null
}

function isPreferredMembershipTarget(source: FixtureObject, target: FixtureObject): boolean {
  const provider = source.canonical.provider.toLowerCase()
  const type = target.canonical.object_type.toLowerCase()
  if (provider === 'okta') return type === 'group'
  if (provider === 'github') return type === 'team'
  if (provider === 'gws') return type === 'group'
  if (provider === 'slack') return type === 'usergroup' || type === 'channel' || type === 'team'
  return false
}

function membershipRank(source: FixtureObject, target: FixtureObject): number {
  const provider = source.canonical.provider.toLowerCase()
  const type = target.canonical.object_type.toLowerCase()
  if (provider === 'slack') {
    if (type === 'team') return 0
    if (type === 'usergroup') return 1
    if (type === 'channel') return 2
  }
  return 0
}

function syntheticBucketKind(obj: FixtureObject): SecurityScopeKind {
  const provider = obj.canonical.provider.toLowerCase()
  if (obj.canonical.interfaces.includes('Tenant')) {
    return provider === 'okta' ? 'Tenant Policy' : provider === 'slack' ? 'Workspace' : 'Tenant / Administration'
  }
  if (obj.canonical.interfaces.includes('Policy')) {
    return provider === 'github' ? 'Access Role' : 'Tenant Policy'
  }
  if (obj.canonical.interfaces.includes('Resource')) return 'File / Resource'
  if (obj.canonical.interfaces.includes('Endpoint') || obj.canonical.interfaces.includes('Automation')) {
    return provider === 'slack' ? 'Automation / Endpoint' : 'Integration'
  }
  if (obj.canonical.interfaces.includes('Integration') || obj.canonical.interfaces.includes('Credential')) {
    return 'Integration'
  }
  return 'Identity'
}

function slugScopeKind(kind: SecurityScopeKind): string {
  return kind.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function makeAnchorScope(
  obj: FixtureObject,
  tenantKey: string,
  kind: SecurityScopeKind
): { scopeNodeId: string; scopeKind: SecurityScopeKind; scopeLabel: string; scopeAnchorObjectKey: string } {
  return {
    scopeNodeId: `scope:${obj.canonical.provider}:${tenantKey}:anchor:${obj.fixture_key}`,
    scopeKind: kind,
    scopeLabel: `${kind}, ${getDisplayName(obj)}`,
    scopeAnchorObjectKey: obj.fixture_key,
  }
}

function makeBucketScope(
  obj: FixtureObject,
  tenantKey: string,
  kind: SecurityScopeKind
): { scopeNodeId: string; scopeKind: SecurityScopeKind; scopeLabel: string; scopeAnchorObjectKey?: string } {
  return {
    scopeNodeId: `scope:${obj.canonical.provider}:${tenantKey}:bucket:${slugScopeKind(kind)}`,
    scopeKind: kind,
    scopeLabel: kind,
  }
}

/**
 * Resolves the canonical tenant key for a given object.
 * The result is structural only and does not create a canonical Relation.
 */
export function resolveObjectTenantKey(obj: FixtureObject, graph: GraphStore): string {
  if (obj.canonical.interfaces.includes('Tenant')) return obj.fixture_key

  const outgoing = graph.outgoingRelationsByObject.get(obj.fixture_key) ?? []

  const contextTeam = resolveReferenceObjects(obj.canonical.references?.context_team, obj, graph)[0]
  if (contextTeam?.canonical.interfaces.includes('Tenant')) return contextTeam.fixture_key

  // Slack users are operationally scoped to a workspace even when the API row's
  // tenant reference points at the Enterprise root. Choose one deterministic
  // primary workspace for placement; additional workspace memberships remain edges.
  if (obj.canonical.provider === 'slack' && obj.canonical.interfaces.includes('Principal')) {
    const workspace = outgoing
      .filter(rel => rel.relationType === 'member_of')
      .map(rel => graph.objectsByKey.get(rel.targetKey))
      .filter((candidate): candidate is FixtureObject => Boolean(candidate))
      .filter(candidate => candidate.canonical.object_type.toLowerCase() === 'team')
      .sort((a, b) => a.fixture_key.localeCompare(b.fixture_key))[0]
    if (workspace) return workspace.fixture_key
  }

  // Delivery/automation objects inherit the destination workspace before falling
  // back to a broad tenant reference.
  const destination = outgoing
    .filter(rel => rel.relationType === 'receives_into' || rel.relationType === 'triggered_by')
    .map(rel => graph.objectsByKey.get(rel.targetKey))
    .find((candidate): candidate is FixtureObject => Boolean(candidate))
  if (destination) {
    const destinationTenant = resolveObjectTenantKey(destination, graph)
    if (destinationTenant) return destinationTenant
  }

  const directTenant = resolveReferenceObjects(obj.canonical.references?.tenant, obj, graph)[0]
  if (directTenant?.canonical.interfaces.includes('Tenant')) return directTenant.fixture_key

  const containedTenant = outgoing
    .filter(rel => rel.relationType === 'contained_in')
    .map(rel => graph.objectsByKey.get(rel.targetKey))
    .find(candidate => candidate?.canonical.interfaces.includes('Tenant'))
  if (containedTenant) return containedTenant.fixture_key

  const parent = resolveReferenceObjects(obj.canonical.references?.parent, obj, graph)[0]
  if (parent?.canonical.interfaces.includes('Tenant')) return parent.fixture_key
  if (parent) {
    const parentTenant = resolveObjectTenantKey(parent, graph)
    if (parentTenant) return parentTenant
  }

  const provider = obj.canonical.provider.toLowerCase()
  if (provider === 'okta') return 'OKTA-ORG-001'
  if (provider === 'github') return 'GH-ORG-001'
  if (provider === 'gws') return 'GWS-CUST-001'
  if (provider === 'slack') return 'SLK-ENT-001'
  return `${provider}-default-tenant`
}

/**
 * Assigns exactly one primary provider-native Security Scope to every Object.
 * Scope anchors are real Group/Team/Repository/Channel/etc. objects where possible.
 * Secondary memberships remain canonical Relations and therefore stay visible as edges.
 */
export function resolvePrimarySecurityScope(
  obj: FixtureObject,
  graph: GraphStore,
  tenantKey: string
): { scopeNodeId: string; scopeKind: SecurityScopeKind; scopeLabel: string; scopeAnchorObjectKey?: string } {
  const selfKind = nativeScopeKind(obj)
  if (selfKind) return makeAnchorScope(obj, tenantKey, selfKind)

  // Strong structural parent wins for non-anchor objects when the parent itself
  // is a provider-native scope (for example a child resource under a repository).
  const parentCandidates = [
    ...resolveReferenceObjects(obj.canonical.references?.parent, obj, graph),
    ...(graph.outgoingRelationsByObject.get(obj.fixture_key) ?? [])
      .filter(rel => rel.relationType === 'contained_in')
      .map(rel => graph.objectsByKey.get(rel.targetKey))
      .filter((candidate): candidate is FixtureObject => Boolean(candidate)),
  ]
  const structuralAnchor = parentCandidates.find(candidate => nativeScopeKind(candidate) !== null)
  if (structuralAnchor) {
    return makeAnchorScope(structuralAnchor, tenantKey, nativeScopeKind(structuralAnchor)!)
  }

  // Principals can belong to multiple scopes. Pick one deterministic primary scope
  // for spatial placement; every additional membership is preserved as a Relation edge.
  if (obj.canonical.interfaces.includes('Principal')) {
    const memberTargets = (graph.outgoingRelationsByObject.get(obj.fixture_key) ?? [])
      .filter(rel => rel.relationType === 'member_of')
      .map(rel => graph.objectsByKey.get(rel.targetKey))
      .filter((candidate): candidate is FixtureObject => Boolean(candidate))
      .filter(candidate => candidate.canonical.provider === obj.canonical.provider)
      .filter(candidate => isPreferredMembershipTarget(obj, candidate))
      .sort((a, b) => {
        const rank = membershipRank(obj, a) - membershipRank(obj, b)
        if (rank !== 0) return rank
        return a.fixture_key.localeCompare(b.fixture_key)
      })

    const primaryMembership = memberTargets[0]
    if (primaryMembership) {
      const kind = nativeScopeKind(primaryMembership)
      if (kind) return makeAnchorScope(primaryMembership, tenantKey, kind)
    }
  }

  return makeBucketScope(obj, tenantKey, syntheticBucketKind(obj))
}

/** 조직 단계에서 service 로 따로 묶은 원의 id 표시: <조직 객체 키>|service:<service> */
export const SERVICE_TENANT_MARK = '|service:'

/** 원의 id(tenantKey)에서 조직 객체 키만 꺼낸다. service 원이 아니면 그대로다 */
export function tenantObjectKey(tenantKey: string): string {
  const mark = tenantKey.indexOf(SERVICE_TENANT_MARK)
  return mark < 0 ? tenantKey : tenantKey.slice(0, mark)
}

/**
 * 조직 객체와 service(canonical.service)가 다른 객체는 그 조직 아래 service 원으로 따로 묶는다.
 * 화면 배치일 뿐이고 관계나 조직 객체를 만들지 않는다. service 가 없거나 조직 객체와 같으면 조직 원 그대로다.
 */
function serviceTenantKey(obj: FixtureObject, tenantKey: string, graph: GraphStore): string {
  const tenant = graph.objectsByKey.get(tenantKey)
  const service = obj.canonical.service
  if (!tenant || tenant === obj || !service || service === tenant.canonical.service) return tenantKey
  return `${tenantKey}${SERVICE_TENANT_MARK}${service}`
}

/**
 * Builds the complete 4-tier hierarchy for all objects in the GraphStore.
 * Every Object is assigned exactly one primary scope for layout.
 */
export function buildObjectHierarchy(graph: GraphStore): Map<string, SemanticHierarchy> {
  const hierarchyMap = new Map<string, SemanticHierarchy>()

  for (const obj of graph.objectsByKey.values()) {
    const provider = obj.canonical.provider.toLowerCase() as Provider
    const tenantKey = serviceTenantKey(obj, resolveObjectTenantKey(obj, graph), graph)
    const scope = resolvePrimarySecurityScope(obj, graph, tenantKey)

    hierarchyMap.set(obj.fixture_key, {
      objectKey: obj.fixture_key,
      ecosystemNodeId: provider,
      tenantNodeId: tenantKey,
      scopeNodeId: scope.scopeNodeId,
      objectNodeId: obj.fixture_key,
      provider,
      tenantKey,
      objectType: obj.canonical.object_type,
      scopeKind: scope.scopeKind,
      scopeLabel: scope.scopeLabel,
      scopeAnchorObjectKey: scope.scopeAnchorObjectKey,
    })
  }

  return hierarchyMap
}
