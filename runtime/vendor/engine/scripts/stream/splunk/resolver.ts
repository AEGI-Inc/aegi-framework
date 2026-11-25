/**
 * 원본 ID → 그래프 객체 키. 객체의 식별자(id, login, email, primaryEmail, full_name, key)만 쓴다.
 * 표시 이름 일치로는 확정하지 않는다 (SPLUNK_SPEC.md 4절).
 *
 * 찾으면 무엇이 같았는지(matched_on)를 같이 돌려준다. 그래프 관계를 받았으면 이벤트에서 찾은 객체 둘이
 * 어느 관계의 출발, 도착과 같았는지도 센다(relationMatches). 둘 다 「같다」는 사실만이고 해석하지 않는다.
 */
import type { EventProvider, EventSlot, GraphRelationRef, MatchedOn, NormalizedEvent, RelationMatch } from './types'

interface GraphObjectLike {
  fixture_key: string
  canonical?: { provider?: string; object_type?: string; identifiers?: Record<string, unknown>; properties?: Record<string, unknown> }
}

const ID_FIELDS = ['id', 'login', 'email', 'primaryEmail', 'full_name', 'key']
const PREFIX_PROVIDER: Record<string, EventProvider> = { OKTA: 'okta', GWS: 'gws', GH: 'github', SLK: 'slack', SF: 'salesforce', AT: 'atlassian', JIRA: 'atlassian', CF: 'atlassian' }

/**
 * 매퍼가 정한 종류 표시(옛 키 접두사) → 그 종류인 IM 객체 키의 앞부분. 표시가 있으면 이 종류 안에서만 찾는다.
 * 같은 값을 다른 종류가 쓸 수 있어서다(e2e6: Jira 프로젝트 10002 와 필터 10002, GitHub 숫자 id).
 * Okta 앱은 Application 만 둔다. 같은 id 의 OAuth2Client 는 같은 앱을 다른 API 로 본 것이다(crosswalk decided.okta_client_view).
 * 한 종류 표시에 IM 종류가 여럿이면 앞의 것을 먼저 쓴다. GitHub 사용자는 같은 사람이 simple-user 와 public-user 둘로 있고
 * (knowledge im-model space-aliases), 관계는 simple-user 에 걸린다.
 */
const PREFIX_IM_TYPES: Record<string, string[]> = {
  'OKTA-U': ['im:okta:User:'],
  'OKTA-G': ['im:okta:Group:'],
  'OKTA-APP': ['im:okta:Application:'],
  'OKTA-PRULE': ['im:okta:PolicyRule:'],
  'OKTA-POL': ['im:okta:Policy:'],
  'OKTA-GRULE': ['im:okta:GroupRule:'],
  'GH-U': ['im:github:simple-user:', 'im:github:public-user:', 'im:github:User Account:'],
  'GH-REPO': ['im:github:Repository:'],
  'GH-ORG': ['im:github:organization-full:'],
  'GH-HOOK': ['im:github:org-hook:'],
  'SLK-U': ['im:slack:200.members[*]:', 'im:slack:200.bot:'],
  'SLK-CH': ['im:slack:conversation:'],
  'SLK-WS': ['im:slack:200.team:'],
  'SLK-ENT': ['im:slack:defs_enterprise_id:'],
  'SLK-APP': ['im:slack:defs_app_id:'],
  'SLK-UG': ['im:slack:usergroup:'],
  'SF-U': ['im:salesforce:User:'],
  'SF-PS': ['im:salesforce:PermissionSet:'],
  'SF-FLOW': ['im:salesforce:FlowDefinitionView:'],
  'AT-U': ['im:jira:User:'],
  'AT-G': ['im:jira:FoundGroup:'],
  'JIRA-P': ['im:jira:Project:'],
  'JIRA-PR': ['im:jira:ProjectRole:'],
  'GWS-TOK': ['im:gws:Token:'],
}

const TYPE_EXTRA_FIELDS: Record<string, string[]> = { 'AT-G': ['name'], 'SF-PS': ['Label'], 'SF-FLOW': ['ApiName'] }

/** 원본 칸 이름과 그 값. 객체 키를 찾을 후보다 */
export type Candidate = readonly [field: string, value: unknown]

export interface ObjectMatch { key: string; matched_on: MatchedOn }

interface Indexed { key: string; identifier: string; value: string }

