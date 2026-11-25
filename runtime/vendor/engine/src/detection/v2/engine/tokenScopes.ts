/**
 * 토큰 scope → 「무엇에 무엇을 할 수 있나」 (SaaS 공통 틀, 2026-11-10)
 *
 * aegi-knowledge schema/ontology/capabilities.yaml token_scopes 의 사본(generated.ts TOKEN_SCOPES)을 읽는다. scope 하나를 문법(grammar)으로
 * 자원 마디(무엇에)와 능력 마디(무엇을)로 가르고, 두 표로 객체 종류와 세기를 얻는다. 표에 없는 scope 는 모른다(0 으로 치지 않는다).
 * 쓰는 곳: 접근 규칙 실행기의 간선 홉 scopes_of(scripts/accessRules/executor.ts, 규칙 x_token_scoped).
 * Python 짝은 aegi-knowledge schema/ontology/__init__.py token_scope_reach() 다.
 */
import type { FixtureObject } from '../../../model/object'
import { TOKEN_SCOPE_FROM, TOKEN_SCOPES } from '../../../ontology/generated'

/** scope 하나가 닿는 것. objectTypes 가 비면 조직 설정 안의 것이라 조직에 걸린 역할로만 닿는다 */
export interface ScopeGrant { scope: string; resource: string; objectTypes: string[]; rank: number }

export interface ScopeReach {
  provider: string
  grants: ScopeGrant[]
  /** 자원에 닿지 않는 scope(로그인 신원, 자기 계정만, 벤더 내부 화면) */
  identity: string[]
  /** 표에 없어 무엇에 무엇을 하는지 모르는 scope */
  unmapped: string[]
  /** scope 를 쓰는 G 간선을 낸 관계의 도착 interface. 비면 모든 G 간선 */
  through: string[]
}

/** 토큰 객체의 scope 목록(TOKEN_SCOPE_FROM 의 처음 값이 있는 칸). 칸이 없으면 undefined */
export function scopesOf(obj: FixtureObject | undefined): string[] | undefined {
  for (const at of TOKEN_SCOPE_FROM) {
    const raw = at.split('.').reduce<any>((v, k) => (v == null ? undefined : v[k]), obj?.canonical)
    if (Array.isArray(raw)) return raw.map(String)
    if (typeof raw === 'string') return raw.split(/[\s,]+/).filter(Boolean)
  }
  return undefined
}

/** scope 목록을 표로 편다. 그 provider 표가 없으면 undefined(편 것이 아니다) */
export function scopeReach(provider: string, scopes: string[]): ScopeReach | undefined {
  const t = TOKEN_SCOPES[provider]
  if (!t) return undefined
  const grammar = new RegExp(t.grammar)
  const identity = t.identity ? new RegExp(t.identity) : undefined
  const out: ScopeReach = { provider, grants: [], identity: [], unmapped: [], through: [...(t.through ?? [])] }
  for (const scope of scopes) {
    if (identity?.test(scope)) {
      out.identity.push(scope)
      continue
    }
    const m = grammar.exec(scope)
    const res = m ? t.resources[m[1]] : undefined
    const ability = m?.[2]
    if (!m || !res || ability === undefined || !(ability in t.abilities)) {
      out.unmapped.push(scope)
      continue
    }
    out.grants.push({ scope, resource: m[1], objectTypes: [...res.object_types], rank: res.ranks?.[ability] ?? t.abilities[ability] })
  }
  return out
}

/**
 * 사람의 G 간선 하나를 토큰이 scope 로 쓸 수 있나. 도착이 조직(Tenant)이면 scope 가 덮는 자원 전부, 아니면 도착 종류를 덮는 scope 만.
 * 상위 범위에서 내려오는 역할이 닿는 종류를 좁혔으면(appliesTo) 그 안에서만. 세기는 사람 역할과 scope 가운데 작은 것(역할 세기를 모르면 scope 세기)
 */
export function scopeAllows(reach: ScopeReach, target: FixtureObject | undefined, edge: { rank?: number; appliesTo?: string[] }): { rank: number; scopes: string[]; objectTypes: string[] } | undefined {
  if (!target) return undefined
  const tenant = target.canonical.interfaces.includes('Tenant')
  const type = target.canonical.object_type.toLowerCase()
  const within = (types: string[]) => !edge.appliesTo?.length || types.some(x => edge.appliesTo!.includes(x.toLowerCase()))
  // 조직 설정 안의 것(objectTypes 빈 scope)은 종류를 좁히지 않은 조직 역할로만 닿는다
  const hits = reach.grants.filter(g => (tenant ? (g.objectTypes.length ? within(g.objectTypes) : !edge.appliesTo?.length) : g.objectTypes.some(x => x.toLowerCase() === type)))
  if (!hits.length) return undefined
  const best = Math.max(...hits.map(g => g.rank))
  return {
    rank: edge.rank === undefined ? best : Math.min(edge.rank, best),
    scopes: hits.map(g => g.scope),
    objectTypes: tenant ? [...new Set(hits.flatMap(g => g.objectTypes))] : [target.canonical.object_type],
  }
}
