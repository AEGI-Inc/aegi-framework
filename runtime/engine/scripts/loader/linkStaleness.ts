/**
 * 게시 전 확인: 데이터셋의 동일인 링크(links.json)가 지금 엔진 crosswalk 로 같은 객체, 관계를 다시 이은 결과와 같은가.
 *
 * 게시(--dataset, --from-current)는 링크를 다시 만들지 않고 데이터셋의 링크를 그대로 올리며, EA 와 판정도 그 링크 위에서 계산한다.
 * 그래프를 보존하고 객체만 덧붙인 판(D1 10-27: 10-25 스냅샷의 링크 9개를 그대로 두고 10-26 에 모은 GWS 테넌트를 더함)은
 * 링크가 낡는다. 그래서 데이터셋의 객체, 관계로 crosswalk 조인(join.ts runJoin)을 다시 돌려 사람 링크 간선을 견준다.
 *
 * 견주지 않는 것
 * - 원본에만 있는 입력이 필요한 간선: 기록 출처(칸 표시 side: record)로 맞추는 키 종류, Link 재료(link_material) 칸으로 맞춘 간선.
 *   데이터셋만으로는 다시 만들 수 없어 양쪽에서 빼고 수만 센다(skipped)
 * - 그룹 링크(Okta Group Push, crosswalk 밖 identity.ts)와 자동화 링크
 * - 간선이 없거나 지금 crosswalk 모양(matched_on 「<칸> = <칸>」)이 아닌 링크(v1, 합성, 옛 정규화): 견줄 수 없어 수만 센다(not_crosswalk).
 *   그 링크에 든 허브에서 지금 crosswalk 가 내는 간선도 견주지 않고 센다(now_unshaped)
 *
 * 객체는 정규화가 crosswalk 를 돌릴 때와 같은 호환 보기로 바꿔 넣는다(enrich-dataset.mjs): 유형 이름을 runtime-config.json 별칭의
 * 옛 이름으로, identifiers.id 를 runtime id 로, 인터페이스 계약값을 judged 로. 키는 데이터셋 키 그대로 둔다(링크와 같은 키 공간).
 *
 * 판정 코드 지문(engine.ts EA_CODE_FILES)에 들지 않는다 — 판정을 바꾸지 않고 게시 로그에 [주의] 를 남기기만 한다.
 */
import fs from 'fs'
import { INTERFACE_CONTRACT_VALUES, type FixtureObject } from '../../src/model/object'
import type { FixtureRelation } from '../../src/model/relation'
import type { IdentityLink } from '../../src/model/link'
import { ENGINE_LEVEL_OVERRIDES, hubNamer, loadCrosswalk, loadResolvers, matchObject } from '../collect/shared/crosswalk'
import { readDatasetFiles } from './engine'
import type { DatasetV2 } from '../collect/shared/dataset'
import { groupPeople, runJoin, type CrosswalkField } from '../collect/shared/join'
import type { MatchObject, MatchRelation } from '../collect/shared/match'

export interface LinkStaleness {
  /** 견준 데이터셋 간선 */
  compared: number
  /** 지금 crosswalk 가 낸 사람 링크 간선 (견주지 않는 것 뺌) */
  now: number
  /** 지금 crosswalk 에만 있는 간선 */
  added: number
  /** 데이터셋에만 있는 간선 */
  removed: number
  /** 양쪽에 있는데 단계가 다른 간선 */
  level_changed: number
  /** 간선 바뀜의 SaaS 짝 (허브 provider-상대 provider) */
  by_providers: Record<string, { added: number; removed: number; level_changed: number }>
  /**
   * 한 사람 링크(허브 하나)에 같이 드는 계정 쌍 중 지금 crosswalk 로 새로 생기는 쌍과 없어지는 쌍. 간선 단계와 상관없이 센다 —
   * EA 가 실제로 잇는 쌍(linkVias, 정규화 보고서 identity_link_pairs)과 다르고, 자동화 링크는 넣지 않는다
   */
  pairs_gained: number
  pairs_lost: number
  /** 원본에만 있는 입력이 필요해 견주지 않은 데이터셋 간선 */
  skipped: number
  /** 지금 crosswalk 모양이 아니라 견주지 않은 링크 */
  not_crosswalk: number
  /** 그 링크의 허브에서 지금 crosswalk 가 내는 간선 (견주지 않음) */
  now_unshaped: number
  /** 견주지 않은 데이터셋 간선(Link 재료 등)이 차지한 「허브 계정과 상대 SaaS」 자리라, 정규화였으면 link_one_per_provider 로 가려졌을 지금 간선 */
  now_shadowed: number
}