/** 종류 색인 칸. hit 가 null 이면 같은 순위의 다른 객체가 같은 값을 가져 모호하다 */
interface Ranked { hit: Indexed | null; rank: number }

/** graph-index 에서 받은 그래프 정보. 관계가 없으면 관계 일치를 세지 않는다 */
export interface ResolverGraph {
  snapshotId?: string
  /** 스냅샷을 만든 데이터셋의 생성 시각(graph_snapshots.dataset_created_at) */
  collectedAt?: string | null
  relations?: GraphRelationRef[]
  selfClientIds?: string[]
}

const present = (v: unknown): v is string | number => (typeof v === 'string' && v !== '') || (typeof v === 'number' && Number.isFinite(v))

export class EntityResolver {
  private readonly byValue = new Map<string, Indexed>()
  /** `<종류 표시>|<값>` → 객체. 같은 순위의 IM 종류 안에서 값이 둘 이상의 객체에 맞으면 hit null(모호) */
  private readonly byType = new Map<string, Ranked>()
  /** `<provider>|<IM object_type>|<값>` → 객체. 같은 종류 안에서 값이 둘 이상의 객체에 맞으면 null(모호). 사건 사전 kinds 가 쓴다 */
  private readonly byObjectType = new Map<string, Indexed | null>()
  private readonly keys = new Set<string>()
  private readonly gwsTokenNames = new Map<string, string | null>()
  private readonly relationsFrom = new Map<string, GraphRelationRef[]>()
  private readonly hasRelations: boolean
  private readonly selfClientIds: Set<string>
  readonly hasObjects: boolean
  readonly snapshot: { id: string; collected_at: string | null } | null

  constructor(objects: GraphObjectLike[], gwsTokens: Array<{ clientId?: unknown; displayText?: unknown }> = [], graph: ResolverGraph = {}) {
    this.hasObjects = objects.length > 0
    this.selfClientIds = new Set(graph.selfClientIds ?? [])
    for (const o of objects) {
      this.keys.add(o.fixture_key)
      // 옛 키는 접두사(OKTA-), IM 키(im:okta:User:…)는 canonical.provider 로 provider 를 정한다.
      // provider 이름을 여기서 고르지 않는다 — 사전에 호출을 더한 새 SaaS(gcp 등)의 객체도 색인해야 그 사건의 끝을 찾는다. 찾기는 provider 별로 갈린다
      const provider = PREFIX_PROVIDER[o.fixture_key.split('-')[0] ?? ''] ?? (o.canonical?.provider ? o.canonical.provider as EventProvider : undefined)
      if (!provider) continue
      const types = o.fixture_key.startsWith('im:')
        ? Object.entries(PREFIX_IM_TYPES).map(([t, ps]) => [t, ps.findIndex(p => o.fixture_key.startsWith(p))] as const).filter(([, rank]) => rank >= 0)
        : []
      const indexType = (t: string, rank: number, entry: Indexed) => {
        const k = `${t}|${entry.value.toLowerCase()}`
        const seen = this.byType.get(k)
        if (!seen || rank < seen.rank) this.byType.set(k, { hit: entry, rank })
        else if (rank === seen.rank && seen.hit?.key !== entry.key) this.byType.set(k, { hit: null, rank })
      }
      const ids = o.canonical?.identifiers ?? {}
      for (const field of ID_FIELDS) {
        const v = (ids[field] as { value?: unknown } | undefined)?.value
        if (!present(v)) continue
        const value = String(v)
        const entry = { key: o.fixture_key, identifier: field, value }
        for (const [t, rank] of types) indexType(t, rank, entry)
        const ot = o.canonical?.object_type
        if (typeof ot === 'string' && ot) {
          const tk = `${provider}|${ot}|${value.toLowerCase()}`
          const seen = this.byObjectType.get(tk)
          if (seen === undefined) this.byObjectType.set(tk, entry)
          else if (seen && seen.key !== entry.key) this.byObjectType.set(tk, null)
        }
        // 숫자 id(GitHub)는 종류끼리 겹칠 수 있어(GH-RUNNERGROUP-1 등) 종류를 모르는 색인에는 넣지 않는다
        if (typeof v !== 'string') continue
        const k = `${provider}|${value.toLowerCase()}`
        // 같은 값이 여러 객체에 있으면(예: OAuth2Client 와 Application 이 같은 id) 먼저 본 객체를 둔다
        if (!this.byValue.has(k)) this.byValue.set(k, entry)
      }
      const props = o.canonical?.properties ?? {}
      for (const [t, rank] of types) {
        for (const field of TYPE_EXTRA_FIELDS[t] ?? []) {
          const fromId = (ids[field] as { value?: unknown } | undefined)?.value
          const fromProp = props[field]
          const v = present(fromId) ? fromId : (typeof fromProp === 'string' && fromProp !== '' ? fromProp : undefined)
          if (!present(v)) continue
          indexType(t, rank, { key: o.fixture_key, identifier: field, value: String(v) })
        }
      }
      const primary = ids.primary
      if (Array.isArray(primary) && primary.length >= 2) {
        const primaryVals: string[] = []
        let primaryOk = true
        for (const f of primary) {
          if (typeof f !== 'string') { primaryOk = false; break }
          const v = (ids[f] as { value?: unknown } | undefined)?.value
          if (!present(v)) { primaryOk = false; break }
          primaryVals.push(String(v))
        }
        if (primaryOk) {
          const entry = { key: o.fixture_key, identifier: primary.join('|'), value: primaryVals.join('|') }
          for (const [t, rank] of types) indexType(t, rank, entry)
        }
      }
    }
    for (const token of gwsTokens) {
      if (typeof token.clientId !== 'string' || !token.clientId || typeof token.displayText !== 'string' || !token.displayText.trim()) continue
      const id = token.clientId
      const name = token.displayText.trim()
      if (!this.gwsTokenNames.has(id)) this.gwsTokenNames.set(id, name)
      else if (this.gwsTokenNames.get(id) !== name) this.gwsTokenNames.set(id, null)
    }
    this.hasRelations = Array.isArray(graph.relations)
    for (const r of graph.relations ?? []) {
      if (!r?.from || !r.to || r.from === r.to) continue
      const list = this.relationsFrom.get(r.from) ?? []
      list.push(r)
      this.relationsFrom.set(r.from, list)
    }
    this.snapshot = graph.snapshotId ? { id: graph.snapshotId, collected_at: graph.collectedAt ?? null } : null
  }

