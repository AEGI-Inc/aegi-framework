/**
 * SaaS 를 넘는 관계와 같은 사람 · 같은 자동화 Link 를 개념 사전 crosswalk.yaml 대로 만든다 (Relation_Schema_v3 「교차 provider 관계는
 * stated 만」 · Link_Schema_v3 「허브 구조」 · Profile_Schema_v4.2 external_refs).
 *
 * 규칙은 이 저장소의 개념 사전 사본 ontology/crosswalk.yaml 이다(정본 aegi-knowledge schema/ontology/). 키 종류(kinds)와
 * 어느 SaaS 의 어느 칸이 그 종류인지(fields)를 읽어 join.ts 가 잇고, 여기서는 결과를 데이터셋에 쓴다. 새 연결 방법은 코드가 아니라
 * aegi-knowledge 의 crosswalk.yaml 에 줄을 더하고 사본을 가져와(npm run ontology:sync) 잇는다.
 *
 * 쓰는 것
 * - 관계 (출발이 Integration · Automation · Credential · Endpoint, 벤더가 적어 준 값): properties 에 cross_provider, 맞춘 칸, 키 종류
 * - 같은 사람 Link: 허브(Okta 사용자) 하나 = Link 하나. 간선마다 level · rule(키 종류) · matched_on 을 meta.edges 에 남기고,
 *   Link 의 level 은 가장 약한 간선이다
 * - 같은 자동화 Link (link_kind automation): 허브 계정 · 상대 키 값 하나 = Link 하나
 * - 못 이은 것: 가리키는 값의 상대가 없으면 하나씩, 나머지는 종류별 개수로 notes 에 적는다
 *
 * Object 가 아닌 Link 재료(칸 표시 link_material, 예: GitHub ExternalIdentity)는 linkMaterials.ts 가 원본에서 만들어 runJoin 에 넘긴다.
 *
 * 그룹 Link(Okta Group Push)는 crosswalk.yaml open.group_push 가 미결이라 identity.ts 의 v1 규칙 그대로다.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import type { IdentityLink, IdentityLinkMember } from '../../../src/model/link'
import type { FixtureObject } from '../../../src/model/object'
import type { NormalizeContext } from './context'
import type { SourceObs } from './dataset'
import type { RawSet } from './raw'
import { streamRows } from './observations'
import type { DatasetV2, RelationInputV2 } from './dataset'
import type { LinkEdge } from './identity'
import { get, groupPeople, runJoin, type Crosswalk, type CrosswalkField, type CrosswalkHub, type Entry, type JoinLink, type JoinResult } from './join'
import type { MatchObject, MatchRelation } from './match'
import { buildLinkMaterials } from './linkMaterials'

const ONTOLOGY = path.resolve(import.meta.dirname, '../../../ontology')

/**
 * 엔진이 crosswalk.yaml 과 일부러 다르게 읽는 칸. replace 와 같은 칸 표시를 with 로 바꿔 읽는다.
 * connections.test.ts 가 replace 가 사본에 아직 있는지 본다 — 명세가 바뀌면 이 목록을 다시 본다.
 */
export const ENGINE_FIELD_OVERRIDES: ReadonlyArray<{ code: string; replace: Partial<CrosswalkField>; with: CrosswalkField; why: string }> = [
  {
    code: 'okta-client-before-projection',
    replace: { kind: 'log_correlation', side: 'a', provider: 'okta', object_type: 'Application', path: 'properties.client_id' },
    with: { kind: 'log_correlation', side: 'a', provider: 'okta', object_type: 'OAuth2Client', path: 'identifiers.id' },
    why: 'Okta 클라이언트의 역할(has_role_on)이 OAuth2Client 에 있다. 예전에는 투영(지운 model-v1/project.ts V2-D05)이 OAuth2Client 를 '
      + '같은 client_id 의 앱에 합치며 Link 끝도 앱으로 옮겨 명세(decided.okta_client_view)와 같아졌다. 단일 파이프라인에는 그 투영이 없어 '
      + 'Link 끝이 OAuth2Client 에 남는다 — 명세와 다르다',
  },
]

