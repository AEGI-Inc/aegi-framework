/**
 * SaaS 를 넘는 연결 — crosswalk.yaml 의 키 종류(kinds)와 칸 표시(fields)대로 잇는다.
 * aegi-knowledge schema/ontology/join.py 를 옮겼다. 데이터셋을 모르는 순수 함수이고, 결과를 데이터셋에 쓰는 것은 crosswalk.ts 다.
 *
 *   objects    {키: 객체}. match.ts MatchObject (identifiers 는 ids)
 *   relations  [{rt, s, d, props}]. 끝 찾기(places)와 exists_relation 이 쓴다. 여기서 만든 관계도 뒤 종류의 식에 보인다
 *   records    {출처: [기록 행]}. co_occurs 종류가 쓴다. 없는 출처는 「못 이은 이유」에 적는다
 *   resolvers  relation_semantics.yaml 의 resolvers (places 가 이름으로 부를 때)
 *   materials  {키: 객체}. Object 가 아닌 Link 재료(오브젝트 모델 v1 의 link_only). link_material 칸 표시만 여기서도 찾는다
 *
 * 반환 {relations, links, unjoined, shadowed}
 *   unjoined 의 why — empty 가리키는 칸이 비었다 · no_target 가리키는 값의 상대가 없다 · no_record 기록 출처를 못 읽었다 ·
 *   no_material Link 재료가 없다 · where 값은 맞는데 조건(skip_if · where)에 걸렸다
 *   shadowed  같은 허브 계정 · 같은 provider 를 앞 종류가 이미 이어서 안 쓴 것 (link_one_per_provider)
 */
import { holds, MatchCtx, resolve, type Expr, type MatchObject, type MatchRelation } from './match'

/** Link 단계의 세기 — 앞일수록 세다 (identity.yaml link_levels 에서 different 를 뺀 순서). level_cap 이 쓴다 */
export const STRENGTH = ['disclosed_relation', 'resolved', 'possibly_same', 'possibly_related'] as const

export interface CrosswalkField {
  kind: string
  side: 'a' | 'b' | 'record'
  provider?: string
  object_type?: string
  path?: string
  end?: string
  to?: { provider: string; object_type: string | string[] }
  pointer?: boolean
  /** This entry must identify at most one distinct opposite endpoint. */
  unique_match?: boolean
  /** email_address: 이메일 칸. 두 끝이 다 이 칸이면 같은 주소는 같은 사람(Crosswalk.email_match) */
  transform?: Array<string | { strip_suffix: string } | { require_suffix: string } | { map: Record<string, string> } | { path_segment_after: string }>
  where?: Expr
  records?: Record<string, string>
  link_material?: boolean
  level_cap?: string
  cap_unless_same?: { a: string; b: string }
  source?: string
  a?: string
  b?: string
}

export interface CrosswalkKind {
  method?: string
  a: string[]
  b: string[]
  same: 'exact' | 'casefold' | 'co_occurs'
  evidence: 'stated' | 'observed'
  /** 근거 세기 — groundtruth/connection-rules/legend.yaml tier 이름 (crosswalk.yaml 칸 설명) */
  tier: string
  makes: { relation: string; from: 'a' | 'b'; to: 'a' | 'b' } | { link: Array<{ level: string; when?: Expr }>; link_kind?: string }
  places?: Record<string, Record<string, any>>
  where?: Expr
  target_missing: 'report' | 'ignore'
}

/**
 * 같은 사람 Link 가 시작하는 계정 종류 (crosswalk.yaml hubs, 2026-11-13). 앞일수록 먼저다. name 은 Link 이름으로 쓰는 칸.
 * role address(2026-11-14)는 계정이 아니라 주소 하나가 기준점인 맨 아래 허브다 — provider · object_type 없이 kind 의 이메일 칸을 본다
 */
export interface CrosswalkHub {
  provider?: string
  object_type?: string
  role?: string
  name?: string
  kind?: string
}

export interface Crosswalk {
  skip_if?: Expr
  link_one_per_provider?: boolean
  hubs?: CrosswalkHub[]
  relation_marks?: Record<string, unknown>
  /** 같은 이메일이면 같은 사람 (aegi-knowledge crosswalk.yaml email_match, decided.email_same_person 2026-11-03) */
  email_match?: {
    level?: string
    shared_mailbox?: { local_parts?: string[]; same_provider?: boolean }
    /** 같은 조직이 DNS 로 확인한 도메인 별칭 (2026-11-08). kinds 의 이메일 칸끼리 앞부분이 같고 도메인이 같은 묶음이면 잇는다 */
    domain_alias?: { kinds?: string[]; domains?: CrosswalkField[]; level?: string }
  }
  kinds: Record<string, CrosswalkKind>
  fields: CrosswalkField[]
}

