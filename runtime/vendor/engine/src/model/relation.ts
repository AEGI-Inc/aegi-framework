import type { Provider } from './object'
import * as onto from '../ontology/generated'

/**
 * 17 Canonical Relation Types according to Relation_Schema_v3:
 * 개념 사전(relation_types.yaml)에서 생성한 src/ontology/generated.ts 에서 온다. 순서도 사전 순서다(화면 고르기 칸 순서)
 */
export const ALLOWED_RELATION_TYPES = new Set(onto.RELATION_TYPES)

export type RelationType = onto.RelationType

export interface RelationRef {
  provider: string
  object_type: string
  identifier_type: string
  value: string | number
  kind: string
  status?: string
}

/**
 * `has_role_on`의 역할 자리.
 * - Policy 객체가 있는 역할(GitHub 커스텀 저장소 역할, Okta 사용자 정의 역할)은 그 객체를 가리킨다.
 * - 기본 제공 역할(GitHub read~admin, Okta 표준 역할, Drive owner·writer …)은 객체가 없으므로
 *   `kind: 'name_key'`, `object_type: null`로 이름만 둔다 (Profile_Schema_v4.2, 계획서 D-20).
 */
export type RoleRef = RelationRef | NameKeyRoleRef

export interface NameKeyRoleRef {
  provider: string
  object_type: null
  kind: 'name_key'
  value: string
  status?: string
}

export function isNameKeyRole(ref: RoleRef | undefined): ref is NameKeyRoleRef {
  return !!ref && ref.kind === 'name_key' && ref.object_type === null
}

export interface RelationSource {
  api: string
  params: Record<string, unknown>
  record: string
  schema_version: number
  collected_at: string
  first_seen_at?: string
  last_seen_at?: string
  revision?: number
  produced_by?: string[]
}

export interface AegiRelation {
  provider: Provider
  relation_type: RelationType
  template: string
  references: {
    source: RelationRef
    role?: RoleRef
    target: RelationRef
  }
  properties: {
    basis: 'stated' | 'computed' | 'flag'
    lifecycle?: string
    [key: string]: unknown
  }
  source: RelationSource
}

export interface FixtureRelation {
  fixture_key: string
  canonical: AegiRelation
  fixture_meta?: {
    overlay_only?: boolean
    [key: string]: unknown
  }
}

/**
 * Resolved representation of a Relation where source, target, and optional role
 * have been resolved to their corresponding FixtureObject fixture_key.
 */
export interface ResolvedRelation {
  relationKey: string
  relationType: RelationType
  provider: Provider
  template: string
  sourceKey: string
  targetKey: string
  /** 역할 자리가 Policy 객체일 때 그 객체 키 */
  roleKey?: string
  /** 역할 자리가 기본 제공 역할 이름(name_key)일 때 그 이름 */
  roleName?: string
  properties: {
    basis: 'stated' | 'computed' | 'flag'
    lifecycle?: string
    [key: string]: unknown
  }
  source: RelationSource
  raw: FixtureRelation
}