  /** 옛 키는 접두사로, IM 키는 종류 표에서 그 종류인지 본다 */
  private ofType(key: string, prefix: string): boolean {
    return key.startsWith('im:') ? (PREFIX_IM_TYPES[prefix] ?? []).some(p => key.startsWith(p)) : key.startsWith(`${prefix}-`)
  }

  /**
   * 후보 값 중 먼저 찾은 객체와 그 근거, 또는 못 찾은 이유. preferPrefix 가 있으면 그 종류의 객체만 받는다.
   * 값이 있는 후보가 하나도 없거나 객체를 하나도 받지 않았으면 null.
   */
  lookup(provider: EventProvider, candidates: readonly Candidate[], preferPrefix?: string): ObjectMatch | { miss: 'not_in_graph' | 'ambiguous' } | null {
    if (!this.hasObjects) return null
    const vals = candidates.filter((c): c is readonly [string, string | number] => present(c[1])).map(([f, v]) => [f, String(v)] as const)
    if (!vals.length) return null
    const found = (hit: Indexed, field: string, value: string): ObjectMatch =>
      ({ key: hit.key, matched_on: { event_field: field, identifier: hit.identifier, same: hit.value === value ? 'exact' : 'casefold' } })
    const typed = preferPrefix !== undefined && PREFIX_IM_TYPES[preferPrefix] !== undefined
    if (preferPrefix) {
      for (const [f, v] of vals) {
        const key = `${preferPrefix}-${v}`
        if (this.keys.has(key)) return { key, matched_on: { event_field: f, identifier: 'object_key', same: 'exact' } }
      }
    }
    // 종류 색인에서 모호했던 값은 종류를 모르는 색인으로 다시 고르지 않는다
    const ambiguous = new Set<string>()
    if (typed) {
      for (const [f, v] of vals) {
        const slot = this.byType.get(`${preferPrefix}|${v.toLowerCase()}`)
        if (slot?.hit) return found(slot.hit, f, v)
        if (slot) ambiguous.add(v.toLowerCase())
      }
    }
    for (const [f, v] of vals) {
      if (ambiguous.has(v.toLowerCase())) continue
      const hit = this.byValue.get(`${provider}|${v.toLowerCase()}`)
      if (hit && (!typed || this.ofType(hit.key, preferPrefix!))) return found(hit, f, v)
    }
    if (ambiguous.size > 0 && vals.every(([, v]) => ambiguous.has(v.toLowerCase()))) {
      return { miss: 'ambiguous' }
    }
    return { miss: 'not_in_graph' }
  }