export interface Entry {
  value: string
  /** 고치기(transform · casefold) 전 값 — 못 이은 이유를 사람에게 보일 때 쓴다 */
  raw: string
  end: string
  holder: string
  field: CrosswalkField
}
export interface JoinRelation extends MatchRelation {
  kind: string
  /** 이 관계를 만든 두 칸 (a 쪽, b 쪽) */
  via: [Entry, Entry]
}
export interface JoinLink {
  a: string
  b: string
  level: string
  kind: string
  /** 근거 세기 (키 종류의 tier) */
  tier: string
  records: Record<string, unknown>
  link_kind?: string
  capped: boolean
  /** 공용으로 보이는 주소로 이었다(앞부분이 공용 메일함 이름이거나 한 SaaS 안 여러 계정이 같은 주소). 판정은 그대로다 */
  shared_mailbox_suspected?: boolean
  /** 도메인 별칭으로 이었다(email_match.domain_alias). 양 끝 주소의 도메인 */
  domain_alias?: { a: string; b: string }
  /** 주소 허브가 이었다 — 디렉터리 확인 없이 같은 주소라서 (groupPeople) */
  address_hub?: true
  via: [Entry, Entry]
}
export interface Unjoined {
  kind: string
  why: 'empty' | 'no_target' | 'no_record' | 'no_material' | 'where' | 'ambiguous'
  holder: string | null
  value: string | null
  raw?: string
}
/**
 * 주소 허브의 묶음 하나 — 정규화한 주소 하나와 그 주소를 쓰는 계정들(SaaS 둘 이상). kind 의 이메일 칸(end 없음)만 본다.
 * level 은 email_match.level(같은 주소), suspect 는 공용으로 보이는 주소(앞부분이 공용 메일함 이름이거나 한 SaaS 안 여러 계정)
 */
export interface AddressGroup {
  value: string
  kind: string
  tier: string
  level: string
  /** 별칭 도메인 주소끼리(같은 주소가 아닌 두 계정)의 단계 — email_match.domain_alias.level. 별칭을 안 보면 없다 */
  alias_level?: string
  suspect: boolean
  members: Array<{ entry: Entry; records: Record<string, unknown> }>
}
export interface JoinResult {
  relations: JoinRelation[]
  links: JoinLink[]
  unjoined: Unjoined[]
  shadowed: Array<{ kind: string; a: string; b: string }>
  /** 주소 허브(hubs 의 role address)가 있을 때만 */
  addresses?: AddressGroup[]
}

const scalar = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as object) ? (v as { value: unknown }).value : v)

/** Nested object paths and explicit [] traversal. Existing literal dotted keys take precedence. */
export function get(obj: MatchObject, path: string): unknown {
  const dot = path.indexOf('.')
  const where = path.slice(0, dot)
  const box = where === 'properties' ? obj.props : where === 'identifiers' ? obj.ids : undefined
  if (where !== 'properties' && where !== 'identifiers') throw new Error(`모르는 칸 ${path}`)
  const walk = (container: unknown, rest: string): unknown => {
    if (!container || typeof container !== 'object' || Array.isArray(container)) return undefined
    const row = container as Record<string, unknown>
    if (Object.hasOwn(row, rest)) return scalar(row[rest])
    const split = rest.indexOf('.')
    const head = split < 0 ? rest : rest.slice(0, split), tail = split < 0 ? '' : rest.slice(split + 1)
    if (head.endsWith('[]')) {
      const value = Object.hasOwn(row, head.slice(0, -2)) ? scalar(row[head.slice(0, -2)]) : undefined
      if (!Array.isArray(value)) return null
      if (!tail) return value
      return value.filter(v => v && typeof v === 'object' && !Array.isArray(v)).flatMap(v => {
        const result = walk(v, tail); return Array.isArray(result) ? result : [result]
      })
    }
    return tail && Object.hasOwn(row, head) ? walk(row[head], tail) : undefined
  }
  return walk(box ?? {}, path.slice(dot + 1))
}