type Files = { objects: FixtureObject[]; relations: FixtureRelation[]; links: IdentityLink[] }
interface Edge { a: string; b: string; level: string; rule: string }

const RUNTIME_CONFIG = new URL('../collect/profile-binding/runtime-config.json', import.meta.url)
/** enrich-dataset.mjs 가 정규화 중 crosswalk 에 넘기는 객체와 같은 보기. 계약값 중 properties 에 남기는 것도 같다 */
const DIRECT = new Set(['expires_at', 'origin', 'activation', 'assignment_count'])
function compatView(o: FixtureObject, typeNames: Map<string, string>): FixtureObject {
  const m = (o.fixture_meta as { im_profile?: { runtime_id?: string } } | undefined)?.im_profile
  if (!m) return o
  const copy = structuredClone(o)
  const c = copy.canonical as any
  c.object_type = typeNames.get(`${c.provider}:${c.object_type}`) ?? c.object_type
  c.identifiers.id = { value: m.runtime_id ?? c.identifiers[c.identifiers.primary[0]]?.value, stability: 'stable' }
  for (const field of Object.keys(INTERFACE_CONTRACT_VALUES)) {
    if (DIRECT.has(field) || c.properties[field] === undefined) continue
    if (c.judged[field] === undefined || c.judged[field] === 'unknown') c.judged[field] = c.properties[field]
    delete c.properties[field]
  }
  return copy
}

const fieldName = (f: CrosswalkField) => (f.side === 'record' ? `${f.source} ${f.a} · ${f.b}` : `${f.provider} ${f.object_type}.${f.path}`)

/**
 * 지금 crosswalk 가 이 객체, 관계로 내는 사람 링크 간선. 정규화(crosswalk.ts buildCrosswalkLinks)와 같은 입력과 엔진 단계 규칙(ENGINE_LEVEL_OVERRIDES).
 * 기록 출처와 Link 재료는 데이터셋에 없어 넘기지 않는다. material 은 Link 재료 칸으로 맞춘 간선인가(지금은 재료가 없어 늘 거짓이지만 표시를 남긴다)
 */
function currentJoin(files: Files, cw: ReturnType<typeof loadCrosswalk>) {
  const aliases = (JSON.parse(fs.readFileSync(RUNTIME_CONFIG, 'utf8')).aliases ?? {}) as Record<string, string>
  const typeNames = new Map(Object.entries(aliases).map(([k, v]) => [`${k.slice(0, k.indexOf(':'))}:${v}`, k.slice(k.indexOf(':') + 1)]))
  const view = files.objects.map(o => compatView(o, typeNames))
  const byKey = new Map(view.map(o => [o.fixture_key, o]))
  const objects: Record<string, MatchObject> = {}
  for (const o of view) objects[o.fixture_key] = matchObject(o)
  const relations: MatchRelation[] = files.relations.map(r => ({ rt: r.canonical.relation_type, s: String(r.canonical.references.source.value), d: String(r.canonical.references.target.value), props: { ...(r.canonical.properties ?? {}) } }))
  const ds = { get: (k: string) => byKey.get(k), objects: byKey } as unknown as DatasetV2
  return { result: runJoin(cw, objects, relations, {}, loadResolvers(), {}), ds, objects }
}

export function currentLinkEdges(files: Files, cw = loadCrosswalk()): Array<Edge & { matched_on: string[]; material: boolean; shared_mailbox_suspected?: true }> {
  const { result, ds, objects } = currentJoin(files, cw)
  // 정규화와 같이 허브가 여럿이면 같은 사람으로 합치고, 합치지 않은 연결(충돌 · 위 허브가 이미 이은 것)은 뺀다 (crosswalk.ts writePersonLinks)
  const kept = groupPeople(result.links.filter(l => !l.link_kind), cw.hubs ?? [], objects, hubNamer(objects, cw.hubs), result.addresses).people.flatMap(p => p.links)
  return kept.map(l => {
    const [x, y] = l.via
    return { a: l.a, b: l.b, level: ENGINE_LEVEL_OVERRIDES.find(o => o.kind === l.kind)?.level(l, ds) ?? l.level, rule: l.kind, matched_on: [`${fieldName(x.field)} = ${fieldName(y.field)}`], material: l.via.some(e => !!e.field.link_material), ...(l.shared_mailbox_suspected ? { shared_mailbox_suspected: true } : {}) }
  })
}

