/**
 * 카탈로그 및 Profile extract 의 값 식(expr)과 조건(cond)을 평가하는 공통 엔진.
 * 연산 목록은 닫혀 있다. 여기 없는 연산은 Profile 이 쓸 수 없다.
 */
import { to18 } from './sfid'

export type Expr = string | number | boolean | null | ExprObj
export interface ExprObj { [k: string]: any }
export type Cond = ExprObj

export interface Scope {
  r: any
  parent?: any
  req: Record<string, unknown>
  endpoint: string
  item?: any
  self?: string
  tenant?: string
  group?: any[]
  vars?: Record<string, unknown>
  ctx: Record<string, unknown>
  propOf?: (ref: any, prop: string, scope: Scope) => unknown
  index?: (name: string, key: unknown) => unknown
  has?: (ref: any, scope: Scope) => boolean
  objects?: (type: string, whereEq?: Record<string, unknown>, whereFalsy?: string[]) => Array<{ key: string; properties: Record<string, unknown> }>
  pageCount?: (source: any) => number
}

export const present = (v: unknown) => v !== undefined && v !== null && v !== ''

export function permissionName(p: any): string {
  const parts: string[] = []
  for (const scope of ['organization', 'repository', 'other']) {
    for (const [k, v] of Object.entries(p?.[scope] ?? {})) parts.push(`${k}:${v}`)
  }
  return parts.sort().join(',') || 'none'
}

export function getPath(obj: any, p: string): unknown {
  if (p === '.' || p === '') return obj
  let cur = obj
  for (const k of p.split('.')) {
    if (cur == null) return undefined
    cur = cur[k]
  }
  return cur
}

function contextValue(s: string, sc: Scope): unknown {
  const [head, ...rest] = s.slice(1).split('.')
  const tail = rest.join('.')
  const base: Record<string, unknown> = { req: sc.req, parent: sc.parent, item: sc.item, env: { endpoint: sc.endpoint }, self: sc.self, tenant: sc.tenant, ctx: sc.ctx, group: sc.group, vars: sc.vars }
  if (!(head in base)) throw new Error(`모르는 문맥 값 $${head}`)
  const v = base[head]
  return tail ? getPath(v, tail) : v
}

export function evalExpr(e: Expr | undefined, sc: Scope): unknown {
  if (e === undefined) return undefined
  if (typeof e === 'string') return e.startsWith('$') ? contextValue(e, sc) : getPath(sc.r, e)
  if (e === null || typeof e !== 'object') return e
  if ('const' in e) return e.const
  if ('any' in e) {
    for (const x of e.any as Expr[]) {
      const v = evalExpr(x, sc)
      if (present(v)) return v
    }
    return e.empty_as ?? undefined
  }
  if ('template' in e) return template(e.template, sc)
  if ('ref' in e && 'prop' in e) return sc.propOf?.(e.ref, e.prop, sc)
  if ('if' in e) return evalCond(e.if, sc) ? evalExpr(e.then, sc) : evalExpr(e.else, sc)
  if ('object' in e) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries<Expr>(e.object)) {
      const v = evalExpr(x, sc)
      if (v !== undefined) out[k] = v
    }
    return out
  }
  if ('list' in e) return (e.list as Expr[]).map(x => evalExpr(x, sc)).filter(v => v !== undefined)
  if ('op' in e) return op(e, sc)
  throw new Error(`식 모양을 모른다: ${JSON.stringify(e)}`)
}

export function template(t: string, sc: Scope): string {
  return t.replace(/\{([^{}]+)\}/g, (_, alts: string) => {
    for (const alt of alts.split('|')) {
      const a = alt.trim()
      const v = a.startsWith("'") && a.endsWith("'") ? a.slice(1, -1) : a.startsWith('@') ? sc.propOf?.({ name: a.slice(1).split('.')[0] }, a.slice(1).split('.').slice(1).join('.'), sc) : evalExpr(a, sc)
      if (present(v)) return String(v)
    }
    return ''
  })
}

const asList = (v: unknown): any[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])