function getRecord(row: unknown, path: string): unknown {
  let v: any = row
  for (const part of path.split('.')) v = v && typeof v === 'object' ? v[part] : undefined
  return v
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
/** 가린 값(마스킹)에 흔한 글자와 자리표시 값의 앞부분. 같아도 같은 사람이라는 근거가 아니다 (join.py 와 같은 목록) */
const EMAIL_MASK = ['*', '\u2022', '\u2026', '\u2588']
const EMAIL_PLACEHOLDER = new Set(['unknown', 'none', 'null', 'nil', 'undefined', 'n/a', 'na', 'redacted', 'hidden', 'masked', 'private',
  'noemail', 'no-email', 'placeholder', 'dummy', 'changeme'])

/** 이메일 칸 값 → 비교할 주소. 앞뒤 공백을 빼고, 이메일 모양이 아니거나 가렸거나 자리표시 값이면 빈 값(일치로 보지 않는다) */
export function emailAddress(raw: string): string {
  const v = raw.trim()
  if (!EMAIL_SHAPE.test(v) || EMAIL_MASK.some(c => v.includes(c)) || v.toLowerCase().includes('redacted')) return ''
  return EMAIL_PLACEHOLDER.has(v.split('@')[0].toLowerCase()) ? '' : v
}

/** 주소 앞부분(+ 뒤를 뺀)이 공용 메일함 이름이면 true */
function sharedLocal(value: string, localParts: Set<string>): boolean {
  return localParts.has(value.split('@')[0].split('+')[0].toLowerCase())
}

export function normalize(value: unknown, transform: CrosswalkField['transform'], same: string): string | null {
  if (value === undefined || value === null || value === '') return null
  let v = String(value)
  for (const t of transform ?? []) {
    if (typeof t === 'object' && 'strip_suffix' in t) v = v.toLowerCase().endsWith(t.strip_suffix.toLowerCase()) ? v.slice(0, v.length - t.strip_suffix.length) : v
    // 표에 있는 값만 그 짝 이름으로, 없으면 빈 값
    else if (typeof t === 'object' && 'map' in t) v = Object.hasOwn(t.map, v) ? String(t.map[v]) : ''
    // 끝이 그 글자면 떼고, 아니면 빈 값(그 칸이 이 종류의 값이 아니다)
    else if (typeof t === 'object' && 'require_suffix' in t) v = v.toLowerCase().endsWith(t.require_suffix.toLowerCase()) ? v.slice(0, v.length - t.require_suffix.length) : ''
    else if (t === 'email_domain') v = v.includes('@') ? v.split('@')[1] : ''
    else if (t === 'email_address') v = emailAddress(v)
    else if (t === 'url_host') {
      // 절대 주소의 호스트 이름(소문자, 포트 뺌). 스킴이 없는 값은 빈 값
      try { v = new URL(v).hostname } catch { v = '' }
    }
    else if (typeof t === 'object' && 'path_segment_after' in t) {
      // 주소 경로를 / 로 나눠 그 글자인 첫 조각의 바로 다음 조각. 없으면 빈 값
      const parts = v.split('/')
      const i = parts.indexOf(t.path_segment_after)
      v = i >= 0 && i + 1 < parts.length ? parts[i + 1] : ''
    }
    else throw new Error(`모르는 transform ${JSON.stringify(t)}`)
  }
  if (same === 'casefold') v = v.trim().toLowerCase()
  return v || null
}

function fits(obj: MatchObject, to: CrosswalkField['to']): boolean {
  if (!to) return true
  const want = Array.isArray(to.object_type) ? to.object_type : [to.object_type]
  return obj.p === to.provider && want.includes(obj.t)
}

function ends(obj: MatchObject, end: string | undefined, objects: Record<string, MatchObject>): string[] {
  if (!end) return [obj.k]
  const name = end.split('.').slice(1).join('.')
  return (obj.refs?.[name] ?? []).filter(k => objects[k])
}

function entries(
  fields: CrosswalkField[], kind: string, side: 'a' | 'b', same: string, objects: Record<string, MatchObject>, relations: MatchRelation[],
  skipIf: Expr | undefined, materials: Record<string, MatchObject>,
): { out: Entry[]; misses: Unjoined[] } {
  const out: Entry[] = []
  const misses: Unjoined[] = []
  const all = Object.values(objects)
  for (const f of fields) {
    if (f.kind !== kind || f.side !== side) continue
    let holders = all.filter(o => o.p === f.provider && o.t === f.object_type)
    if (f.link_material) {
      holders = [...holders, ...Object.values(materials).filter(o => o.p === f.provider && o.t === f.object_type && !objects[o.k])]
      if (!holders.length) {
        misses.push({ kind, why: 'no_material', holder: null, value: `${f.provider} ${f.object_type}` })
        continue
      }
    }
    for (const o of holders) {
      // skip_if 는 "어느 쪽이든" 이라, 값을 가진 객체 하나를 양쪽에 두고 대 봐서 걸리면 아예 안 본다 (껍데기 등)
      if (skipIf && holds(skipIf, new MatchCtx({ a: o, b: o }, relations))) continue
      if (f.where) {
        const parent = (o.refs?.parent ?? []).filter(k => objects[k]).map(k => objects[k])
        if (!holds(f.where, new MatchCtx({ self: o, parent }, relations))) continue
      }
      const raw = get(o, f.path!)
      const vals = (Array.isArray(raw) ? raw : [raw]).map(v => ({ raw: String(v), value: normalize(v, f.transform, same) })).filter((v): v is { raw: string; value: string } => !!v.value)
      if (!vals.length) {
        // 가리키는 칸(pointer)이 빈 것만 적는다. 상대를 가리키지 않는 칸이 빈 것은 이을 거리가 없는 것이다
        if (f.pointer) misses.push({ kind, why: 'empty', holder: o.k, value: null })
        continue
      }
      for (const v of vals) for (const e of ends(o, f.end, objects)) out.push({ value: v.value, raw: v.raw, end: e, holder: o.k, field: f })
    }
  }
  return { out, misses }
}

/**
 * 도메인 -> 별칭 묶음 대표 (crosswalk.yaml email_match.domain_alias, join.py domain_groups 와 같다). domains 칸 값을 그 객체의
 * end(조직, 고객) 단위로 모으고, 같은 end 의 도메인끼리, 겹치는 도메인으로 이어지는 묶음끼리 합친다. 값은 소문자로 비교한다
 */
export function domainGroups(alias: NonNullable<Crosswalk['email_match']>['domain_alias'], objects: Record<string, MatchObject>, relations: MatchRelation[]): Map<string, string> {
  const parent = new Map<string, string>()
  const find = (d: string): string => {
    if (!parent.has(d)) parent.set(d, d)
    let x = d
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!)
      x = parent.get(x)!
    }
    return x
  }
  const byEnd = new Map<string, Set<string>>()
  for (const f of alias?.domains ?? []) {
    for (const o of Object.values(objects)) {
      if (o.p !== f.provider || o.t !== f.object_type) continue
      if (f.where && !holds(f.where, new MatchCtx({ self: o, parent: [] }, relations))) continue
      const raw = get(o, f.path!)
      for (const v of Array.isArray(raw) ? raw : [raw]) {
        if (typeof v !== 'string' || !v.trim()) continue
        for (const e of ends(o, f.end, objects)) (byEnd.get(e) ?? byEnd.set(e, new Set()).get(e)!).add(v.trim().toLowerCase())
      }
    }
  }
  for (const set of byEnd.values()) {
    const doms = [...set].sort()
    for (const d of doms) parent.set(find(d), find(doms[0]))
  }
  return new Map([...parent.keys()].map(d => [d, find(d)]))
}

