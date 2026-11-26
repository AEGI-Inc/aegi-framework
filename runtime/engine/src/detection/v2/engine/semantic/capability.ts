/**
 * 관계 의미 층 — 역할 · 소속 · 배정 객체의 능력 목록 (명세 aegi-knowledge Relation_Semantic_Layer_v1 「능력」).
 *
 * 표는 사전 capabilities.yaml 의 의미 층 능력 목록에서 생성한 src/ontology/generated.ts CAPABILITY_* 다. 능력 목록은 세기 표에서 생성 때 계산했다.
 * 역할 하나는 CAPABILITY_ORDER 차례로 본다(지금 accessModel.ts roleCapability 와 같은 차례). SaaS 이름은 표 열쇠로만 쓴다 — 이 파일에 provider 이름 분기는 없다.
 * 능력 목록의 세기(rank)는 가장 센 능력의 세기다. 빈 목록이면 0, 목록을 모르면 undefined(엔진 role_rank_unknown).
 */
import type { GraphStoreV2 } from '../../../../model/graph'
import type { FixtureObject } from '../../../../model/object'
import type { ResolvedRelation } from '../../../../model/relation'
import {
  CAPABILITY_BASE_ROLE, CAPABILITY_BUNDLES, CAPABILITY_FLAGS, CAPABILITY_FROM_GRANTS, CAPABILITY_NAMES, CAPABILITY_OBJECT_TYPES, CAPABILITY_OF_RANK,
  CAPABILITY_ORDER, CAPABILITY_PREFIXES, CAPABILITY_PRIVILEGES, CAPABILITY_SCOPES, CAPABILITY_SUMMARY, CAPABILITY_VOCABULARY, MEMBERSHIP_CAPABILITIES,
} from '../../../../ontology/generated'
import type { EngineOverrides } from '../types'

/** 능력 목록과 어디서 알았나. caps 가 없으면 모름 */
export interface Caps { caps?: string[]; applies_to?: string[]; /** 아래 객체로 내려갈 때 남는 능력(역할 능력표 below) */ below?: string[]; source: string; /** 능력은 읽었는데 어느 객체 종류에 닿는지 모름(scope 표에 자원이 없음) */ unresolved?: string[] }

const uniq = (xs: readonly string[]) => [...new Set(xs)]

/** 묶음 이름 · 능력 목록 → 능력 목록 */
export function expandCaps(c: string | readonly string[] | undefined): string[] | undefined {
  if (c === undefined) return undefined
  if (typeof c === 'string') return [...(CAPABILITY_BUNDLES[c] ?? [c])]
  return uniq(c.flatMap(x => CAPABILITY_BUNDLES[x] ?? [x]))
}

/** 능력 목록의 세기: 가장 센 능력. 빈 목록 0, 모름 undefined */
export function rankOf(caps: readonly string[] | undefined): number | undefined {
  if (!caps) return undefined
  return caps.reduce((m, c) => Math.max(m, CAPABILITY_VOCABULARY[c]?.rank ?? 0), 0)
}

/** 세기 → 능력 목록(사람이 확인한 세기 overrides · 토큰 scope 세기). 표에 없는 세기는 그 아래 가장 가까운 세기 */
export function capsOfRank(rank: number): string[] {
  const known = Object.keys(CAPABILITY_OF_RANK).map(Number).filter(r => r <= rank).sort((a, b) => b - a)
  return [...(CAPABILITY_OF_RANK[known[0] ?? 0] ?? [])]
}

const getPath = (o: FixtureObject | undefined, at: string): unknown => at.split('.').reduce<any>((v, k) => (v == null ? undefined : v[k]), o?.canonical)

/** 이름 → 능력. provider 표, 다음 '*' 표, 다음 권한 요약 「키:수준,키:수준」 */
function byName(provider: string, name: string): Caps | undefined {
  for (const table of [provider, '*']) {
    for (const row of CAPABILITY_NAMES[table] ?? []) {
      const s = row.ignore_case ? name.trim().toLowerCase() : name.trim()
      if (new RegExp(row.match, row.ignore_case ? 'i' : '').test(s)) return { caps: [...row.caps], applies_to: row.applies_to ? [...row.applies_to] : undefined, ...(row.below ? { below: [...row.below] } : {}), source: table === '*' ? 'name' : 'name:provider' }
    }
  }
  if (name.includes(CAPABILITY_SUMMARY.kv)) {
    let best: string[] | undefined
    for (const part of name.split(CAPABILITY_SUMMARY.split)) {
      const level = part.split(CAPABILITY_SUMMARY.kv)[1]?.trim().toLowerCase()
      const caps = level ? CAPABILITY_SUMMARY.levels[level] : undefined
      if (caps) best = uniq([...(best ?? []), ...caps])
    }
    if (best) return { caps: best, source: 'permission_summary' }
  }
  return undefined
}