/**
 * 지금 crosswalk 가 이 객체, 관계로 내는 SaaS 사이 관계. 정규화는 같은 관계에 crosswalk_kind(키 종류)와 matched_on(맞춘 두 칸)을 남긴다.
 * 데이터셋 관계는 수집 때의 정규화가 만든 것이라 그 뒤 더한 crosswalk 줄은 다시 정규화해야 들어간다 — 점수판이 「다시 이으면」을 잴 때 쓴다
 */
export function currentCrossRelations(files: Files, cw = loadCrosswalk()): Array<{ source: string; target: string; relation_type: string; crosswalk_kind: string; matched_on: string }> {
  const { result } = currentJoin(files, cw)
  const provider = new Map(files.objects.map(o => [o.fixture_key, o.canonical.provider]))
  return result.relations.filter(r => provider.get(r.s) !== provider.get(r.d)).map(r => ({ source: r.s, target: r.d, relation_type: r.rt, crosswalk_kind: r.kind, matched_on: `${fieldName(r.via[0].field)} = ${fieldName(r.via[1].field)}` }))
}

export function linkStaleness(files: Files, cw = loadCrosswalk()): LinkStaleness {
  const recordKinds = new Set(cw.fields.filter(f => f.side === 'record').map(f => f.kind))
  // 데이터셋 간선은 맞춘 칸 이름(matched_on)만 남아, Link 재료 칸인지 crosswalk.ts matchedOn 과 같은 모양의 칸 이름으로 가린다.
  // 그 모양이 바뀌면 정규화 파이프라인 시험(skipped > 0, removed 0)이 실패한다
  const materialFields = cw.fields.filter(f => f.link_material).map(fieldName)
  const kinds = Object.keys(cw.kinds ?? {})
  const out: LinkStaleness = { compared: 0, now: 0, added: 0, removed: 0, level_changed: 0, by_providers: {}, pairs_gained: 0, pairs_lost: 0, skipped: 0, not_crosswalk: 0, now_unshaped: 0, now_shadowed: 0 }
  // 기록 출처로 맞추는 키 종류(지금은 log_correlation 하나, 자동화 링크라 원래 빠짐)는 종류째 견주지 않는다
  const unreproducible = (rule: string, matchedOn: unknown) =>
    recordKinds.has(rule) || (Array.isArray(matchedOn) && matchedOn.some(m => typeof m === 'string' && materialFields.some(f => m.includes(f))))
  const byKey = new Map(files.objects.map(o => [o.fixture_key, o]))
  const provider = (k: string) => String(byKey.get(k)?.canonical.provider ?? '?')

  // 데이터셋 쪽: crosswalk 모양 사람 링크의 간선
  const before = new Map<string, Edge>()
  const unshapedMembers = new Set<string>()
  // 견주지 않은 데이터셋 간선이 차지한 자리(허브 계정|상대 provider) → 그 키 종류. 정규화는 그 자리에 다른 종류를 잇지 않는다(link_one_per_provider)
  const taken = new Map<string, string>()
  for (const link of files.links) {
    const kind = link.meta?.kind
    if (kind === 'group' || kind === 'automation' || link.level === 'different') continue
    const edges = link.meta?.edges
    const shaped = Array.isArray(edges) && edges.length > 0 && edges.every(e => kinds.includes(e?.rule) && Array.isArray(e.matched_on) && typeof e.matched_on[0] === 'string' && e.matched_on[0].includes(' = '))
    if (!shaped) { out.not_crosswalk += 1; for (const m of link.set) unshapedMembers.add(m.object_key); continue }
    for (const e of edges as Array<Edge & { matched_on: unknown }>) {
      if (unreproducible(e.rule, e.matched_on)) { out.skipped += 1; if (cw.link_one_per_provider) taken.set(`${e.a}|${provider(e.b)}`, e.rule); continue }
      before.set(`${e.a}|${e.b}|${e.rule}`, e)
    }
  }

  // 지금 crosswalk
  const after = new Map<string, Edge>()
  for (const e of currentLinkEdges(files, cw)) {
    if (e.material || recordKinds.has(e.rule)) continue
    if (unshapedMembers.has(e.a)) { out.now_unshaped += 1; continue }
    const slot = taken.get(`${e.a}|${provider(e.b)}`)
    if (slot && slot !== e.rule) { out.now_shadowed += 1; continue }
    after.set(`${e.a}|${e.b}|${e.rule}`, e)
  }

  const bump = (e: Edge, field: 'added' | 'removed' | 'level_changed') => {
    const key = `${provider(e.a)}-${provider(e.b)}`
    out.by_providers[key] ??= { added: 0, removed: 0, level_changed: 0 }
    out.by_providers[key][field] += 1
    out[field] += 1
  }
  out.compared = before.size
  out.now = after.size
  for (const [k, e] of after) {
    const old = before.get(k)
    if (!old) bump(e, 'added')
    else if (old.level !== e.level) bump(e, 'level_changed')
  }
  for (const [k, e] of before) if (!after.has(k)) bump(e, 'removed')

  // 한 사람 링크(허브 하나 = 링크 하나)에 같이 드는 계정 쌍. 단계는 보지 않는다
  const pairs = (edges: Iterable<Edge>) => {
    const groups = new Map<string, Set<string>>()
    for (const e of edges) (groups.get(e.a) ?? groups.set(e.a, new Set([e.a])).get(e.a)!).add(e.b)
    const set = new Set<string>()
    for (const members of groups.values()) {
      const list = [...members].sort()
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) set.add(`${list[i]}|${list[j]}`)
    }
    return set
  }
  const p0 = pairs(before.values())
  const p1 = pairs(after.values())
  for (const p of p1) if (!p0.has(p)) out.pairs_gained += 1
  for (const p of p0) if (!p1.has(p)) out.pairs_lost += 1
  const sorted: LinkStaleness['by_providers'] = {}
  for (const k of Object.keys(out.by_providers).sort()) sorted[k] = out.by_providers[k]
  out.by_providers = sorted
  return out
}

