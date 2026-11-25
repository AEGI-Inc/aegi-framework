import * as onto from '../ontology/generated'

export type Provider = 'okta' | 'github' | 'slack' | 'gws' | 'atlassian' | 'salesforce' | 'aws' | 'cloudflare' | 'microsoft' | 'gcp' | 'onepassword' | 'snowflake'

/** interface 9종. 개념 사전(interfaces.yaml)에서 생성한 src/ontology/generated.ts 에서 온다 */
export type InterfaceType = onto.InterfaceType

/**
 * Interface_Spec_v3 계약값과 허용값. judged{} 에 둔다. direction·credential_kind 는 규격상 Profile 값이지만 이 저장소에는 Profile 이 없어 행(judged)에 둔다. null 은 값 형식만 본다(ISO 시각)
 * 허용값은 개념 사전(interfaces.yaml)에서 온다. 어느 필드를 행에서 판정할지는 aegi-adapter-engine scripts/ontology/generate.ts 의 JUDGED_FIELDS 가 정한다
 */
export const INTERFACE_CONTRACT_VALUES = onto.INTERFACE_CONTRACT_VALUES
export interface CatalogRef {
  id: string
  provider_term: string
  interface: string | string[]
}

export interface ObjectReferenceTarget {
  provider: string
  object_type: string
  identifier_type: string
  value: string | number
  status?: string
}

export interface ObjectReferenceWrapper {
  kind: string
  targets: ObjectReferenceTarget[]
}

export interface ObjectIdentifiers {
  primary: string[]
  [key: string]: unknown
}

export interface ObjectSourceObservation {
  api: string
  params?: Record<string, unknown>
  record: 'synthetic' | 'measured' | string
  collected_at?: string
  first_seen_at?: string
  last_seen_at?: string
  revision?: number
}

export interface ObjectSource {
  schema_version: number
  observations?: ObjectSourceObservation[]
  api?: string
  params?: Record<string, unknown>
  record?: string
  collected_at?: string
  first_seen_at?: string
  last_seen_at?: string
  revision?: number
}

export interface AegiObject {
  provider: Provider
  service?: string
  object_type: string
  interfaces: InterfaceType[]
  identifiers: ObjectIdentifiers
  references?: Record<string, ObjectReferenceWrapper>
  properties: Record<string, unknown>
  judged?: Record<string, unknown>
  source: ObjectSource
}

export interface FixtureObject {
  fixture_key: string
  catalog_ref?: CatalogRef
  canonical: AegiObject
  fixture_meta?: {
    display_name?: string
    demo_role?: string
    normal?: boolean
    asset_class?: string
    [key: string]: unknown
  }
}

