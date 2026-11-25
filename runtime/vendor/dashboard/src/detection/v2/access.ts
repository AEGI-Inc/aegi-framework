import type { GraphStoreV2 } from '../../model/graph'
import type { ResolvedRelation } from '../../model/relation'
import * as onto from '../../ontology/generated'

export type AccessLevel = 'read' | 'write' | 'admin'

export interface EffectiveAccessQuery {
  principalKey: string
  resourceKey: string
  minimum?: AccessLevel
}

/** 권한을 준 경로. 룰이 Finding의 관련 관계·객체 목록을 채울 때 쓴다. */
export interface AccessPath {
  granted: boolean
  relationKeys: string[]
  objectKeys: string[]
}

/**
 * 기본 제공 역할 이름의 순위 (D-20, 2026-09-24 개정).
 *
 * Policy 객체가 없는 역할은 `has_role_on`의 역할 자리에 이름만 있다(`roleName`, name_key).
 * GitHub 저장소 역할(read < triage < write < maintain < admin)과
 * 저장소 권한 API의 옛 이름(pull/push)을 같은 순위로 읽는다.
 * none 은 권한 없음(GitHub 앱 설치 권한 none 등)이다. Google Drive 권한 배정의 role(reader, commenter, writer,
 * fileorganizer, organizer, owner)도 있다. Okta 표준 역할은 읽기 전용(read_only_admin)만 이름으로 순위를 안다.
 * 나머지 관리자 역할은 모르므로 권한 있음으로 본다.
 * 값은 개념 사전(capabilities.yaml 의 role_rank)에서 생성한 src/ontology/generated.ts 에서 온다.
 */
const ROLE_RANK = onto.ROLE_RANK

const MINIMUM_RANK: Record<AccessLevel, number> = { read: 1, write: 3, admin: 5 }

export function roleRank(roleName: string): number | undefined {
  return ROLE_RANK[roleName.trim().toLowerCase()]
}

/** `has_role_on`의 역할 이름. 기본 제공 역할이면 관계에 이름이 있고, Policy 객체면 그 객체의 role_name을 본다. */
function relationRoleName(rel: ResolvedRelation, graph: GraphStoreV2): string | undefined {
  if (rel.roleName) return rel.roleName
  const roleObject = rel.roleKey ? graph.objectsByKey.get(rel.roleKey) : undefined
  const value = roleObject?.canonical.properties.role_name
  return typeof value === 'string' && value ? value : undefined
}

/**
 * 관계 하나가 자원에 대한 권한을 주는지. 권한은 `has_role_on`만 준다.
 * 역할 이름으로 순위를 알면 최소 요구 이상이어야 하고, 모르면(커스텀 역할 등) 권한이 있다고 본다.
 * `member_of`는 소속일 뿐 권한이 아니다. 그룹을 거친 권한은 findAccessPath가 따로 본다.
 */
export function grantsAccess(rel: ResolvedRelation, resourceKey: string, minimum: AccessLevel | undefined, graph: GraphStoreV2): boolean {
  if (rel.targetKey !== resourceKey || rel.relationType !== 'has_role_on') return false
  return roleMeetsMinimum(rel, minimum, graph)
}

/**
 * `has_role_on` 하나의 역할이 최소 요구 이상인가. 역할 이름으로 순위를 모르면(커스텀 역할, SUPER_ADMIN 같은 관리자 역할) 참이다 —
 * 권한자 집합을 넓게 잡아 격차를 부풀리지 않는 쪽이다. `known` 은 순위를 알았는지.
 */
export function roleMeetsMinimum(rel: ResolvedRelation, minimum: AccessLevel | undefined, graph: GraphStoreV2): boolean {
  return roleCheck(rel, minimum, graph).ok
}

export function roleCheck(rel: ResolvedRelation, minimum: AccessLevel | undefined, graph: GraphStoreV2): { ok: boolean; known: boolean; roleName?: string } {
  const required = minimum ? MINIMUM_RANK[minimum] : 1
  const roleName = relationRoleName(rel, graph)
  const rank = roleName ? roleRank(roleName) : undefined
  return { ok: rank === undefined || rank >= required, known: rank !== undefined, roleName }
}

/**
 * 주체가 자원에 최소 권한 이상을 갖는 경로를 찾는다.
 * 직접 부여 → 한 단계 그룹(팀) 멤버십을 거친 부여 → 자원 안의 권한 배정(Assignment) 순으로 본다.
 */
