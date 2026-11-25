import type { GraphStoreV2 } from '../../model/graph'
import type { FixtureObject } from '../../model/object'
import type { ResolvedRelation } from '../../model/relation'
import { assignmentsOn, roleCheck, roleRank, type AccessLevel } from './access'
import { isMeasurementMembership } from './identity'

/**
 * 자원을 볼 수 있는 사람 집합 — 권한자·열람자를 관계 행으로 계산한다.
 *
 * ```
 * 권한자(X) = {P : P --has_role_on--> X} ∪ {P : P --member_of--> X} ∪ {P : X --owned_by--> P}
 *           ∪ {P : P --member_of--> G, G --has_role_on--> X}
 * 열람자(S) = 권한자(S) ∪ {P : S --shared_with--> T, P --member_of--> T}
 *           ∪ (S.is_private = false 이면 워크스페이스 멤버 전원)
 * ```
 *
 * - 그룹은 저장할 때 펼치지 않는다(Relation_Schema_v3 「조건이 id 목록이 아닐 때」). 여기서 member_of 를 타서 펼친다.
 * - Drive 권한 배정(Assignment)이 자원에 걸려 있으면(v1 `contained_in`, v2 `references.parent`) 그 grantee 도 권한자다. 지운 배정(`deleted`)은 뺀다.
 * - `anyone` 공유(target_kind: set)는 사람을 셀 수 없다 — `everyone` 으로 따로 알린다.
 * - 측정 도구(수집 봇)의 멤버십·계정은 세지 않는다.
 * - 펼치지 못한 것(멤버를 수집하지 못한 그룹, 멤버를 모르는 테넌트)은 `unresolved` 에 적는다. 지어내지 않는다.
 */

export type AudienceVia = 'direct' | 'assignment' | 'owner' | 'member' | 'group' | 'tenant' | 'public' | 'credential_owner'

export interface AudienceMember {
  key: string
  via: AudienceVia
}

export interface Audience {
  /** 사람(그룹이 아닌 주체) 계정. 같은 계정은 처음 찾은 경로로 한 번만 */
  members: AudienceMember[]
  /** 이 계산에 쓴 관계 키 (Finding 의 관련 관계로 올린다) */
  relationKeys: string[]
  /** 누구나(anyone) 볼 수 있다. 사람 목록으로 셀 수 없다 */
  everyone: boolean
  /** 펼치지 못한 것. 비어 있지 않으면 집합이 실제보다 작을 수 있다 */
  unresolved: string[]
  /** 근사로 넣은 것 (예: 공개 채널을 워크스페이스 소속 기록으로 펼침) */
  approximations: string[]
}

const GROUP_TYPES = new Set(['group', 'usergroup', 'team'])

function objectOf(key: string, graph: GraphStoreV2): FixtureObject | undefined {
  return graph.objectsByKey.get(key)
}

function nameOf(key: string, graph: GraphStoreV2): string {
  const obj = objectOf(key, graph)
  return obj?.fixture_meta?.display_name ?? String(obj?.canonical.properties.name ?? key)
}

function isMeasurementAccount(obj: FixtureObject | undefined): boolean {
  return obj?.fixture_meta?.demo_role === 'measurement_principal'
}

/** 그룹처럼 멤버를 가지는 주체인가 (principal_kind group, 그룹 타입, 또는 들어오는 member_of 가 있는 Principal) */
export function isGroupPrincipal(key: string, graph: GraphStoreV2): boolean {
  const obj = objectOf(key, graph)
  if (!obj || !obj.canonical.interfaces.includes('Principal')) return false
  if (obj.canonical.judged?.principal_kind === 'group') return true
  if (GROUP_TYPES.has(obj.canonical.object_type.toLowerCase())) return true
  return (graph.incomingRelationsByObject.get(key) ?? []).some(rel => rel.relationType === 'member_of')
}

function isTenant(key: string, graph: GraphStoreV2): boolean {
  return !!objectOf(key, graph)?.canonical.interfaces.includes('Tenant')
}