/**
 * 엔진이 명세와 일부러 다르게 정하는 Link 단계. 그 키 종류의 differs 가 적은 대로 옛 대시보드 규칙을, 팀이 crosswalk.yaml open 의
 * 그 항목을 정할 때까지 쓴다. connections.test.ts 가 open 항목이 사본에 아직 있는지 본다 — 정해지면 시험이 실패해 이 줄을 다시 본다.
 */
export const ENGINE_LEVEL_OVERRIDES: ReadonlyArray<{ code: string; kind: string; open: string; why: string; level: (link: JoinLink, ds: DatasetV2) => string }> = [
  {
    code: 'federated-proof-dashboard-rule',
    kind: 'federated_subject',
    open: 'federated_proof',
    why: '명세는 IdP 앱이 대상 테넌트에 registered_in 일 때만 resolved 다. 대시보드는 GitHub SAML 이면 Okta 에 GitHub 앱(ghec · github)이 있는지로, '
      + 'Google 앱 배정이면 따로 보지 않고(언제나) resolved 로 정했다. 시험 환경에서는 Okta Google 앱 도메인이 수집한 GWS 를 가리키지 않아, '
      + '명세대로면 Okta ↔ GWS 연결이 모두 possibly_same 으로 내려가 탐지의 확인 · 추정이 바뀐다',
    level: (link, ds) => {
      if (link.capped) return link.level // 칸 표시 level_cap 이 걸린 링크는 명세 단계 그대로 (2026-11-03 부터 GWS 별칭에는 cap 이 없다, decided.alias_level)
      const target = ds.get(link.b)?.canonical.provider
      if (target === 'gws') return 'resolved'
      if (target === 'github') return oktaHasGithubApp(ds) ? 'resolved' : 'possibly_same'
      return link.level
    },
  },
]

/** Okta 에 GitHub 앱(ghec · github)이 있는가 — 데이터셋마다 한 번만 센다 */
const githubAppSeen = new WeakMap<DatasetV2, boolean>()
function oktaHasGithubApp(ds: DatasetV2): boolean {
  if (!githubAppSeen.has(ds)) githubAppSeen.set(ds, [...ds.objects.values()].some(o => o.canonical.provider === 'okta' && o.canonical.object_type === 'Application' && /ghec|github/i.test(String(o.canonical.properties.name ?? ''))))
  return githubAppSeen.get(ds)!
}

export function loadCrosswalk(dir = ONTOLOGY): Crosswalk & { open?: Array<{ id: string }>; decided?: Array<{ id: string }> } {
  const cw = parse(readFileSync(path.join(dir, 'crosswalk.yaml'), 'utf8')) as Crosswalk
  const same = (f: CrosswalkField, want: Partial<CrosswalkField>) => Object.entries(want).every(([k, v]) => (f as any)[k] === v)
  const fields = cw.fields.map(f => ENGINE_FIELD_OVERRIDES.find(o => same(f, o.replace))?.with ?? f)
  return { ...cw, fields }
}

export function loadResolvers(dir = ONTOLOGY): Record<string, Record<string, any>> {
  return (parse(readFileSync(path.join(dir, 'relation_semantics.yaml'), 'utf8')) as any)?.resolvers ?? {}
}

export function matchObject(o: FixtureObject): MatchObject {
  const c = o.canonical as any
  return {
    k: o.fixture_key,
    p: c.provider,
    t: c.object_type,
    i: c.interfaces ?? [],
    props: c.properties ?? {},
    ids: c.identifiers ?? {},
    judged: c.judged ?? {},
    profile: (o.fixture_meta as any)?.model_v1?.profile_constants ?? {},
    meta: (o.fixture_meta as any) ?? {},
    refs: Object.fromEntries(Object.entries(c.references ?? {}).map(([name, ref]: [string, any]) => [name, (ref?.targets ?? []).map((t: any) => String(t.value))])),
  }
}

function obsOf(obj: FixtureObject | undefined): SourceObs {
  const o = obj?.canonical.source.observations?.[0]
  return { api: o?.api ?? 'derived', params: (o?.params as Record<string, unknown>) ?? {}, record: 'measured', collected_at: o?.collected_at ?? '' }
}