  /**
   * 후보 값을 주어진 IM 객체 종류(object_type) 안에서만 찾는다. 같은 값을 다른 종류가 id 로 가질 때 쓴다
   * (GWS 사용자 메일과 같은 id 의 Calendar, Jira 프로젝트 id 와 같은 숫자의 Filter). 종류 밖 객체로 넘어가지 않는다.
   */
  lookupOfTypes(provider: EventProvider, candidates: readonly Candidate[], objectTypes: readonly string[]): ObjectMatch | { miss: 'not_in_graph' | 'ambiguous' } | null {
    if (!this.hasObjects) return null
    const vals = candidates.filter((c): c is readonly [string, string | number] => present(c[1])).map(([f, v]) => [f, String(v)] as const)
    if (!vals.length) return null
    let ambiguous = 0
    for (const [f, v] of vals) {
      for (const t of objectTypes) {
        const hit = this.byObjectType.get(`${provider}|${t}|${v.toLowerCase()}`)
        if (hit) return { key: hit.key, matched_on: { event_field: f, identifier: hit.identifier, same: hit.value === v ? 'exact' : 'casefold' } }
        if (hit === null) ambiguous++
      }
    }
    return { miss: ambiguous ? 'ambiguous' : 'not_in_graph' }
  }

  /**
   * 후보 값 중 먼저 찾은 객체와 그 근거. preferPrefix 가 있으면 그 종류의 객체만 받는다.
   * 종류 표에 없는 접두사는 옛 동작대로 provider 전체에서 찾는다.
   */
  match(provider: EventProvider, candidates: readonly Candidate[], preferPrefix?: string): ObjectMatch | null {
    const res = this.lookup(provider, candidates, preferPrefix)
    return res && 'key' in res ? res : null
  }

  /** 후보 값 중 먼저 찾은 객체 키. 칸 이름이 필요 없는 곳에서 쓴다 */
  resolve(provider: EventProvider, values: Array<string | number | null | undefined>, preferPrefix?: string): string | null {
    return this.match(provider, values.map(v => ['', v] as const), preferPrefix)?.key ?? null
  }

  /**
   * 이벤트에서 찾은 객체 둘이 그래프 관계 하나의 출발과 도착과 같으면 그 관계를 적는다. 그래프 관계를 받지 못했으면 undefined.
   * 칸은 정하지 않는다: 행위자→대상, 대상→행위자, 대상→대상 모두 그대로 적는다. 한쪽 끝만 같은 것은 적지 않는다(그래프 이웃과 같은 정보다).
   * role 은 대조 조건이 아니다. 두 끝이 같고 role 만 다른 관계는 모두 적고, role 객체도 이벤트에 있으면 그 칸을 붙인다.
   */
  relationMatches(e: Pick<NormalizedEvent, 'actor' | 'targets'>): RelationMatch[] | undefined {
    if (!this.hasRelations) return undefined
    const slots = new Map<string, EventSlot>()
    if (e.actor?.object_key) slots.set(e.actor.object_key, 'actor')
    e.targets.forEach((t, i) => { if (t.object_key && !slots.has(t.object_key)) slots.set(t.object_key, { target: i }) })
    const out: RelationMatch[] = []
    for (const [key, source] of slots) {
      for (const r of this.relationsFrom.get(key) ?? []) {
        const target = slots.get(r.to)
        if (!target) continue
        const role = r.role ? slots.get(r.role) : undefined
        out.push({ relation_id: r.id, relation_type: r.type, source, target, ...(role ? { role } : {}) })
      }
    }
    return out.sort((a, b) => a.relation_id.localeCompare(b.relation_id))
  }

  /** Admin SDK Token.clientId와 displayText의 정확한 동일 테넌트 일치만 허용한다. */
  gwsTokenDisplay(clientId: string): string | null {
    return this.gwsTokenNames.get(clientId) ?? null
  }

  /** AEGI 수집기 자기 활동인지 본다 */
  isSelfClient(clientId: string): boolean {
    return this.selfClientIds.has(clientId)
  }
}