function refValues(obj: FixtureObject | undefined, name: string): string[] {
  return (obj?.canonical.references?.[name]?.targets ?? []).map(t => String(t.value))
}

/** 지운 권한 배정(Drive Permission deleted)에서 나온 관계인가 */
function isDeletedGrant(rel: ResolvedRelation, graph: GraphStoreV2): boolean {
  const via = rel.properties?.via_assignment
  if (typeof via !== 'string') return false
  return objectOf(via, graph)?.canonical.properties.deleted === true
}

class AudienceBuilder {
  private seen = new Set<string>()
  private expandedGroups = new Set<string>()
  readonly audience: Audience = { members: [], relationKeys: [], everyone: false, unresolved: [], approximations: [] }

  constructor(private graph: GraphStoreV2) {}

  useRelation(rel: ResolvedRelation): void {
    if (!this.audience.relationKeys.includes(rel.relationKey)) this.audience.relationKeys.push(rel.relationKey)
  }

  note(list: 'unresolved' | 'approximations', text: string): void {
    if (!this.audience[list].includes(text)) this.audience[list].push(text)
  }

  /** 주체 하나를 더한다. 그룹이면 멤버로 펼치고, 테넌트면 테넌트 멤버로 펼친다 */
  addPrincipal(key: string, via: AudienceVia): void {
    const obj = objectOf(key, this.graph)
    if (!obj || isMeasurementAccount(obj)) return
    if (isTenant(key, this.graph)) {
      this.addTenantMembers(key, via === 'public' ? 'public' : 'tenant')
      return
    }
    if (isGroupPrincipal(key, this.graph)) {
      this.expandGroup(key)
      return
    }
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.audience.members.push({ key, via })
  }

  /** 그룹 G 의 멤버 {P : P --member_of--> G}. 중첩 그룹도 펼친다(순환은 한 번만) */
  expandGroup(groupKey: string): void {
    if (this.expandedGroups.has(groupKey)) return
    this.expandedGroups.add(groupKey)
    const memberships = (this.graph.incomingRelationsByObject.get(groupKey) ?? [])
      .filter(rel => rel.relationType === 'member_of' && !isMeasurementMembership(rel))
    if (!memberships.length) {
      this.note('unresolved', `그룹 ${nameOf(groupKey, this.graph)}의 멤버를 수집하지 못해 펼치지 못했습니다`)
      return
    }
    for (const rel of memberships) {
      this.useRelation(rel)
      this.addPrincipal(rel.sourceKey, 'group')
    }
  }

  /** 테넌트 T 의 멤버: {P : P --member_of--> T} ∪ references.tenant/parent 가 T 인 주체 */
  addTenantMembers(tenantKey: string, via: 'tenant' | 'public'): void {
    let found = 0
    for (const rel of this.graph.incomingRelationsByObject.get(tenantKey) ?? []) {
      if (rel.relationType !== 'member_of' || isMeasurementMembership(rel)) continue
      const obj = objectOf(rel.sourceKey, this.graph)
      if (!obj?.canonical.interfaces.includes('Principal') || isGroupPrincipal(rel.sourceKey, this.graph)) continue
      this.useRelation(rel)
      this.addPrincipal(rel.sourceKey, via)
      found++
    }
    const provider = objectOf(tenantKey, this.graph)?.canonical.provider
    for (const obj of provider ? this.graph.objectsByProvider.get(provider) ?? [] : []) {
      if (!obj.canonical.interfaces.includes('Principal') || isGroupPrincipal(obj.fixture_key, this.graph)) continue
      if (![...refValues(obj, 'tenant'), ...refValues(obj, 'parent')].includes(tenantKey)) continue
      this.addPrincipal(obj.fixture_key, via)
      found++
    }
    if (!found) this.note('unresolved', `${nameOf(tenantKey, this.graph)}의 멤버를 알 수 없어 펼치지 못했습니다`)
  }
}