export function runJoin(
  cw: Crosswalk, objects: Record<string, MatchObject>, relations: MatchRelation[],
  records: Record<string, unknown[]> = {}, resolvers: Record<string, Record<string, any>> = {}, materials: Record<string, MatchObject> = {},
): JoinResult {
  const fields = cw.fields ?? []
  const marks = cw.relation_marks ?? {}
  const emailFloor = cw.email_match?.level
  const shared = cw.email_match?.shared_mailbox ?? {}
  const sharedLocals = new Set((shared.local_parts ?? []).map(x => String(x).toLowerCase()))
  const isEmail = (e: Entry) => (e.field.transform ?? []).includes('email_address')
  const alias = cw.email_match?.domain_alias
  const aliasKinds = new Set(alias?.kinds ?? [])
  const rels: MatchRelation[] = [...relations]
  const relFrom = new Map<string, MatchRelation[]>()
  const addFrom = (r: MatchRelation) => (relFrom.get(r.s) ?? relFrom.set(r.s, []).get(r.s)!).push(r)
  rels.forEach(addFrom)
  const result: JoinResult = { relations: [], links: [], unjoined: [], shadowed: [] }
  const linked = new Map<string, string>() // 허브 계정|상대 provider -> 먼저 이은 키 종류
  const group = aliasKinds.size ? domainGroups(alias, objects, rels) : new Map<string, string>()

  for (const [name, kind] of Object.entries(cw.kinds ?? {})) {
    const same = kind.same
    const { out: A, misses: missA } = entries(fields, name, 'a', same, objects, rels, cw.skip_if, materials)
    const { out: B, misses: missB } = entries(fields, name, 'b', same, objects, rels, cw.skip_if, materials)
    const pairs: Array<[string, string, Entry, Entry]> = []
    const aliased = new Set<string>() // 도메인 별칭으로 맞은 두 항목 (a 항목, b 항목)
    const entryId = new Map<Entry, number>()
    const pairId = (x: Entry, y: Entry) => `${entryId.get(x) ?? entryId.set(x, entryId.size).get(x)}|${entryId.get(y) ?? entryId.set(y, entryId.size).get(y)}`
    if (same === 'co_occurs') {
      result.unjoined.push(...[...missA, ...missB].filter(m => m.why === 'no_material'))
      for (const f of fields) {
        if (f.kind !== name || f.side !== 'record') continue
        if (!(f.source! in records)) {
          result.unjoined.push({ kind: name, why: 'no_record', holder: null, value: f.source! })
          continue
        }
        for (const row of records[f.source!]) {
          const va = normalize(getRecord(row, f.a!), undefined, 'exact')
          const vb = normalize(getRecord(row, f.b!), undefined, 'exact')
          for (const x of A) if (x.value === va) for (const y of B) if (y.value === vb) pairs.push([x.end, y.end, x, y])
        }
      }
    } else {
      result.unjoined.push(...missA, ...missB)
      const bBy = new Map<string, Entry[]>()
      for (const y of B) (bBy.get(y.value) ?? bBy.set(y.value, []).get(y.value)!).push(y)
      const hitB = new Set<Entry>()
      for (const x of A) {
        const found = (bBy.get(x.value) ?? []).filter(y => fits(objects[y.end], x.field.to) && fits(objects[x.end], y.field.to))
        for (const y of found) {
          hitB.add(y)
          pairs.push([x.end, y.end, x, y])
        }
        if (!found.length && x.field.pointer && kind.target_missing === 'report') result.unjoined.push({ kind: name, why: 'no_target', holder: x.holder, value: x.value, raw: x.raw })
      }
      for (const y of B) if (!hitB.has(y) && y.field.pointer && kind.target_missing === 'report') result.unjoined.push({ kind: name, why: 'no_target', holder: y.holder, value: y.value, raw: y.raw })
      // 도메인 별칭(email_match.domain_alias): 이메일 칸끼리 앞부분이 같고 도메인이 다르지만 같은 별칭 묶음이면 잇는다
      if (aliasKinds.has(name) && group.size) {
        const aliasKey = (e: Entry): string | null => {
          const at = e.value.lastIndexOf('@')
          const local = e.value.slice(0, at), dom = e.value.slice(at + 1)
          return isEmail(e) && at > 0 && group.has(dom) ? `${local}\u0000${group.get(dom)}` : null
        }
        const bAlias = new Map<string, Entry[]>()
        for (const y of B) { const k = aliasKey(y); if (k) (bAlias.get(k) ?? bAlias.set(k, []).get(k)!).push(y) }
        for (const x of A) {
          const k = aliasKey(x)
          if (!k) continue
          for (const y of bAlias.get(k) ?? []) {
            if (y.value === x.value || !fits(objects[y.end], x.field.to) || !fits(objects[x.end], y.field.to)) continue
            pairs.push([x.end, y.end, x, y])
            aliased.add(pairId(x, y))
          }
        }
      }
    }

    // Opt-in uniqueness is per holder/value and opposite endpoint, not per row:
    // duplicate fields/pages must not make a real receiver ambiguous.
    const opposites = new Map<string, Set<string>>()
    const uniqueKey = (e: Entry) => JSON.stringify([e.holder, e.value])
    for (const [a,b,x,y] of pairs) for (const [entry,opposite] of [[x,b],[y,a]] as const) {
      if (!entry.field.unique_match) continue
      const key=uniqueKey(entry)
      if (!opposites.has(key)) opposites.set(key,new Set())
      opposites.get(key)!.add(opposite)
    }
    const ambiguous = new Set<string>()
    const seen = new Set<string>()
    const m = kind.makes
    // (provider, 주소) -> 그 주소를 가진 계정. 한 SaaS 안 여러 계정이면 공용으로 본다 (join.py 와 같다)
    const sameProvider = new Map<string, Set<string>>()
    for (const e of [...A, ...B]) {
      if (!isEmail(e)) continue
      const k = `${objects[e.end]?.p}\u0000${e.value}`
      ;(sameProvider.get(k) ?? sameProvider.set(k, new Set()).get(k)!).add(e.end)
    }
    // 같은 두 끝을 여러 칸이 이으면 단계를 낮추지 않는 칸(level_cap 없음)을 먼저 쓴다 — 주 이메일이 별칭보다 먼저다
    const capped = (p: [string, string, Entry, Entry]) => (p[2].field.level_cap || p[3].field.level_cap ? 1 : 0)
    pairs.sort((p, q) => capped(p) - capped(q))
    for (const [a, b, x, y] of pairs) {
      const unclear=[x,y].find(e=>e.field.unique_match && (opposites.get(uniqueKey(e))?.size ?? 0)>1)
      if(unclear){
        const key=uniqueKey(unclear)
        if(!ambiguous.has(key)){result.unjoined.push({kind:name,why:'ambiguous',holder:unclear.holder,value:unclear.value});ambiguous.add(key)}
        continue
      }
      if (seen.has(`${a}\u0000${b}`) || a === b) continue
      seen.add(`${a}\u0000${b}`)
      const places: Record<string, MatchObject | MatchObject[] | undefined> = { a: objects[a], b: objects[b] }
      for (const [n, spec] of Object.entries(kind.places ?? {})) {
        const found = 'resolver' in spec ? resolvers[spec.resolver] : Object.fromEntries(Object.entries(spec).filter(([k]) => k !== 'from'))
        places[n] = resolve(found, spec.from === 'a' ? a : b, objects, relFrom).map(k => objects[k])
      }
      // join.py 와 같이 objects 없이 대 본다 — exists_relation.target_interface 는 여기서 늘 거짓이다 (match.py Ctx 설명)
      const ctx = new MatchCtx(places, rels)
      if ((cw.skip_if && holds(cw.skip_if, ctx)) || (kind.where && !holds(kind.where, ctx))) {
        result.unjoined.push({ kind: name, why: 'where', holder: x.holder, value: x.value })
        continue
      }
      if ('relation' in m) {
        const [s, d] = m.from === 'a' ? [a, b] : [b, a]
        const props: Record<string, unknown> = { basis: kind.evidence, tier: kind.tier, ...(objects[s].p !== objects[d].p ? marks : {}) }
        const row: JoinRelation = { rt: m.relation, s, d, props, kind: name, via: [x, y] }
        result.relations.push(row)
        rels.push(row)
        addFrom(row)
        continue
      }
      const key = `${a}|${objects[b].p}`
      if (cw.link_one_per_provider && (linked.get(key) ?? name) !== name) {
        result.shadowed.push({ kind: name, a, b })
        continue
      }
      linked.set(key, name)
      let level = m.link.find(st => !st.when || holds(st.when, ctx))?.level ?? null
      let cap = x.field.level_cap ?? y.field.level_cap
      const lift = x.field.cap_unless_same ?? y.field.cap_unless_same
      if (cap && lift?.a && lift?.b) {
        let va: string | null = null
        let vb: string | null = null
        try {
          va = normalize(get(objects[a], lift.a), undefined, same)
          vb = normalize(get(objects[b], lift.b), undefined, same)
        } catch { /* 모양이 틀린 칸은 aegi-knowledge S9 가 잡는다 */ }
        if (va && va === vb) cap = undefined // 다른 칸 하나가 더 맞았다 — cap 을 풀어 준다
      }
      const rank = (l: string | null | undefined) => STRENGTH.indexOf((l ?? '') as (typeof STRENGTH)[number])
      if (cap && rank(cap) >= 0 && rank(level) >= 0 && rank(level) < rank(cap)) level = cap
      // 같은 이메일이면 같은 사람(email_match, 2026-11-03): 두 끝 칸이 다 이메일 칸이면 적어도 email_match.level
      const email = isEmail(x) && isEmail(y)
      const byAlias = aliased.has(pairId(x, y)) // 같은 주소가 아니라 별칭 도메인 주소다. email_match.level 로 올리지 않는다
      if (email && !byAlias && emailFloor && rank(emailFloor) >= 0 && rank(level) > rank(emailFloor)) level = emailFloor
      // 별칭 도메인 주소는 domain_alias.level 까지 올린다(2026-11-14). 없으면 그 종류의 makes 단계 그대로
      if (email && byAlias && alias?.level && rank(alias.level) >= 0 && rank(level) > rank(alias.level)) level = alias.level
      const suspect = email && (sharedLocal(x.value, sharedLocals)
        || (!!shared.same_provider && [[a, x.value], [b, y.value]].some(([k, v]) => (sameProvider.get(`${objects[k]?.p}\u0000${v}`)?.size ?? 0) > 1)))
      const records: Record<string, unknown> = {}
      for (const [f, holder] of [[x.field, x.holder], [y.field, y.holder]] as const) {
        for (const [rn, path] of Object.entries(f.records ?? {})) records[rn] = get(objects[holder] ?? materials[holder], path) ?? null
      }
      result.links.push({ a, b, level: level!, kind: name, tier: kind.tier, records, link_kind: m.link_kind, capped: !!cap && level === cap, ...(suspect ? { shared_mailbox_suspected: true } : {}),
        ...(byAlias ? { domain_alias: { a: x.value.slice(x.value.lastIndexOf('@') + 1), b: y.value.slice(y.value.lastIndexOf('@') + 1) } } : {}), via: [x, y] })
    }
  }
  const addressHub = (cw.hubs ?? []).find(h => h.role === 'address')
  if (addressHub?.kind && cw.kinds?.[addressHub.kind]) result.addresses = addressGroups(cw, addressHub.kind, objects, rels, materials)
  return result
}