const fieldName = (f: CrosswalkField) => (f.side === 'record' ? `${f.source} ${f.a} · ${f.b}` : `${f.provider} ${f.object_type}.${f.path}`)
const matchedOn = (x: Entry, y: Entry) => `${fieldName(x.field)} = ${fieldName(y.field)}`
const STRENGTH: Record<string, number> = { disclosed_relation: 4, resolved: 4, possibly_same: 2, possibly_related: 1, different: 0 }
const weakest = (levels: string[]) => levels.reduce((w, l) => (STRENGTH[l] < STRENGTH[w] ? l : w), levels[0])

/** 기록 출처 「<provider>:<호출>」 의 행. Worker 로그(D1)는 id 로 겹침을 지운 results 다 */
function readRecords(cw: Crosswalk, raw: RawSet): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const f of cw.fields) {
    if (f.side !== 'record' || !f.source) continue
    const [provider, call] = f.source.split(':')
    if (!raw.pages(provider as any, call).length) continue
    out[f.source] = streamRows(raw, provider as any, call, 'id', 'results')
  }
  return out
}

export function buildCrosswalkLinks(ds: DatasetV2, ctx: NormalizeContext, raw: RawSet, cw = loadCrosswalk()): JoinResult {
  const objects: Record<string, MatchObject> = {}
  for (const o of ds.objects.values()) objects[o.fixture_key] = matchObject(o)
  const relations: MatchRelation[] = ds.relationRows().map(r => ({ rt: r.type, s: r.source, d: r.target, props: { ...(r.properties ?? {}), basis: r.basis } }))
  const result = runJoin(cw, objects, relations, readRecords(cw, raw), loadResolvers(), buildLinkMaterials(raw, ds, ctx))
  for (const l of result.links as Written[]) {
    const o = ENGINE_LEVEL_OVERRIDES.find(x => x.kind === l.kind)
    const level = o?.level(l, ds)
    if (o && level && level !== l.level) Object.assign(l, { specLevel: l.level, override: o.code, level })
  }

  for (const r of result.relations) {
    if (r.props?.basis !== 'stated') throw new Error(`crosswalk ${r.kind}: SaaS 를 넘는 관계는 stated 만 만든다 (${r.props?.basis})`)
    const source = ds.get(r.s)
    const { basis: _basis, ...marks } = r.props ?? {}
    ds.addRelation({ provider: source!.canonical.provider, type: r.rt as RelationInputV2['type'], source: r.s, target: r.d, basis: 'stated', obs: obsOf(source), properties: { ...marks, matched_on: matchedOn(...r.via), crosswalk_kind: r.kind } })
  }
  writeAutomationLinks(ds, result.links.filter(l => l.link_kind === 'automation'))
  writePersonLinks(ds, ctx, result.links.filter(l => !l.link_kind), cw.hubs ?? [], objects, result.addresses)
  writeNotes(ds, result)
  return result
}

/** 엔진이 명세와 다르게 정한 단계가 있으면 명세 단계와 그 규칙 코드를 같이 남긴다 (ENGINE_LEVEL_OVERRIDES) */
type Written = JoinLink & { specLevel?: string; override?: string }

function edgeOf(l: Written): LinkEdge {
  const [x, y] = l.via
  const holders = [x, y].filter(e => e.holder !== e.end).map(e => e.holder)
  const created = l.records.valid_from
  // 칸 하나로는 약해 level_cap 이 걸리는 칸인데 다른 칸(cap_unless_same)이 더 맞아 풀렸으면 그 칸도 맞춘 것으로 적는다
  const lift = x.field.cap_unless_same ?? y.field.cap_unless_same
  const lifted = !!(x.field.level_cap ?? y.field.level_cap) && !l.capped && lift
  const notes = [
    holders.length ? `값을 가진 객체 ${holders.join(', ')}` : '',
    l.capped ? `칸 표시 level_cap 으로 ${l.level}` : '',
    l.override ? `엔진 규칙 ${l.override} (명세 단계 ${l.specLevel})` : '',
    l.domain_alias ? `도메인 별칭 ${l.domain_alias.a} = ${l.domain_alias.b} (같은 조직이 DNS 로 확인)` : '',
    l.address_hub ? '주소 허브 — 디렉터리 확인 없이 같은 주소' : '',
  ].filter(Boolean)
  return {
    a: l.a, b: l.b, level: l.level as LinkEdge['level'], rule: l.kind, tier: l.tier, matched_on: [matchedOn(x, y), ...(lifted ? [`${lift.a} = ${lift.b}`] : [])],
    ...(typeof created === 'number' ? { valid_from: new Date(created * 1000).toISOString() } : typeof created === 'string' && created ? { valid_from: created } : {}),
    ...(notes.length ? { note: notes.join(' · ') } : {}),
    ...(l.shared_mailbox_suspected ? { shared_mailbox_suspected: true } : {}),
    ...(l.address_hub ? { hub: 'address' as const } : {}),
  }
}