/**
 * 게시 로그용 한 줄. 링크가 지금 crosswalk 와 같거나 견줄 간선이 없으면 null. 데이터셋을 읽거나 견주다 실패해도 게시는 막지 않고
 * 까닭만 돌려준다(fromCurrent.ts effectiveAccessDrift 와 같은 원칙). 게시를 막을지는 미결이다.
 * fromCurrent 면 --from-current 가 EA 는 다시 계산해도 링크는 스냅샷 것을 그대로 쓴다고 덧붙인다
 */
export function linkStalenessWarning(dir: string, opts: { fromCurrent?: boolean; crosswalk?: ReturnType<typeof loadCrosswalk> } = {}): string | null {
  let s: LinkStaleness
  try {
    s = linkStaleness(readDatasetFiles(dir), opts.crosswalk)
  } catch (err) {
    return `동일인 링크가 지금 정규화 규칙과 같은지 확인하지 못했다(${err instanceof Error ? err.message : String(err)})`
  }
  const how = opts.fromCurrent ? '--from-current 는 EA 를 다시 계산해도 링크는 스냅샷 것을 그대로 쓴다' : '게시는 데이터셋 링크를 그대로 올린다'
  const unshaped = s.not_crosswalk && s.now_unshaped
    ? `동일인 링크 ${s.not_crosswalk}개가 옛 정규화나 합성 모양이라 지금 규칙과 견주지 못했다(지금 규칙으로는 그 사람들에게 계정 연결 ${s.now_unshaped}개)`
    : ''
  if (!s.added && !s.removed && !s.level_changed) return unshaped ? `${unshaped}. ${how}. 지금 정규화로 다시 만든 데이터셋이면 견줄 수 있다` : null
  const by = Object.entries(s.by_providers).map(([k, v]) => `${k} ${[v.added ? `+${v.added}` : '', v.removed ? `-${v.removed}` : '', v.level_changed ? `단계 ${v.level_changed}` : ''].filter(Boolean).join(' ')}`).join(', ')
  const skipped = s.skipped ? `, 원본이 있어야 다시 만들 수 있어 견주지 않은 연결 ${s.skipped}` : ''
  return `동일인 링크가 지금 정규화 규칙(crosswalk)으로 다시 이은 결과와 다르다: 계정 연결 더할 ${s.added}, 없앨 ${s.removed}, 단계 바뀜 ${s.level_changed} (${by}), 한 링크에 같이 드는 계정 쌍(단계 무관) +${s.pairs_gained} -${s.pairs_lost}${skipped}` +
    `${unshaped ? `. ${unshaped}` : ''}. ${how}. EA 와 판정도 그 링크로 계산된다. 정규화를 다시 돌려 링크를 새로 만들면 맞춰진다`
}