/** 자원 X 의 권한자 — 공유(shared_with)·공개 여부는 보지 않는다 */
function collectAuthorized(builder: AudienceBuilder, resourceKey: string, graph: GraphStoreV2): void {
  for (const rel of graph.incomingRelationsByObject.get(resourceKey) ?? []) {
    if (rel.relationType === 'has_role_on' && !isDeletedGrant(rel, graph)) {
      builder.useRelation(rel)
      builder.addPrincipal(rel.sourceKey, 'direct')
    } else if (rel.relationType === 'member_of' && !isMeasurementMembership(rel)) {
      builder.useRelation(rel)
      builder.addPrincipal(rel.sourceKey, 'member')
    }
  }
  // 자원에 걸린 권한 배정(Assignment)이 가리키는 받는 쪽
  for (const { assignmentKey, relationKey } of assignmentsOn(resourceKey, graph)) {
    const grantees = refValues(objectOf(assignmentKey, graph), 'grantee').filter(key => graph.objectsByKey.has(key))
    if (!grantees.length) continue
    if (relationKey) builder.useRelation(graph.relationsByKey.get(relationKey)!)
    for (const key of grantees) builder.addPrincipal(key, 'assignment')
  }
  for (const rel of graph.outgoingRelationsByObject.get(resourceKey) ?? []) {
    if (rel.relationType === 'owned_by') {
      builder.useRelation(rel)
      builder.addPrincipal(rel.targetKey, 'owner')
    }
  }
}

/**
 * 열람자(S): 권한자(S) ∪ 공유받은 테넌트 멤버 ∪ (공개 채널이면 워크스페이스 멤버 전원).
 * Drive `anyone` 공유는 everyone 으로 알린다. Slack 외부 공유 채널은 밖의 멤버를 셀 수 없어 unresolved 에 적는다.
 */
export function viewerAudience(resourceKey: string, graph: GraphStoreV2): Audience {
  const builder = new AudienceBuilder(graph)
  collectAuthorized(builder, resourceKey, graph)
  const resource = objectOf(resourceKey, graph)

  const props = resource?.canonical.properties ?? {}
  // Slack 채널의 shared_with(internal_team_ids)는 "이 워크스페이스들에서 쓸 수 있다"는 뜻이지 그 멤버가 읽을 수 있다는 뜻이 아니다.
  // 비공개 채널이면 멤버만 읽고, 공개 채널이면 공유된 워크스페이스 멤버 전원이 읽는다. Drive 파일(is_private 없음)은 그대로 공유 대상 전원이다.
  const isChannel = typeof props.is_private === 'boolean'
  const publicWorkspaces = new Set<string>()
  for (const rel of graph.outgoingRelationsByObject.get(resourceKey) ?? []) {
    if (rel.relationType !== 'shared_with' || isDeletedGrant(rel, graph)) continue
    if (isChannel) {
      if (props.is_private === false && isTenant(rel.targetKey, graph)) {
        builder.useRelation(rel)
        publicWorkspaces.add(rel.targetKey)
      }
      continue
    }
    builder.useRelation(rel)
    const kind = rel.properties?.permission_type
    if (kind === 'anyone' || rel.properties?.target_kind === 'set') {
      builder.audience.everyone = true
      continue
    }
    builder.addTenantMembers(rel.targetKey, 'tenant')
  }

  if (props.is_private === false) {
    // 공개 채널: 채널이 든(또는 공유된) 워크스페이스의 멤버 전원이 읽을 수 있다
    const workspaces = new Set<string>(publicWorkspaces)
    for (const rel of graph.outgoingRelationsByObject.get(resourceKey) ?? []) {
      if (rel.relationType === 'contained_in' && isTenant(rel.targetKey, graph)) workspaces.add(rel.targetKey)
    }
    if (!workspaces.size) for (const key of [...refValues(resource, 'tenant'), ...refValues(resource, 'parent')]) if (isTenant(key, graph)) workspaces.add(key)
    if (!workspaces.size) builder.note('unresolved', '공개 채널이지만 소속 워크스페이스를 찾지 못했습니다')
    for (const ws of workspaces) builder.addTenantMembers(ws, 'public')
    builder.note('approximations', '공개 채널이라 워크스페이스 멤버 전원을 열람자로 넣었습니다')
  }
  if (props.is_ext_shared === true) {
    builder.note('unresolved', '외부 조직과 공유된 채널이라 상대 조직 멤버는 셀 수 없습니다')
  }
  if (props.restricted_to_groups !== undefined && props.restricted_to_groups !== null) {
    builder.note('unresolved', 'IdP 그룹 접근 제한은 스키마에 관계가 없어 반영하지 못했습니다')
  }
  return builder.audience
}