/** 허브 계정의 Link 이름 — hubs 의 name 칸(Okta login, GWS 주 메일), 없으면 화면 이름 */
export function hubNamer(objects: Record<string, MatchObject>, hubs: CrosswalkHub[] = []) {
  return (k: string): string => {
    const o = objects[k]
    const path = hubs.find(h => h.provider === o?.p && h.object_type === o?.t)?.name
    const v = path && o ? get(o, path) : undefined
    return String(v ?? o?.meta?.display_name ?? k)
  }
}

/**
 * 사람 하나 = Link 하나 (join.ts groupPeople). 허브는 crosswalk.yaml hubs 의 계정(Okta 사용자, 메일 디렉터리 사용자)이다.
 * 위 허브 사람에 합친 아래 허브의 연결은 그 Link 의 간선으로 들어간다(간선 a 가 아래 허브 계정). 합치지 않은 것은 notes 에 「연결 충돌」로 남긴다.
 * Link id 는 v1 과 같이 LNK-<허브 계정 id> (Okta 사용자는 키 머리 OKTA-U- 를 뗀다).
 * 주소 허브 사람(hubs role address)은 계정이 아니라 주소가 기준점이라 id 가 LNK-ADDR-<주소 sha256 앞 12자>, 이름이 그 주소, meta.hub 가 address 다
 */
function writePersonLinks(ds: DatasetV2, ctx: NormalizeContext, links: JoinLink[], hubs: CrosswalkHub[], objects: Record<string, MatchObject>, addresses: JoinResult['addresses'] = []): void {
  const nameOf = hubNamer(objects, hubs)
  const { people, conflicts, shadowed } = groupPeople(links, hubs, objects, nameOf, addresses)
  for (const person of people) {
    const hub = person.hub
    const edges = person.links.map(edgeOf)
    const hubObj = ds.get(hub)!
    const set: IdentityLinkMember[] = [{ provider: hubObj.canonical.provider as IdentityLinkMember['provider'], object_key: hub }]
    for (const e of edges) if (!set.some(m => m.object_key === e.b)) set.push({ provider: ds.get(e.b)!.canonical.provider as IdentityLinkMember['provider'], object_key: e.b })
    const name = person.address ?? nameOf(hub)
    const role = ctx.roleOfEmail(name)
    ds.links.push({
      link_id: person.address ? `LNK-ADDR-${createHash('sha256').update(person.address).digest('hex').slice(0, 12)}` : `LNK-${hub.replace(/^OKTA-U-/, '')}`,
      set,
      level: weakest(edges.map(e => e.level)) as IdentityLink['level'],
      source: { method: 'deterministic_rule', view_version: 2, basis: edges.map(e => `${e.b.split('-')[0].toLowerCase()}:${e.rule}=${e.level}`).join('; ') },
      meta: { person_name: name, display_name: name, ...(role ? { role } : {}), ...(person.address ? { hub: 'address' } : {}), edges },
    })
  }
  const WHY_CONFLICT: Record<string, string> = {
    account_claimed: '이미 위 허브의 다른 사람 Link 에 있다',
    provider_taken: '그 사람이 위 허브로 이미 이은 같은 SaaS 계정과 다르다 (link_one_per_provider)',
    hub_claimed: '위 허브의 사람 둘 이상이 이 허브 계정(주소 허브면 이 주소)을 가졌다',
  }
  const display = (k: string) => ds.get(k)?.fixture_meta?.display_name ?? k
  for (const c of conflicts) {
    ds.notes.push(`교차: 연결 충돌(${c.why}) — ${nameOf(c.hub)} 허브가 이은 ${display(c.account)} 는 ${WHY_CONFLICT[c.why]} (${c.people.map(nameOf).join(', ')}) — 합치지 않았다`)
  }
  if (shadowed) ds.notes.push(`교차: 아래 허브가 이은 계정 가운데 위 허브가 이미 같은 사람에 이은 것 ${shadowed}개 (hubs, 위 허브 간선만 남김)`)
}