/**
 * 주소 허브의 묶음 (crosswalk.yaml hubs role address, Link_Schema_v3 「주소 허브」). kind 의 이메일 칸 가운데 end 가 없는 칸(그 계정 자신의
 * 주소)을 양쪽(a · b) 다 읽어 정규화한 주소마다 계정을 모은다. 칸 표시 where · skip_if 와 kind 의 where(봇 거름)를 그 계정 하나에 대 본다.
 * SaaS 둘 이상이 쓰는 주소만 남긴다. 다른 키와 섞지 않는다 — 묶음은 그 주소를 쓰는 계정을 넘지 않는다
 */
function addressGroups(cw: Crosswalk, kindName: string, objects: Record<string, MatchObject>, rels: MatchRelation[], materials: Record<string, MatchObject>): AddressGroup[] {
  const kind = cw.kinds[kindName]
  const own = (cw.fields ?? []).filter(f => f.kind === kindName && !f.end && (f.transform ?? []).includes('email_address'))
  const shared = cw.email_match?.shared_mailbox ?? {}
  const sharedLocals = new Set((shared.local_parts ?? []).map(x => String(x).toLowerCase()))
  // 도메인 별칭(email_match.domain_alias, kinds 에 이 종류가 있을 때): 같은 조직이 DNS 로 확인한 도메인 묶음은 한 주소 공간이다.
  // 앞부분과 별칭 묶음 대표 도메인이 같으면 같은 주소로 본다. 다른 키나 다른 앞부분과는 여전히 잇지 않는다
  const alias = cw.email_match?.domain_alias
  const group = alias?.kinds?.includes(kindName) ? domainGroups(alias, objects, rels) : new Map<string, string>()
  const keyOf = (v: string) => {
    const at = v.lastIndexOf('@')
    const dom = v.slice(at + 1)
    return at > 0 && group.has(dom) ? `${v.slice(0, at)}@${group.get(dom)}` : v
  }
  const by = new Map<string, Map<string, Entry>>() // 주소 -> 계정 -> 처음 맞은 칸
  for (const side of ['a', 'b'] as const) {
    const { out } = entries(own, kindName, side, kind.same, objects, rels, cw.skip_if, materials)
    for (const e of out) {
      const o = objects[e.end]
      if (!o || (kind.where && !holds(kind.where, new MatchCtx({ a: o, b: o }, rels)))) continue
      const key = keyOf(e.value)
      const row = by.get(key) ?? by.set(key, new Map()).get(key)!
      if (!row.has(e.end)) row.set(e.end, e)
    }
  }
  const out: AddressGroup[] = []
  for (const value of [...by.keys()].sort()) {
    const row = by.get(value)!
    const providers = [...row.keys()].map(k => objects[k].p)
    if (new Set(providers).size < 2) continue
    const suspect = sharedLocal(value, sharedLocals) || (!!shared.same_provider && providers.length > new Set(providers).size)
    const members = [...row.keys()].sort().map(k => {
      const entry = row.get(k)!
      const records: Record<string, unknown> = {}
      for (const [rn, p] of Object.entries(entry.field.records ?? {})) records[rn] = get(objects[entry.holder], p) ?? null
      return { entry, records }
    })
    const level = cw.email_match?.level ?? ('link' in kind.makes ? kind.makes.link[0].level : 'possibly_same')
    const aliasLevel = group.size ? (alias?.level ?? ('link' in kind.makes ? kind.makes.link[0].level : 'possibly_same')) : undefined
    out.push({ value, kind: kindName, tier: kind.tier, level, ...(aliasLevel ? { alias_level: aliasLevel } : {}), suspect, members })
  }
  return out
}