export interface RoleInput {
  provider: string
  roleName?: string
  roleKey?: string
  roleObject?: FixtureObject
  /** 관계 행의 권한 키 목록(properties.permissions) */
  permissions?: unknown
  overrides?: EngineOverrides
  /** 그 역할 객체가 같은 대상에 받은 has_role_on 줄들의 능력 (grants 단계) */
  sameTarget?: () => Array<string[] | undefined>
}

/** 역할 하나의 능력. overrides 다음은 CAPABILITY_ORDER 차례. 앞 방법이 못 정하면 다음 방법 */
export function roleCaps(inp: RoleInput): Caps {
  const { provider, roleObject: ro, overrides } = inp
  const o = (inp.roleKey && overrides?.role_capabilities?.[inp.roleKey]) || (inp.roleName && overrides?.role_capabilities?.[`${provider}:${inp.roleName}`])
  if (o) return { caps: capsOfRank(o.rank ?? 0), applies_to: o.applies_to?.map(x => x.toLowerCase()), source: 'override' }
  const name = inp.roleName ?? (typeof ro?.canonical.properties.role_name === 'string' ? String(ro.canonical.properties.role_name) : undefined)
  for (const how of CAPABILITY_ORDER) {
    const got = step(how, inp, name)
    if (got?.caps) return got
  }
  return { source: 'unknown' }
}

function step(how: (typeof CAPABILITY_ORDER)[number], inp: RoleInput, name: string | undefined): Caps | undefined {
  const { provider, roleObject: ro } = inp
  switch (how) {
    case 'permissions': {
      // 권한 키마다 이름 단계로 센 것을 합친다(판단표 G4-Q01). 아는 키가 없으면 다음 단계
      const known = (Array.isArray(inp.permissions) ? inp.permissions.map(String) : []).map(p => byName(provider, p)).filter((x): x is Caps => !!x?.caps)
      return known.length ? { caps: uniq(known.flatMap(k => k.caps!)), source: 'permissions' } : undefined
    }
    case 'name':
      return name ? byName(provider, name) : undefined
    case 'scopes': {
      // 맞는 줄 전부의 능력, 하나도 안 맞으면 빈 목록(데이터에 닿지 않는 scope). 그 provider 표나 scope 목록이 없으면 모름
      const table = CAPABILITY_SCOPES.tables[provider]
      const raw = getPath(ro, CAPABILITY_SCOPES.from)
      const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[\s,]+/).filter(Boolean) : undefined
      if (!table || !list) return undefined
      return { caps: uniq(list.flatMap(s => table.filter(r => new RegExp(r.match).test(s)).flatMap(r => r.caps))), source: 'scopes' }
    }
    case 'privileges': {
      // 이름마다 처음 맞는 줄, 하나도 안 맞으면 모름
      const table = CAPABILITY_PRIVILEGES.tables[provider]
      const raw = getPath(ro, CAPABILITY_PRIVILEGES.from)
      if (!table || !Array.isArray(raw)) return undefined
      const hit = raw.map(p => table.find(r => new RegExp(r.match).test(String(p)))).filter((r): r is NonNullable<typeof r> => !!r)
      return hit.length ? { caps: uniq(hit.flatMap(r => r.caps)), source: 'privileges' } : undefined
    }
    case 'flags': {
      // 참인 칸의 능력. 칸은 있는데 참이 없으면 빈 목록, 칸이 하나도 없으면 모름
      const table = CAPABILITY_FLAGS[provider]
      const props = ro?.canonical.properties
      if (!table || !props) return undefined
      const seen = table.filter(r => r.field.replace(/^properties\./, '') in props)
      return seen.length ? { caps: uniq(seen.filter(r => props[r.field.replace(/^properties\./, '')] === true).flatMap(r => r.caps)), source: 'flags' } : undefined
    }
    case 'object_type': {
      const v = ro ? CAPABILITY_OBJECT_TYPES[provider]?.[ro.canonical.object_type] : undefined
      return v ? { caps: [...v], source: 'object_type' } : undefined
    }
    case 'grants': {
      if (!ro || !CAPABILITY_FROM_GRANTS[provider]?.includes(ro.canonical.object_type)) return undefined
      const known = (inp.sameTarget?.() ?? []).filter((c): c is string[] => !!c)
      return known.length ? { caps: uniq(known.flat()), source: 'grants' } : undefined
    }
    case 'permission_prefixes': {
      // 사용자 정의 역할의 권한 이름 목록: 읽기 꼬리면 read_caps, 아니면 other_caps. 객체 종류는 맞는 접두사 줄 전부
      const spec = CAPABILITY_PREFIXES[provider]
      const raw = spec ? getPath(ro, spec.from) : undefined
      if (!spec || !Array.isArray(raw) || !raw.length) return undefined
      let caps: string[] = []
      const types = new Set<string>()
      for (const p of raw) {
        const n = typeof p === 'string' ? p : typeof p === 'object' && p ? String((p as Record<string, unknown>).label ?? (p as Record<string, unknown>).permission ?? '') : ''
        if (!n) continue
        caps = uniq([...caps, ...(n.endsWith(spec.read_suffix) ? spec.read_caps : spec.other_caps)])
        for (const row of spec.prefixes) if (n.startsWith(row.prefix)) row.applies_to.forEach(x => types.add(x))
      }
      return caps.length ? { caps, applies_to: [...types], source: 'permission_prefixes' } : undefined
    }
    case 'base_role': {
      const b = getPath(ro, CAPABILITY_BASE_ROLE.from)
      if (typeof b !== 'string') return undefined
      const row = (CAPABILITY_NAMES[CAPABILITY_BASE_ROLE.names] ?? []).find(r => new RegExp(r.match, r.ignore_case ? 'i' : '').test(b.trim().toLowerCase()))
      return row ? { caps: [...row.caps], source: 'base_role' } : undefined
    }
  }
  return undefined
}