/** 같은 자동화: 허브 계정(Okta 클라이언트) · 상대 키 값(Slack 앱 id) 하나 = Link 하나. Link id 는 v1 과 같이 LNK-AUTO-<상대 키 값> */
function writeAutomationLinks(ds: DatasetV2, links: JoinLink[]): void {
  const groups = new Map<string, JoinLink[]>()
  for (const l of links) {
    const key = `${l.via[1].value}|${l.a}`
    ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(l)
  }
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!
    const value = group[0].via[1].value
    const hub = group[0].a
    const members = [...new Set(group.map(l => l.b))].sort()
    const edges = members.map(b => edgeOf(group.find(l => l.b === b)!))
    const display = (k: string) => ds.get(k)?.fixture_meta?.display_name ?? k
    ds.links.push({
      link_id: `LNK-AUTO-${value}`,
      set: [...members.map(k => ({ provider: ds.get(k)!.canonical.provider as IdentityLinkMember['provider'], object_key: k })), { provider: ds.get(hub)!.canonical.provider as IdentityLinkMember['provider'], object_key: hub }],
      level: weakest(edges.map(e => e.level)) as IdentityLink['level'],
      source: { method: 'deterministic_rule', view_version: 2, basis: `${group[0].kind}: ${matchedOn(...group[0].via)} — 허브를 안 거친 자동화 (Link_Schema_v3 「현재 방법 없음」)` },
      meta: { person_name: `자동화 ${display(members[0])}`, display_name: `${display(members[0])} ↔ ${display(hub)}`, kind: 'automation', edges },
    })
  }
}

const WHY: Record<string, string> = {
  empty: '가리키는 칸이 빈 객체',
  no_target: '가리키는 값의 상대가 수집한 목록에 없음',
  no_record: '기록 출처를 못 읽음',
  no_material: 'Link 재료 없음',
  where: '값은 맞는데 조건에 걸림',
  ambiguous: '같은 식별값이 여러 대상 객체를 가리켜 확정하지 않음',
}

function writeNotes(ds: DatasetV2, result: JoinResult): void {
  // 상대가 없는 값은 하나씩 적는다 (Link_Schema_v3 「벤더가 준 연결의 상대편이 실제로 있는가」). 나머지는 종류 · 이유별 개수
  for (const u of result.unjoined.filter(x => x.why === 'no_target')) {
    const holder = u.holder ? ds.get(u.holder)?.fixture_meta?.display_name ?? u.holder : '-'
    ds.notes.push(`교차(${u.kind}): ${holder} 의 값 "${u.raw ?? u.value}" 에 맞는 상대가 수집한 목록에 없다 — 잇지 않았다`)
  }
  const counts = new Map<string, number>()
  for (const u of result.unjoined.filter(x => x.why !== 'no_target')) counts.set(`${u.kind}|${u.why}|${u.value ?? ''}`, (counts.get(`${u.kind}|${u.why}|${u.value ?? ''}`) ?? 0) + 1)
  for (const [key, n] of [...counts].sort()) {
    const [kind, why, value] = key.split('|')
    ds.notes.push(`교차(${kind}): ${WHY[why] ?? why}${value ? ` ${value}` : ''} ${n}개`)
  }
  if (result.shadowed.length) ds.notes.push(`교차: 앞 종류가 이미 같은 허브 계정 · SaaS 를 이어 쓰지 않은 연결 ${result.shadowed.length}개 (link_one_per_provider)`)
}