/**
 * 같은 사람 하나: 허브 계정, 허브 순위(hubs 의 자리), 그 사람 Link 에 드는 연결 (위 허브 것 먼저, 합친 아래 허브 것 뒤).
 * 주소 허브 사람은 address 가 그 주소이고 hub 는 그 주소를 쓰는 계정 가운데 첫 계정(간선의 a)이다
 */
export interface PersonGroup { hub: string; rank: number; links: JoinLink[]; address?: string }
/**
 * 연결 충돌 — 아래 허브가 이은 것을 합치지 않은 까닭.
 *   account_claimed  그 계정이 이미 위 허브의 다른 사람 Link 에 있다
 *   provider_taken   합친 사람이 그 SaaS 계정을 위 허브로 이미 가졌는데 다른 계정이다 (link_one_per_provider)
 *   hub_claimed      아래 허브 계정 하나를 위 허브의 사람 둘 이상이 이었다
 */
export interface HubConflict { why: 'account_claimed' | 'provider_taken' | 'hub_claimed'; hub: string; account: string; people: string[] }

/**
 * 허브가 여럿일 때 같은 사람 Link 를 묶는다 (crosswalk.yaml hubs, Link_Schema_v3 「허브가 둘일 때」). links 는 runJoin 의 사람 연결(a 가 허브 계정).
 * hubs 순서대로 본다. 아래 허브 계정을 위 허브 사람이 이었으면 그 사람에 합치고, 아무도 안 이었으면 그 계정에서 새 사람을 만든다.
 * 합치는 연결은 그 사람이 아직 없는 SaaS 계정만 더한다. 위 허브가 이미 이은 계정이면 조용히 건너뛰고(shadowed), 다른 계정이거나
 * 그 계정이 더 위 허브의 다른 사람에 있으면 「연결 충돌」로 남긴다. 맨 위 허브끼리는 지금과 같다(같은 계정이 두 사람에 들 수 있다).
 * hubs 에 없는 계정 종류가 a 면 맨 아래 순위다. SaaS 이름을 보지 않는다 — 순서와 종류는 표가 정한다
 */