const MINIMUM_RANK: Record<AccessLevel, number> = { read: 1, write: 3, admin: 5 }

/**
 * 객체 X 에 대해 권한을 쓰는 범위: X 자신과 그 위(`contained_in`·`references.parent`·`references.tenant`)를 차례로.
 * 커밋 → 저장소 → 조직, Okta 사용자 → Okta 조직, 인증 수단 → 사용자 → 조직.
 */
export function authorityScopes(objectKey: string, graph: GraphStoreV2, depth = 5): string[] {
  const out: string[] = []
  let frontier = [objectKey]
  for (let d = 0; d <= depth && frontier.length; d++) {
    const next: string[] = []
    for (const key of frontier) {
      if (out.includes(key) || !graph.objectsByKey.has(key)) continue
      out.push(key)
      const obj = objectOf(key, graph)
      for (const rel of graph.outgoingRelationsByObject.get(key) ?? []) if (rel.relationType === 'contained_in') next.push(rel.targetKey)
      next.push(...refValues(obj, 'parent'), ...refValues(obj, 'tenant'))
    }
    frontier = next
  }
  return out
}

/**
 * 객체 X 를 스스로 바꿀 수 있는 사람 (적어도 minimum 역할) — 연동이 대신 해 준 일을 원래는 누가 할 수 있었나.
 * X 와 그 위 범위(authorityScopes)에 `has_role_on`(역할 순위 ≥ minimum) · 권한 배정(역할 순위 ≥ minimum) · 소유(`owned_by`)로 닿는 주체.
 * 그룹은 멤버로 펼친다. 테넌트 소속(`member_of` 테넌트)은 권한이 아니다.
 * 이름으로 순위를 모르는 역할(SUPER_ADMIN·커스텀 역할 등)은 권한 있음으로 넣고 `widened` 에 적는다 — 권한자를 넓게 잡으니 격차는 줄어드는 쪽이다.
 */
export function authorityAudience(objectKey: string, graph: GraphStoreV2, minimum: AccessLevel): Audience & { scopes: string[]; widened: string[] } {
  const builder = new AudienceBuilder(graph)
  const scopes = authorityScopes(objectKey, graph)
  const widened: string[] = []
  for (const scope of scopes) {
    for (const rel of graph.incomingRelationsByObject.get(scope) ?? []) {
      if (rel.relationType !== 'has_role_on' || isDeletedGrant(rel, graph)) continue
      const check = roleCheck(rel, minimum, graph)
      if (!check.ok) continue
      if (!check.known && check.roleName && !widened.includes(check.roleName)) widened.push(check.roleName)
      builder.useRelation(rel)
      builder.addPrincipal(rel.sourceKey, 'direct')
    }
    for (const { assignmentKey, relationKey } of assignmentsOn(scope, graph)) {
      const assignment = objectOf(assignmentKey, graph)
      const role = assignment?.canonical.properties.role
      const rank = typeof role === 'string' ? roleRank(role) : undefined
      if (rank !== undefined && rank < MINIMUM_RANK[minimum]) continue
      const grantees = refValues(assignment, 'grantee').filter(key => graph.objectsByKey.has(key))
      if (!grantees.length) continue
      if (relationKey) builder.useRelation(graph.relationsByKey.get(relationKey)!)
      for (const key of grantees) builder.addPrincipal(key, 'assignment')
    }
    for (const rel of graph.outgoingRelationsByObject.get(scope) ?? []) {
      if (rel.relationType !== 'owned_by') continue
      builder.useRelation(rel)
      builder.addPrincipal(rel.targetKey, 'owner')
    }
  }
  return { ...builder.audience, scopes, widened }
}

