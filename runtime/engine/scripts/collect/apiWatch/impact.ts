/**
 * API 스펙·수집 깨짐이 미치는 범위(Profile, 객체 타입, 인터페이스, 컴플라이언스 판정)를 찾는다.
 */
import type { ApiListEntry } from '../api-list/build'

export interface Impact {
  profiles: string[]
  object_types: string[]
  interfaces: string[]
  compliance_checks: string[]
}

export interface ImpactDeps {
  apiList: ApiListEntry[] | Map<string, ApiListEntry>
  complianceChecksByObjectType?: Map<string, string[]> | Record<string, string[]>
}

function entriesOf(apiList: ApiListEntry[] | Map<string, ApiListEntry>): ApiListEntry[] {
  return Array.isArray(apiList) ? apiList : [...apiList.values()]
}

function checksForObjectTypes(
  objectTypes: string[],
  map?: Map<string, string[]> | Record<string, string[]>,
): string[] {
  if (!map) return []
  const out = new Set<string>()
  for (const ot of objectTypes) {
    const list = map instanceof Map ? map.get(ot) : map[ot]
    if (Array.isArray(list)) {
      for (const id of list) out.add(id)
    }
  }
  return [...out].sort()
}

function buildImpact(
  entries: ApiListEntry[],
  deps: ImpactDeps,
  extraProfiles: string[] = [],
): Impact {
  const profiles = new Set<string>(extraProfiles)
  const objectTypes = new Set<string>()
  const interfaces = new Set<string>()

  for (const e of entries) {
    for (const p of e.profiles ?? []) profiles.add(p)
    for (const ot of e.object_types ?? []) objectTypes.add(ot)
    for (const iface of e.interfaces ?? []) interfaces.add(iface)
  }

  const sortedObjectTypes = [...objectTypes].sort()
  return {
    profiles: [...profiles].sort(),
    object_types: sortedObjectTypes,
    interfaces: [...interfaces].sort(),
    compliance_checks: checksForObjectTypes(sortedObjectTypes, deps.complianceChecksByObjectType),
  }
}

export function isEmptyImpact(impact: Impact): boolean {
  return (
    impact.profiles.length === 0 &&
    impact.object_types.length === 0 &&
    impact.interfaces.length === 0 &&
    impact.compliance_checks.length === 0
  )
}

export function impactOfOperation(opId: string, deps: ImpactDeps): Impact {
  const matched = entriesOf(deps.apiList).filter(e => e.operation_id === opId)
  return buildImpact(matched, deps)
}

export function impactOfProfile(profile: string, deps: ImpactDeps): Impact {
  const matched = entriesOf(deps.apiList).filter(
    e => (e.status === 'approved' || e.status === 'legacy') && (e.profiles ?? []).includes(profile),
  )
  return buildImpact(matched, deps, [profile])
}