export function groupPeople(links: JoinLink[], hubs: CrosswalkHub[], objects: Record<string, Pick<MatchObject, 'p' | 't'> | undefined>, nameOf: (k: string) => string = k => k, addresses: AddressGroup[] = []): { people: PersonGroup[]; conflicts: HubConflict[]; shadowed: number } {
  const rankOf = (k: string) => { const o = objects[k]; const i = hubs.findIndex(h => h.role !== 'address' && h.provider === o?.p && h.object_type === o?.t); return i < 0 ? hubs.length : i }
  const providerOf = (k: string) => objects[k]?.p ?? '?'
  const byHub = new Map<string, JoinLink[]>()
  for (const l of links) (byHub.get(l.a) ?? byHub.set(l.a, []).get(l.a)!).push(l)
  const order = [...byHub.keys()].sort((p, q) => rankOf(p) - rankOf(q) || nameOf(p).localeCompare(nameOf(q)))
  const people: PersonGroup[] = []
  const conflicts: HubConflict[] = []
  let shadowed = 0
  // 계정 -> 그 계정을 가진 사람들 (허브 계정 자신 포함)
  const holders = new Map<string, PersonGroup[]>()
  const hold = (k: string, p: PersonGroup) => { const xs = holders.get(k) ?? holders.set(k, []).get(k)!; if (!xs.includes(p)) xs.push(p) }
  const accountsOf = (p: PersonGroup) => [p.hub, ...p.links.map(l => l.b)]
  // 한 순위 안에서는 위 허브 사람에 합칠 계정을 먼저, 새 사람을 뒤에 본다 — 합친 사람이 가진 계정을 새 사람이 가져가지 않게
  const aboveOf = (hub: string) => (holders.get(hub) ?? []).filter(p => p.rank < rankOf(hub))
  const ranks = [...new Set(order.map(rankOf))]
  // 순위마다 그 앞 순위를 다 본 뒤에 나눈다 (holders 가 앞 순위 사람으로 채워진 다음)
  const staged = function* () {
    for (const r of ranks) {
      const hs = order.filter(h => rankOf(h) === r)
      const merging = hs.filter(h => aboveOf(h).length)
      yield* merging
      yield* hs.filter(h => !merging.includes(h))
    }
  }
  for (const hub of staged()) {
    const rank = rankOf(hub)
    const own = byHub.get(hub)!
    const above = aboveOf(hub)
    if (above.length > 1) {
      conflicts.push({ why: 'hub_claimed', hub, account: hub, people: above.map(p => p.hub) })
      continue
    }
    if (!above.length) {
      // 새 사람. 더 위 허브의 다른 사람이 이미 가진 계정은 더하지 않는다
      const p: PersonGroup = { hub, rank, links: [] }
      for (const l of own) {
        const other = (holders.get(l.b) ?? []).filter(q => q.rank < rank)
        if (other.length) { conflicts.push({ why: 'account_claimed', hub, account: l.b, people: other.map(q => q.hub) }); continue }
        p.links.push(l)
      }
      people.push(p)
      for (const k of accountsOf(p)) hold(k, p)
      continue
    }
    // 위 허브 사람에 합친다. 그 사람이 이미 가진 SaaS 는 위 허브 것이 남는다
    const p = above[0]
    const had = new Map<string, Set<string>>()
    for (const k of accountsOf(p)) (had.get(providerOf(k)) ?? had.set(providerOf(k), new Set()).get(providerOf(k))!).add(k)
    for (const l of own) {
      const taken = had.get(providerOf(l.b))
      if (taken?.has(l.b)) { shadowed += 1; continue }
      if (taken) { conflicts.push({ why: 'provider_taken', hub, account: l.b, people: [p.hub] }); continue }
      const other = (holders.get(l.b) ?? []).filter(q => q !== p && q.rank < rank)
      if (other.length) { conflicts.push({ why: 'account_claimed', hub, account: l.b, people: other.map(q => q.hub) }); continue }
      p.links.push(l)
      hold(l.b, p)
    }
  }
  const addrRank = hubs.findIndex(h => h.role === 'address')
  if (addrRank >= 0) placeAddresses(addresses, addrRank, people, conflicts, holders, hold, accountsOf, providerOf)
  return { people, conflicts, shadowed }
}