/** 관계 행(has_role_on)의 역할 능력: 권한 키 목록, 역할 이름, 역할 객체, 같은 대상에 그 역할 객체가 받은 줄 */
export function relationRoleCaps(rel: ResolvedRelation, graph: GraphStoreV2, overrides?: EngineOverrides): Caps {
  const obj = (k: string | undefined) => (k ? graph.objectsByKey.get(k) : undefined)
  return roleCaps({
    provider: rel.provider, roleName: rel.roleName, roleKey: rel.roleKey, roleObject: obj(rel.roleKey), permissions: rel.properties.permissions, overrides,
    sameTarget: () => (rel.roleKey ? graph.outgoingRelationsByObject.get(rel.roleKey) ?? [] : [])
      .filter(g => g.relationType === 'has_role_on' && g.targetKey === rel.targetKey)
      .map(g => roleCaps({ provider: g.provider, roleName: g.roleName, roleKey: g.roleKey, roleObject: obj(g.roleKey), overrides }).caps),
  })
}

/** member_of 가 자원을 가리킬 때 그 소속의 능력 (MEMBERSHIP_CAPABILITIES) */
export function membershipCaps(provider: string | undefined, targetType: string | undefined): string[] {
  const row = MEMBERSHIP_CAPABILITIES.rows.find(r => r.provider === provider && r.target_type === targetType)
  return [...(row ? row.caps : MEMBERSHIP_CAPABILITIES.default)]
}

/** 배정 객체(Assignment) 하나의 능력: 역할 이름 칸(properties.role · type · role_name)과 역할 객체(references.role) */
export function assignmentCaps(o: FixtureObject, graph: GraphStoreV2, overrides?: EngineOverrides): Caps {
  const p = o.canonical.properties
  const roleRef = (o.canonical.references?.role?.targets ?? [])[0]
  const roleObject = roleRef ? graph.objectsByKey.get(String(roleRef.value)) : undefined
  for (const n of [p.role, p.type, p.role_name].filter((x): x is string => typeof x === 'string' && !!x)) {
    const c = roleCaps({ provider: o.canonical.provider, roleName: n, roleObject, overrides })
    if (c.caps) return c
  }
  return roleCaps({ provider: o.canonical.provider, roleObject, overrides })
}