function op(e: ExprObj, sc: Scope): unknown {
  const of = () => evalExpr(e.of, sc)
  switch (e.op) {
    case 'lower': { const v = of(); return present(v) ? String(v).toLowerCase() : v }
    case 'upper': { const v = of(); return present(v) ? String(v).toUpperCase() : v }
    case 'str': { const v = of(); return v === undefined || v === null ? v : String(v) }
    case 'nonempty': { const v = of(); return present(v) ? v : undefined }
    case 'null_if_missing': { const v = of(); return v === undefined ? null : v }
    case 'bool': return !!of()
    case 'not': return !of()
    case 'exists': return present(of())
    case 'eq': return of() === e.value
    case 'in': return (e.values as unknown[]).includes(of())
    case 'epoch_iso': { const v = of(); return typeof v === 'number' || (typeof v === 'string' && Number(v)) ? new Date(Number(v) * 1000).toISOString() : e.keep_other ? v : undefined }
    case 'url_host': case 'url_path': {
      try { const u = new URL(String(of())); return e.op === 'url_host' ? u.host : u.pathname } catch { return undefined }
    }
    case 'url_origin': { try { return new URL(String(of())).origin } catch { return undefined } }
    case 'url_param': { try { return new URL(String(of())).searchParams.get(e.name) ?? undefined } catch { return undefined } }
    case 'sqlite_iso': { const v = of(); if (typeof v !== 'string' || !v) return undefined; return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(' ', 'T')}Z` : v }
    case 'keys': { const v = of(); return v && typeof v === 'object' ? Object.keys(v).sort() : [] }
    case 'count': return asList(of()).length
    case 'flatten': return asList(of()).flatMap(asList)
    case 'concat': return (e.of as Expr[]).flatMap(x => asList(evalExpr(x, sc)))
    case 'uniq_sorted': return [...new Set(asList(of()))].sort()
    case 'uniq': return [...new Set(asList(of()))]
    case 'pluck': return asList(of()).map(x => getPath(x, e.field)).filter(v => (e.keep_empty ? true : present(v)))
    case 'map_each': return asList(of()).map(x => evalExpr(e.value, { ...sc, item: x, vars: e.as ? { ...sc.vars, [e.as]: x } : sc.vars }))
    case 'filter': { const s2 = { ...sc }; return asList(of()).filter(x => { s2.item = x; return evalCond(e.where, s2) }) }
    case 'find': { const s2 = { ...sc }; return asList(of()).find(x => { s2.item = x; return evalCond(e.where, s2) }) }
    case 'some': { const s2 = { ...sc }; return asList(of()).some(x => { s2.item = x; return evalCond(e.where, s2) }) }
    case 'first': return asList(of())[0]
    case 'last': { const l = asList(of()); return l[l.length - 1] }
    case 'sort_by': return [...asList(of())].sort((a, b) => cmp(evalExpr(e.by, { ...sc, item: a }), evalExpr(e.by, { ...sc, item: b })))
    case 'map': { const v = of(); const t = e.table as Record<string, unknown>; return v !== undefined && v !== null && String(v) in t ? t[String(v)] : evalExpr(e.default, sc) }
    case 'join': return asList(of()).join(e.sep ?? ',')
    case 'split': return present(of()) ? String(of()).split(e.sep).map((x: string) => (e.trim ? x.trim() : x)) : []
    case 'split_last': { const v = of(); return present(v) ? String(v).split(e.sep).pop() : undefined }
    case 'strip_prefix': { const v = of(); return typeof v === 'string' ? v.replace(new RegExp(`^${escapeRe(e.prefix)}`), '') : v }
    case 'replace': { const v = of(); return typeof v === 'string' ? v.replace(new RegExp(e.pattern, e.flags ?? ''), e.with) : v }
    case 'regex': { const v = of(); const m = typeof v === 'string' ? new RegExp(e.pattern).exec(v) : null; return m ? m[e.group ?? 1] : undefined }
    case 'slice': { const v = of(); return typeof v === 'string' ? v.slice(e.start ?? 0, e.end) : v }
    case 'omit_keys': { const v = of() as Record<string, unknown> | undefined; if (!v || typeof v !== 'object') return undefined; const drop = new Set(e.keys as string[]); return Object.fromEntries(Object.entries(v).filter(([k, x]) => !drop.has(k) && x !== undefined).sort(([a], [b]) => a.localeCompare(b))) }
    case 'entries_map': { const v = of() as Record<string, unknown> | undefined; return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, evalExpr(e.value, { ...sc, item: x })])) : undefined }
    case 'true_keys': { const v = of() as Record<string, unknown> | undefined; return v ? Object.entries(v).filter(([k, x]) => k.startsWith(e.prefix ?? '') && x === true).map(([k]) => k.slice((e.prefix ?? '').length)).sort() : [] }
    case 'prefix_fields': { const v = of() as Record<string, unknown> | undefined; return v ? Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith(e.from)).map(([k, x]) => [e.to + k.slice(e.from.length), x])) : {} }
    case 'index': return sc.index?.(e.name, evalExpr(e.key, sc))
    case 'objects': return sc.objects?.(e.type, e.where_eq ? Object.fromEntries(Object.entries(e.where_eq).map(([k, x]) => [k, evalExpr(x, sc)])) : undefined, e.where_falsy) ?? []
    case 'page_count': return sc.pageCount?.(e.source) ?? 0
    case 'has': return !!sc.has?.(e.ref, sc)
    // 목록을 key 식으로 묶어 객체로. mode: count(개수, 기본) | list(value 식 목록, 정렬·중복 제거) | first. 키는 정렬한다
    case 'group': {
      const out = new Map<string, any>()
      for (const x of asList(of())) {
        const s2 = { ...sc, item: x }
        const k = evalExpr(e.key, s2)
        if (!present(k)) continue
        const ks = String(k)
        if (e.mode === 'list') out.set(ks, [...(out.get(ks) ?? []), ...asList(e.value === undefined ? x : evalExpr(e.value, s2))])
        else if (e.mode === 'first') { if (!out.has(ks)) out.set(ks, e.value === undefined ? x : evalExpr(e.value, s2)) }
        else out.set(ks, (out.get(ks) ?? 0) + 1)
      }
      if (e.mode === 'list') for (const [k, v] of out) out.set(k, [...new Map(v.map((y: unknown) => [JSON.stringify(y), y])).values()].sort(cmp))
      return Object.fromEntries([...out.entries()].sort(([a], [b]) => a.localeCompare(b)))
    }
    case 'sum': return asList(of()).reduce((a: number, x: unknown) => a + Number(x ?? 0), 0)
    case 'max': { const l = asList(of()).filter(present); return l.length ? l.reduce((a, b) => (cmp(a, b) >= 0 ? a : b)) : undefined }
    case 'min': { const l = asList(of()).filter(present); return l.length ? l.reduce((a, b) => (cmp(a, b) <= 0 ? a : b)) : undefined }
    case 'glob_any': { const pats = asList(evalExpr(e.patterns, sc)).map(String); return asList(of()).filter(f => pats.some(p => globRe(p).test(String(f)))) }
    case 'github_permission_name': return permissionName(of())
    case 'sf_id18': { const v = of(); return typeof v === 'string' && v ? to18(v) : v }
    case 'okta_group_of_link': {
      const link = of() as any
      const href = (Array.isArray(link) ? link[0] : link)?.href
      const m = typeof href === 'string' ? /\/api\/v1\/groups\/([^/?#]+)$/.exec(href) : null
      return m?.[1]
    }
    default: throw new Error(`모르는 연산 ${e.op}`)
  }
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const na = Number(a), nb = Number(b)
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'boolean') return na - nb
  return String(a ?? '').localeCompare(String(b ?? ''))
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const globRe = (p: string) => new RegExp(`^${p.split('**').map(s => s.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`)

export function evalCond(c: Cond | undefined, sc: Scope): boolean {
  if (!c) return true
  if ('all' in c) return (c.all as Cond[]).every(x => evalCond(x, sc))
  if ('any' in c) return (c.any as Cond[]).some(x => evalCond(x, sc))
  if ('not' in c) return !evalCond(c.not, sc)
  if ('has' in c) return !!sc.has?.(c.has, sc)
  const v = evalExpr(c.path, sc)
  if ('eq' in c) return v === c.eq
  if ('ne' in c) return v !== c.ne
  if ('in' in c) return (c.in as unknown[]).includes(v)
  if ('not_in' in c) return !(c.not_in as unknown[]).includes(v)
  if ('present' in c) return c.present ? present(v) : !present(v)
  if ('defined' in c) return c.defined ? v !== undefined : v === undefined
  if ('truthy' in c) return c.truthy ? !!v : !v
  if ('matches' in c) return typeof v === 'string' && new RegExp(c.matches).test(v)
  if ('is_array' in c) return Array.isArray(v) === !!c.is_array
  if ('eq_expr' in c) return v === evalExpr(c.eq_expr, sc)
  if ('in_expr' in c) return asList(evalExpr(c.in_expr, sc)).includes(v)
  if ('contains' in c) return asList(v).includes(c.contains)
  if ('type' in c) return c.type === 'array' ? Array.isArray(v) : typeof v === c.type
  throw new Error(`조건 모양을 모른다: ${JSON.stringify(c)}`)
}