/**
 * 주소 허브(맨 아래). 위 허브 사람이 가진 계정은 그대로 두고 남은 계정만 묶는다.
 *   그 주소를 쓰는 계정이 위 허브 사람 하나에 있으면 남은 계정을 그 사람에 합친다(SaaS 마다 하나, 다르면 provider_taken)
 *   위 허브 사람 둘 이상에 있으면 합치지 않고 hub_claimed
 *   아무에게도 없으면 남은 계정이 SaaS 둘 이상일 때 새 사람(주소 Link). 간선은 첫 계정에서 나머지로
 * 위 허브 사람 판단은 주소 묶음을 보기 전 것으로 한다 — 주소 둘을 가진 계정이 주소끼리 사슬을 만들지 않게(그 계정은 두 Link 에 다 들 수 있다)
 */
function placeAddresses(addresses: AddressGroup[], rank: number, people: PersonGroup[], conflicts: HubConflict[], holders: Map<string, PersonGroup[]>,
  hold: (k: string, p: PersonGroup) => void, accountsOf: (p: PersonGroup) => string[], providerOf: (k: string) => string): void {
  const before = new Map([...holders].map(([k, ps]) => [k, [...ps]]))
  type Member = AddressGroup['members'][number]
  const domain = (v: string) => v.slice(v.lastIndexOf('@') + 1)
  const edge = (g: AddressGroup, x: Member, y: Member): JoinLink => {
    // 같은 주소가 아니라 별칭 도메인 주소면 alias_level, 링크에 domain_alias
    const aliased = x.entry.value !== y.entry.value
    return {
      a: x.entry.end, b: y.entry.end, level: aliased ? g.alias_level ?? g.level : g.level, kind: g.kind, tier: g.tier, records: { ...x.records, ...y.records }, capped: false, address_hub: true,
      ...(g.suspect ? { shared_mailbox_suspected: true } : {}), ...(aliased ? { domain_alias: { a: domain(x.entry.value), b: domain(y.entry.value) } } : {}), via: [x.entry, y.entry],
    }
  }
  for (const g of addresses) {
    const upper = [...new Set(g.members.flatMap(m => before.get(m.entry.end) ?? []))]
    const left = g.members.filter(m => !before.has(m.entry.end))
    if (!left.length) continue
    if (upper.length > 1) { conflicts.push({ why: 'hub_claimed', hub: g.value, account: g.value, people: upper.map(p => p.hub) }); continue }
    if (upper.length === 1) {
      const p = upper[0]
      const anchor = g.members.find(m => before.get(m.entry.end)?.includes(p))!
      const had = new Map<string, Set<string>>()
      for (const k of accountsOf(p)) (had.get(providerOf(k)) ?? had.set(providerOf(k), new Set()).get(providerOf(k))!).add(k)
      for (const m of left) {
        const taken = had.get(providerOf(m.entry.end))
        if (taken?.has(m.entry.end)) continue // 앞 주소 묶음이 이미 이 사람에 합쳤다
        if (taken) { conflicts.push({ why: 'provider_taken', hub: g.value, account: m.entry.end, people: [p.hub] }); continue }
        p.links.push(edge(g, anchor, m))
        hold(m.entry.end, p)
        had.set(providerOf(m.entry.end), new Set([m.entry.end]))
      }
      continue
    }
    if (new Set(left.map(m => providerOf(m.entry.end))).size < 2) continue
    const [anchor, ...rest] = left
    const p: PersonGroup = { hub: anchor.entry.end, rank, address: g.value, links: rest.map(m => edge(g, anchor, m)) }
    people.push(p)
    for (const k of accountsOf(p)) hold(k, p)
  }
}
