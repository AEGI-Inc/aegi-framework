export type ResolutionType = 'cross_saas_identity' | 'endpoint_destination_match' | 'automation_destination_match'


export interface FixtureResolutionMember {
  fixture_key: string
  [key: string]: unknown
}


export interface FixtureResolutionEndpoints {
  source_fixture_key?: string
  target_fixture_key?: string
  [key: string]: unknown
}


export interface FixtureResolution {
  resolution_id: string
  resolution_type: ResolutionType
  status: string
  members?: FixtureResolutionMember[]
  endpoints?: FixtureResolutionEndpoints
  fixture_evidence?: {
    source?: string
    person_id?: string
    display_name?: string
    note?: string
    overlay_only?: boolean
    [key: string]: unknown
  }
}