export function findAccessPath(query: EffectiveAccessQuery, graph: GraphStoreV2): AccessPath {
  const { principalKey, resourceKey, minimum } = query
  const outgoing = graph.outgoingRelationsByObject.get(principalKey) ?? []

  for (const rel of outgoing) {
    if (grantsAccess(rel, resourceKey, minimum, graph)) {
      return {
        granted: true,
        relationKeys: [rel.relationKey],
        objectKeys: [principalKey, ...(rel.roleKey ? [rel.roleKey] : []), resourceKey],
      }
    }
  }

  // 한 단계 그룹 멤버십 (예: User → Team → Repository)
  for (const membership of outgoing) {
    if (membership.relationType !== 'member_of' || membership.targetKey === resourceKey) continue
    const groupKey = membership.targetKey
    for (const rel of graph.outgoingRelationsByObject.get(groupKey) ?? []) {
      if (grantsAccess(rel, resourceKey, minimum, graph)) {
        return {
          granted: true,
          relationKeys: [membership.relationKey, rel.relationKey],
          objectKeys: [principalKey, groupKey, ...(rel.roleKey ? [rel.roleKey] : []), resourceKey],
        }
      }
    }
  }

  // 자원에 걸린 권한 배정(Assignment) 객체가 이 주체를 받는 쪽으로 가리키는지
  for (const grant of listAssignmentGrants(resourceKey, graph)) {
    if (grant.granteeKey !== principalKey) continue
    const rank = grant.roleName ? roleRank(grant.roleName) : undefined
    if (minimum && rank !== undefined && rank < MINIMUM_RANK[minimum]) continue
    return {
      granted: true,
      relationKeys: grant.relationKey ? [grant.relationKey] : [],
      objectKeys: [principalKey, grant.assignmentKey, resourceKey],
    }
  }

  return { granted: false, relationKeys: [], objectKeys: [] }
}

interface AssignmentGrant {
  assignmentKey: string
  granteeKey: string
  /** v1 의 contained_in(배정 → 자원). v2 는 관계가 없어 비어 있다 */
  relationKey?: string
  /** 배정 객체의 역할 이름 (Drive reader/writer/owner 등). 없으면 순위를 모른다 */
  roleName?: string
}

/** 자원에 걸린 권한 배정 객체 하나. 어떻게 찾았는지(v1 contained_in 관계 / v2 references.parent)를 같이 든다 */
export interface AssignmentOnResource {
  assignmentKey: string
  relationKey?: string
}

const assignmentsByParentCache = new WeakMap<GraphStoreV2, Map<string, string[]>>()

/** references.parent → 그 자원을 가리키는 Assignment 객체들 (그래프마다 한 번 만든다) */
function assignmentsByParent(graph: GraphStoreV2): Map<string, string[]> {
  let index = assignmentsByParentCache.get(graph)
  if (!index) {
    index = new Map()
    for (const obj of graph.objectsByInterface.get('Assignment') ?? []) {
      for (const target of obj.canonical.references?.parent?.targets ?? []) {
        const parent = String(target.value)
        index.set(parent, [...(index.get(parent) ?? []), obj.fixture_key])
      }
    }
    assignmentsByParentCache.set(graph, index)
  }
  return index
}

/**
 * 자원에 걸린 권한 배정(Assignment) 객체 (Effective Access 적용안 §7).
 *
 * v1 은 배정 → 자원 `contained_in` 관계로 찾는다. v2 는 규격대로 그 관계를 만들지 않고(Assignment 는 관계 자신)
 * 배정 객체의 `references.parent` 가 자원을 가리킨다 — 둘 다 본다. 지운 배정(`deleted`)은 뺀다.
 * 같은 배정이 이미 `has_role_on`(`properties.via_assignment`)으로 펴져 있으면 그 관계가 권한을 말하므로 건너뛴다.
 */
export function assignmentsOn(resourceKey: string, graph: GraphStoreV2): AssignmentOnResource[] {
  const incoming = graph.incomingRelationsByObject.get(resourceKey) ?? []
  const spread = new Set(incoming.filter(rel => rel.relationType === 'has_role_on' && typeof rel.properties?.via_assignment === 'string').map(rel => String(rel.properties.via_assignment)))
  const found = new Map<string, AssignmentOnResource>()
  const consider = (assignmentKey: string, relationKey?: string) => {
    const assignment = graph.objectsByKey.get(assignmentKey)
    if (!assignment?.canonical.interfaces.includes('Assignment') || assignment.canonical.properties.deleted === true) return
    if (spread.has(assignmentKey) || found.has(assignmentKey)) return
    found.set(assignmentKey, { assignmentKey, relationKey })
  }
  for (const rel of incoming) if (rel.relationType === 'contained_in') consider(rel.sourceKey, rel.relationKey)
  for (const key of assignmentsByParent(graph).get(resourceKey) ?? []) consider(key)
  return [...found.values()]
}

function listAssignmentGrants(resourceKey: string, graph: GraphStoreV2): AssignmentGrant[] {
  const grants: AssignmentGrant[] = []
  for (const { assignmentKey, relationKey } of assignmentsOn(resourceKey, graph)) {
    const assignment = graph.objectsByKey.get(assignmentKey)!
    const role = assignment.canonical.properties.role
    for (const target of assignment.canonical.references?.grantee?.targets ?? []) {
      const key = String(target.value)
      if (graph.objectsByKey.has(key)) {
        grants.push({ assignmentKey, granteeKey: key, relationKey, roleName: typeof role === 'string' ? role : undefined })
      }
    }
  }
  return grants
}

