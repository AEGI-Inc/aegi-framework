/**
 * 접근 규칙 실행기 — 뼈대 (EA 일반화)
 *
 * 개념 사전 사본 ontology/access_rules.yaml 의 규칙을 읽어 Effective Access 행을 만든다. 운영 EA 는 production.ts 의 규칙만
 * 이 실행기로 계산한다(규칙 파일의 status 가 production 인 줄).
 *
 * 형식은 aegi-knowledge schema/specs/Path_Rule_Schema_v1.md 다. 지금 읽는 것:
 *   홉        relation(reverse, from_interface, to_interface), edge: G(from_interface, to_interface, skip_uncertain 사유를 단 간선은 건너뜀, relation_to_interface 간선을 낸 관계의 도착,
 *             scopes_of 토큰 scope 가 덮는 간선만. src/detection/v2/engine/tokenScopes.ts, skip_caps_only 능력이 그 목록 안에만 있는 간선은 건너뜀
 *             — 로그인 · 동의만 주는 부여, automation_scope 그 자동화의 범위 안에 도착하는 간선만.
 *             사전 automation_scopes, engine/accessModel.ts automationScopeReaches), ref(객체 참조 칸, to_interface),
 *             item(객체 속성 목록의 한 줄. 식의 자리 $이름 으로 줄 칸을 읽는다). ref, item 은 관계가 아니라 via 에 들지 않고 회수 지점이 아니다.
 *             link(any, strong. 손코드 linkVias 로 약한 간선은 하나까지, different 와 그룹 링크는 건너지 않는다), gap(저장된 사실이 없는 구간.
 *             via 에 들지 않고 앞뒤 via 사이의 못 푼 구간 x_gap 이 되며 결론은 indeterminate). 관계 홉의 else_gap 은 그 관계가 없을 때
 *             (양 끝이 이미 묶였을 때만) 그 자리를 같은 빈 구간으로 본다
 *   갈래      any_of(path 대신, 또는 path 안의 한 자리). 갈래마다 그 갈래의 홉을 이어 붙여 따로 묶고 결론 행도 따로 낸다
 *   질문 모드  mode question 규칙은 질문(AccessQuestion)이 있을 때만 돈다. 질문은 변수 몇 개를 묶어 주고, 홉에 설 관계를 좁힐 수 있다
 *             (물은 역할 같은 것). 무엇을 묻는지는 규칙 밖이다. 운영 규칙에는 질문 모드가 없다.
 *             「없다」(denied)는 내지 않는다(형식은 수집이 닫혔을 때만 내라고 정했지만 실행기는 아직 그것을 보지 않는다)
 *   닿음 핵심 관계 홉과 G 홉은 위협 간선 위의 질의면(src/detection/v2/engine/reach.ts)에서 받는다. 관계 행의 뜻(효과, 조건 갈래, interface 칸)은
 *             효과 표 읽기(relationEffects.ts) 하나가 정한다. 이 실행기는 규칙이 적은 길 모양만 고른다(EA 거름).
 *   칸        distinct, where, skip_if, uncertain_if, undecomposed_if, cut, yields(holders 는 item 줄마다 x_holders 하나)
 *   공통 규칙  조건 갈래(그 칸의 갈래가 효과 없음이면 그 칸으로는 홉이 서지 않고, 불확실이면 사유를 결론에 남기고 단계를
 *             내린다. 「결론 강도」의 빈 구간, 약한 Link, uncertain_if 도 내린다. undecomposed_if 는 내리지 않는다), 부정을 먼저 본다(역할의 excludes), 회수 지점은
 *             stated 관계 홉만, 벤더가 합친 관계의 못 푼 구간을 물려준다, Link 를 탔거나 SaaS 를 넘는 관계 홉이면 computed_cross
 *             (Path_Rule_Schema_v1 「정한 것」과 lint.ts 의 단계 검사를 따른다. 같은 명세 공통 규칙 표는 「Link 를 타서 provider 를 건너면」이라 두 곳이 갈린다)
 * 못 읽는 것(건너뛰고 까닭을 남긴다): 모르는 홉 종류와 mode, G 가 아닌 간선 홉, 첫 홉이 관계 홉이 아님, 관계 홉이 아니거나 첫, 끝 홉의
 * else_gap, 끝 홉이 gap, via 에 드는 홉이 아닌 곳을 가리키는 uncertain_if, undecomposed_if, cut, path 와 any_of 를 같이 쓰거나 갈래가 목록이 아님. G 효과 가운데 from 이 grant, everyone 인 것(관계 양 끝이 아닌 출발)은 아직 따라가지 않는다.
 * 개념 사전에 없는 것은 지어내지 않는다. 그룹 소속의 집행 표시는 부여 관계 행의 속성 membership_enforced 라($h: {property: ...})
 * 다른 속성 검사와 같이 match.ts 가 본다. 값이 없는 부여는 「모름」이다(정규화가 Profile 관계 선언의 값을 행에 싣는다).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import type { GraphStoreV2 } from '../../src/model/graph'
import type { ResolvedRelation } from '../../src/model/relation'
import { holds, MatchCtx, roleMatchKey, type MatchObject, type MatchRelation } from '../collect/shared/match'
import { CONTAINER_BOUND_AUTOMATIONS, ENTRY_POINTS, OPEN_RESPONDENT_RESOURCES, VISIBILITY_SCOPED, automationScopeReaches } from '../../src/detection/v2/engine/accessModel'
import { inheritedUndecomposed, isRevocable, linkVias, makeRow, nameOf, relationVia, weakLinkUndecomposed, type RowContext } from '../../src/detection/v2/effectiveAccess/common'
import type { EaCut, EaLinkVia, EaUndecomposed, EaVia, EffectiveAccessRow } from '../../src/detection/v2/effectiveAccess/types'
import { levelGrade } from '../../src/detection/v2/identity'
import { ReachCore } from '../../src/detection/v2/engine/reach'
import { EdgeIndex } from '../../src/detection/v2/engine/edges'
import { scopeAllows, scopeReach, scopesOf } from '../../src/detection/v2/engine/tokenScopes'
import { edgeCaps } from '../../src/detection/v2/engine/semantic/ceiling'
import { buildEvidenceStore } from '../../src/data/datasetStore'

export const ONTOLOGY = fileURLToPath(new URL('../../ontology', import.meta.url))

type Expr = Record<string, any>
interface Emit { kind: string; from: string; to: string; uncertain?: string[] }
interface Semantics { effects?: Array<{ pairs: string[]; emits: Emit[] }>; conditions?: Array<{ name: string; match?: Expr; cases: Array<{ pair: string; emits: Emit[] }> }> }
export interface AccessRule { id: string; mode: string; path?: Expr[]; any_of?: unknown; [k: string]: any }

/** 토큰이 scope 만큼 닿는 것(간선 홉 scopes_of). 행의 x_capability 가 된다 */
type Capability = NonNullable<EffectiveAccessRow['x_capability']>
/** 홉 하나가 묶은 관계와, 그 칸의 조건 갈래나 효과가 남긴 불확실 사유. scopes_of 홉이면 토큰이 그 간선으로 할 수 있는 것 */
interface Hop { rel: ResolvedRelation; uncertain: string[]; capability?: Capability }
/** via 에 드는 순서대로 적은 홉. 관계 홉은 via 한 칸, link 홉은 링크 간선 수만큼, gap 은 via 에 들지 않는다 */
type Step = { kind: 'relation' | 'link'; name: string } | { kind: 'gap'; name: string; reason: string }
/** 경로가 묶은 것. objs 는 변수 → 객체 키, hops 는 관계 홉, items 는 item 홉이 고른 줄, links 는 link 홉의 링크 간선 */
interface Binding { objs: Record<string, string>; hops: Record<string, Hop>; items: Record<string, MatchObject>; links: Record<string, EaLinkVia[]>; steps: Step[]; resolved: string[] }

/** scopes_of 홉이 scope 를 펴면 풀리는 사유(대행 간선의 「scope 만큼」. relation_semantics.yaml authenticates_with.app_refresh_token) */
const SCOPE_RESOLVES = ['token_scope_limited']

/**
 * 질문 모드 규칙에 묻는 것. bind 는 질문이 정해 준 변수(이름 앞의 $ 는 있어도 없어도 된다), accept 는 홉 이름마다 그 홉에 설 관계 조건
 * (규칙 파일에 칸이 없는 「물은 역할」 같은 것). askedBy 는 행의 x_asked_by(없으면 ACCESS_RULES)
 */
export interface AccessQuestion {
  rule: string
  bind: Record<string, string>
  accept?: Record<string, (rel: ResolvedRelation) => boolean>
  askedBy?: { rule_id: string; check_id?: string }
}

export interface RunResult {
  rows: EffectiveAccessRow[]
  /** 읽지 못해 건너뛴 규칙과 까닭 */
  skipped: Array<{ rule: string; why: string }>
  /** 질문 모드 규칙 가운데 질문이 하나도 오지 않아 돌지 않은 것(건너뛴 것과 다르다) */
  unasked: string[]
  /**
   * 「모름」으로 둔 것. 같은 것은 한 번만. 사전에 없던 집행 표(enforced)를 적던 칸인데, 집행 표시가 관계 행 속성이 되어(2026-10-30)
   * 지금은 채우는 곳이 없다. 결과 모양을 바꾸지 않으려 칸은 남겨 둔다
   */
  unknowns: string[]
}

/**
 * 파일마다 마지막으로 읽은 글과 그 풀이. YAML 풀이가 EA 계산 시간의 대부분이라(운영 EA 한 번에 수십 ms, 손코드는 1ms 안) 글이 같으면 풀이를 다시 쓴다.
 * 파일은 부를 때마다 읽어 글을 견주므로, 파일이 바뀌면 바로 새로 푼다. 여럿이 같은 풀이를 받으므로 얼려 둔다(고치면 TypeError)
 */
const parsedYaml = new Map<string, { text: string; value: unknown }>()

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

function readYaml(file: string): any {
  const text = fs.readFileSync(file, 'utf8')
  const hit = parsedYaml.get(file)
  if (hit?.text === text) return hit.value
  const value = deepFreeze(parse(text))
  parsedYaml.set(file, { text, value })
  return value
}

export function loadRules(dir = ONTOLOGY): readonly AccessRule[] {
  return (readYaml(path.join(dir, 'access_rules.yaml')) as { rules: readonly AccessRule[] }).rules
}

export function loadSemantics(dir = ONTOLOGY): Readonly<Record<string, Semantics>> {
  return (readYaml(path.join(dir, 'relation_semantics.yaml')) as { relations: Readonly<Record<string, Semantics>> }).relations
}

const HOP_KINDS = new Set(['relation', 'edge', 'ref', 'item', 'link', 'gap'])
/**
 * 홉에 쓸 수 있는 칸 전부(홉 종류 이름 포함). 모르는 칸이 있는 규칙은 못 읽는 규칙이다 — 조용히 건너뛰면 그 칸이 거르던 행이 되살아난다.
 * aegi-knowledge schema/validation/check_path_rules.py HOP_KEYS 와 같아야 한다(scripts/accessRulesExecutor.test.ts 가 대 본다)
 */
export const HOP_KEYS: ReadonlySet<string> = new Set([
  ...HOP_KINDS,
  'as', 'from', 'to', 'reverse', 'why', 'from_interface', 'to_interface', 'else_gap', 'skip_uncertain', 'relation_to_interface', 'scopes_of', 'skip_caps_only', 'automation_scope',
])
const MODES = new Set(['general', 'question'])

/** 이 규칙을 지금 실행기로 읽을 수 있나. 못 읽으면 까닭 */
export function unsupported(rule: AccessRule): string | undefined {
  if (!MODES.has(rule.mode)) return `mode ${rule.mode}`
  if (rule.path && rule.any_of) return 'path 와 any_of 를 같이 썼다(any_of 는 path 대신 쓰거나 path 안의 한 자리에 둔다)'
  // first: 이 홉 목록의 맨 앞이 경로 전체의 첫 홉인가(any_of 가 맨 앞이면 갈래마다 첫 홉이 있다)
  const check = (hops: Expr[], first: boolean): string | undefined => {
    for (const [i, hop] of hops.entries()) {
      if ('any_of' in hop) {
        if (!Array.isArray(hop.any_of) || !hop.any_of.every(Array.isArray)) return 'any_of 의 갈래가 홉 목록이 아니다'
        for (const branch of (hop.any_of ?? []) as Expr[][]) {
          const why = check(branch, first && i === 0)
          if (why) return why
        }
        continue
      }
      const kind = ['relation', 'edge', 'link', 'ref', 'item', 'gap'].find(k => k in hop)
      if (!kind || !HOP_KINDS.has(kind)) return `${kind ?? '모르는'} 홉`
      const unknownKeys = Object.keys(hop).filter(k => !HOP_KEYS.has(k))
      if (unknownKeys.length) return `${kind} 홉의 모르는 칸 ${unknownKeys.join(', ')}`
      if (hop.else_gap && kind !== 'relation') return `${kind} 홉의 else_gap(관계 홉에만 단다)`
      if (hop.else_gap && first && i === 0) return '첫 홉의 else_gap(앞 via 가 없어 빈 구간의 자리를 못 적는다)'
      if (kind === 'edge' && hop.edge !== 'G') return `${hop.edge} 간선 홉`
      if (hop.skip_uncertain && (kind !== 'edge' || !Array.isArray(hop.skip_uncertain))) return `${kind} 홉의 skip_uncertain(간선 홉에 사유 목록으로만 단다)`
      if (hop.relation_to_interface && kind !== 'edge') return `${kind} 홉의 relation_to_interface(간선 홉에만 단다)`
      if (hop.skip_caps_only && (kind !== 'edge' || !Array.isArray(hop.skip_caps_only) || !hop.skip_caps_only.length)) return `${kind} 홉의 skip_caps_only(간선 홉에 능력 이름 목록으로만 단다)`
      if (hop.scopes_of && (kind !== 'edge' || !/^\$\w+$/.test(String(hop.scopes_of)))) return `${kind} 홉의 scopes_of(간선 홉에 앞에서 묶인 변수 $이름 으로만 단다)`
      if (hop.automation_scope && (kind !== 'edge' || !/^\$\w+$/.test(String(hop.automation_scope)))) return `${kind} 홉의 automation_scope(간선 홉에 앞에서 묶인 변수 $이름 으로만 단다)`
      if (kind !== 'relation' && first && i === 0) return `첫 홉이 ${kind} 홉(시작점을 고르지 못한다)`
    }
    return undefined
  }
  const top = pathOf(rule)
  const why = check(top, true)
  if (why) return why
  const ends = lastHops(top)
  if (ends.some(h => 'gap' in h)) return '끝 홉이 gap 홉(뒤 via 가 없어 빈 구간의 자리를 못 적는다)'
  if (ends.some(h => h.else_gap)) return '끝 홉의 else_gap(뒤 via 가 없어 빈 구간의 자리를 못 적는다)'
  // 칸이 가리키는 홉: 못 푼 구간과 판정 보류는 via 에 드는 홉(관계, 간선, link)에, 회수 지점은 관계 행이 있는 홉(관계, 간선)에만 단다
  const hops = flatHops(top)
  const viaHops = new Set(hops.filter(h => 'relation' in h || 'edge' in h || 'link' in h).map(h => h.as))
  const relHops = new Set(hops.filter(h => 'relation' in h || 'edge' in h).map(h => h.as))
  for (const u of [...(rule.uncertain_if ?? []), ...(rule.undecomposed_if ?? [])]) if (!viaHops.has(u.hop)) return `${u.reason} 의 홉 ${u.hop} 이 via 에 드는 홉이 아니다`
  for (const c of rule.cut ?? []) if (!relHops.has(c.hop)) return `cut 의 홉 ${c.hop} 이 관계 홉이 아니다`
  return undefined
}

/** 규칙의 홉 목록. path 대신 any_of 를 쓴 규칙은 그 갈래들을 한 자리로 */
const pathOf = (rule: AccessRule): Expr[] => rule.path ?? (rule.any_of ? [{ any_of: rule.any_of }] : [])
/** 갈래까지 편 홉 전부(이름과 변수 검사용) */
const flatHops = (hops: Expr[]): Expr[] => hops.flatMap(h => ('any_of' in h ? ((h.any_of ?? []) as Expr[][]).flatMap(flatHops) : [h]))
/** 경로 끝에 오는 홉들(끝 자리가 any_of 면 갈래마다의 끝 홉) */
const lastHops = (hops: Expr[]): Expr[] => {
  const last = hops[hops.length - 1]
  return !last ? [] : 'any_of' in last ? ((last.any_of ?? []) as Expr[][]).flatMap(lastHops) : [last]
}

/** 질문이 규칙에 맞나: bind 는 규칙의 변수, accept 는 관계 홉(간선 홉 포함) 이름이어야 한다. 아니면 질문을 만드는 쪽의 잘못이라 멈춘다 */
function checkQuestion(rule: AccessRule, q: AccessQuestion): void {
  const hops = flatHops(pathOf(rule))
  const vars = new Set(hops.flatMap(h => [h.from, h.to]).filter((v): v is string => typeof v === 'string').map(v => v.replace(/^\$/, '')))
  const relHops = new Set(hops.filter(h => 'relation' in h || 'edge' in h).map(h => h.as))
  for (const v of Object.keys(q.bind)) if (!vars.has(v.replace(/^\$/, ''))) throw new Error(`질문이 규칙 ${rule.id} 에 없는 변수 ${v} 를 묶는다`)
  for (const h of Object.keys(q.accept ?? {})) if (!relHops.has(h)) throw new Error(`질문의 홉 조건 ${h} 가 규칙 ${rule.id} 의 관계 홉이 아니다`)
}

class Executor {
  private readonly objects: Record<string, MatchObject> = {}
  private readonly relations: MatchRelation[] = []
  private readonly unknowns = new Set<string>()
  /** 조건식 in_table 이 보는 사전 표 (providers.yaml. 관계 갈래 contained_in.gws_project 가 container_bound_automations 를 본다) */
  private readonly tables: Record<string, Array<Record<string, any>>> = {
    container_bound_automations: CONTAINER_BOUND_AUTOMATIONS, visibility_scoped: VISIBILITY_SCOPED, open_respondent_resources: OPEN_RESPONDENT_RESOURCES, entry_points: ENTRY_POINTS,
  }

  /** 관계 홉과 edge: G 홉은 닿음 핵심 질의면(src/detection/v2/engine/reach.ts, 위협 간선)에서 받는다 */
  constructor(private readonly graph: GraphStoreV2, private readonly core: ReachCore) {
    for (const [k, o] of graph.objectsByKey) {
      const c = o.canonical
      const meta = (o.fixture_meta ?? {}) as Record<string, any>
      // judged_or_property 는 속성, judged, Profile 상수 차례로 본다. 오브젝트 모델 v1 은 종류로 정해지는 값을 Profile 상수에만 둔다.
      // IM Profile 정규화 묶음(지금 운영)의 상수는 im_profile 에 있다. 관계 효과(relationEffects.ts)와 같게 둘 다 읽는다(2026-11-08, 전에는 운영 데이터에서 Profile 상수 조건이 늘 거짓이었다)
      this.objects[k] = { k, p: c.provider, t: c.object_type, i: [...c.interfaces], props: c.properties, ids: c.identifiers as Record<string, unknown>, judged: (c.judged ?? {}) as Record<string, unknown>, profile: { ...meta.model_v1?.profile_constants, ...meta.im_profile?.profile_constants }, meta }
    }
    for (const r of graph.relationsByType.values()) for (const rel of r) this.relations.push({ rt: rel.relationType, s: rel.sourceKey, d: rel.targetKey, role: roleMatchKey(rel), props: rel.properties })
  }

  report(): string[] {
    return [...this.unknowns]
  }

  /** 관계 행을 조건식이 보는 자리로 (provider, property 를 본다) */
  private relPlace(rel: ResolvedRelation): MatchObject {
    return { k: rel.relationKey, p: rel.provider, t: rel.relationType, props: rel.properties }
  }

  private has(key: string, iface: string | undefined): boolean {
    return !iface || (this.objects[key]?.i ?? []).includes(iface)
  }

  /** 공통 규칙 「부정을 먼저 본다」: 역할을 거치는 홉은 그 역할이 출발을 excludes 로 빼면 서지 않는다 */
  private excluded(rel: ResolvedRelation): boolean {
    return !!rel.roleKey && (this.graph.outgoingRelationsByObject.get(rel.roleKey) ?? []).some(r => r.relationType === 'excludes' && r.targetKey === rel.sourceKey)
  }

  /**
   * relation 홉: 묶인 from 에서 그 관계를 따라간다(reverse 면 거슬러). 서는지와 사유는 닿음 핵심이 정한다(홉이 가리키는 interface 칸 가운데
   * 막히지 않은 칸이 있으면 선다. 효과 표가 그 행의 칸을 하나도 적지 않았으면 관계 행이 있는 것으로 선다). 효과 표가 도착을 리소스 세트가 덮는
   * 객체로 펼쳤으면(relationEffects.ts NARROWING_ENDS) 관계 도착 대신 그 객체들로 간다
   */
  private relationHops(hop: Expr, from: string): Array<{ to: string; h: Hop }> {
    const out: Array<{ to: string; h: Hop }> = []
    const rels = hop.reverse ? this.graph.incomingRelationsByObject.get(from) ?? [] : this.graph.outgoingRelationsByObject.get(from) ?? []
    for (const rel of rels) {
      if (rel.relationType !== hop.relation) continue
      const to = hop.reverse ? rel.sourceKey : rel.targetKey
      if (!this.has(to, hop.to_interface) || this.excluded(rel)) continue
      const [srcWant, tgtWant] = hop.reverse ? [hop.to_interface, hop.from_interface] : [hop.from_interface, hop.to_interface]
      const s = this.core.relation(rel, srcWant, tgtWant)
      if (!s.stands) continue
      // 효과 표가 도착을 펼친 대상(리소스 세트가 덮는 객체)으로 적었으면 그 대상들이 홉의 도착이다. 위협 간선과 같은 펴기(reach.ts targets)
      if (s.targets && !hop.reverse) {
        for (const t of s.targets) if (this.has(t.to, hop.to_interface)) out.push({ to: t.to, h: { rel, uncertain: t.uncertain } })
        continue
      }
      out.push({ to, h: { rel, uncertain: s.uncertain } })
    }
    return out
  }

  /**
   * edge: G 홉: 닿음 핵심의 설정 층 G 간선 가운데 관계 행이 출처인 것(객체 참조, 사전 표 규칙, 관측 출처는 EA 길이 아니다).
   * relation_to_interface 는 간선을 낸 관계의 도착 interface(조직에 걸린 역할이 리소스 세트로 좁혀져 도착이 덮는 대상이어도 그 역할이다).
   * scopes_of 는 묶인 토큰의 scope 가 덮는 간선만 고른다(tokenScopes.ts). scope 표의 through 도 관계 도착 interface 로 본다.
   * 아는 scope 가 덮지 않아도 표에 없는 scope 가 있으면 그 간선을 token_scope_unmapped 사유와 함께 따라간다(놓치는 것보다 넓게 잡는다)
   */
  private gHops(hop: Expr, from: string, objs: Record<string, string>): Array<{ to: string; h: Hop }> {
    const out: Array<{ to: string; h: Hop }> = []
    const seen = new Set<string>()
    if (!this.has(from, hop.from_interface)) return out
    const relTo = (rel: ResolvedRelation, iface: string) => this.has(rel.targetKey, iface)
    let reach: ReturnType<typeof scopeReach>
    if (hop.scopes_of) {
      const tokenKey = objs[String(hop.scopes_of).slice(1)]
      const token = tokenKey ? this.graph.objectsByKey.get(tokenKey) : undefined
      const scopes = scopesOf(token)
      reach = token && scopes ? scopeReach(token.canonical.provider, scopes) : undefined
      if (!reach) {
        if (token) this.unknowns.add(`scope 표에 ${token.canonical.provider} 가 없거나 토큰에 scope 칸이 없다 (${token.canonical.object_type})`)
        return out
      }
    }
    // 차례는 from 의 나가는 관계, 들어오는 관계 차례다(간선 차례는 관계 행 전체의 차례라, 그대로 쓰면 효과 표를 따로 읽던 때와 행 차례가 갈린다)
    const rels = [...(this.graph.outgoingRelationsByObject.get(from) ?? []), ...(this.graph.incomingRelationsByObject.get(from) ?? [])]
    const rank = new Map(rels.map((r, i) => [r.relationKey, i] as const).reverse())
    const steps = this.core.out(from, 'G', 'config').filter(s => s.relation).sort((a, b) => (rank.get(a.relation!.relationKey) ?? 1e9) - (rank.get(b.relation!.relationKey) ?? 1e9))
    const skip = new Set<string>(Array.isArray(hop.skip_uncertain) ? hop.skip_uncertain.map(String) : [])
    const scopedBy = hop.automation_scope ? objs[String(hop.automation_scope).slice(1)] : undefined
    // 능력이 이 목록 안에만 있는 간선(로그인 · 동의만 주는 부여)은 건너뛴다. 능력을 모르는 간선은 따라간다
    const capsOnly = new Set<string>(Array.isArray(hop.skip_caps_only) ? hop.skip_caps_only.map(String) : [])
    for (const s of steps) {
      if (!s.relation || this.excluded(s.relation) || !this.has(s.to, hop.to_interface)) continue
      if (scopedBy && !automationScopeReaches(this.graph, scopedBy, s.to)) continue
      if (s.uncertain.some(u => skip.has(u))) continue
      if (capsOnly.size) {
        const caps = edgeCaps(s.edge)
        if (caps?.length && caps.every(c => capsOnly.has(c))) continue
      }
      if (hop.relation_to_interface && !relTo(s.relation, hop.relation_to_interface)) continue
      let capability: Capability | undefined
      let uncertain = s.uncertain
      if (reach) {
        if (reach.through.length && !reach.through.some(i => relTo(s.relation!, i))) continue
        const target = this.graph.objectsByKey.get(s.to)
        const allowed = scopeAllows(reach, target, s.edge)
        // 표에 없는 scope 는 표에 있는 자원 마디가 아니라서 표가 아는 객체 종류(사용자, 그룹, 앱 …)를 덮지 못한다. 조직 설정 안의 무엇을 건드리는지만 모른다
        if (!allowed && (!reach.unmapped.length || !this.has(s.to, 'Tenant'))) continue
        capability = allowed
          ? { rank: allowed.rank, object_types: allowed.objectTypes, scopes: allowed.scopes, ...(reach.unmapped.length ? { unmapped: reach.unmapped } : {}) }
          : { rank: 0, object_types: [], scopes: [], unmapped: reach.unmapped }
        if (!allowed) uncertain = [...uncertain, 'token_scope_unmapped']
      }
      const k = `${s.relation.relationKey}>${s.to}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ to: s.to, h: { rel: s.relation, uncertain, ...(capability ? { capability } : {}) } })
    }
    return out
  }

  /** ref 홉: 묶인 from 객체의 참조 칸(references.<칸>)이 가리키는 객체 가운데 그래프에 있는 것 */
  private refTargets(from: string, slot: string): string[] {
    const targets = this.graph.objectsByKey.get(from)?.canonical.references?.[slot]?.targets ?? []
    return [...new Set(targets.map(t => String(t.value)).filter(k => this.graph.objectsByKey.has(k)))]
  }

  /** item 홉: 묶인 from 객체의 속성 목록(예: properties.permissions)의 줄. 줄 키는 `객체 키#줄 id` 다(손코드 dynamicHolder.ts schemeLines 와 같다) */
  private itemsOf(from: string, at: string): MatchObject[] {
    const canonical = this.graph.objectsByKey.get(from)?.canonical as Record<string, any> | undefined
    const list = String(at).split('.').reduce<any>((v, k) => (v == null ? undefined : v[k]), canonical)
    return (Array.isArray(list) ? list : []).filter(x => x && typeof x === 'object').map(x => ({ k: `${from}#${x.id ?? ''}`, p: canonical?.provider, t: 'item', props: x }))
  }

  /** 관계 홉의 양 끝 사이에 그 종류의 관계 행이 있나(거르기 전). else_gap 이 본다 */
  private relationBetween(hop: Expr, from: string, to: string): boolean {
    const rels = hop.reverse ? this.graph.incomingRelationsByObject.get(from) ?? [] : this.graph.outgoingRelationsByObject.get(from) ?? []
    return rels.some(r => r.relationType === hop.relation && (hop.reverse ? r.sourceKey : r.targetKey) === to)
  }

  /**
   * link 홉: 묶인 from 의 동일인 링크로 같은 묶음의 다른 계정에 간다. 길은 손코드 linkVias(약한 간선은 하나까지)이고, strong 이면 길의
   * 간선이 모두 strong 이어야 한다. different 링크와 그룹 링크(meta.kind group, 같은 주체가 아니다)는 건너지 않는다(손코드 identityVias 와 같다)
   */
  private linkHops(hop: Expr, from: string): Array<{ to: string; vias: EaLinkVia[] }> {
    const out: Array<{ to: string; vias: EaLinkVia[] }> = []
    const seen = new Set<string>()
    for (const id of this.graph.linkIdsByObject.get(from) ?? []) {
      const link = this.graph.linksById.get(id)
      if (!link || link.level === 'different' || link.meta?.kind === 'group') continue
      for (const m of link.set) {
        if (m.object_key === from) continue
        const vias = linkVias(link, from, m.object_key)
        if (!vias.length || (hop.link === 'strong' && vias.some(v => v.suspected || levelGrade(v.level) !== 'strong'))) continue
        const k = `${m.object_key}|${JSON.stringify(vias)}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ to: m.object_key, vias })
      }
    }
    return out
  }

  /**
   * 경로를 처음부터 묶는다. 첫 홉(관계 홉)의 from 은 질문이 묶어 줬으면 그것, 아니면 그 관계의 출발 전부에서 시작한다.
   * 그 뒤의 홉은 앞에서 묶인 from 에서만 간다(묶이지 않았으면 서지 않는다. 출발 전부로 퍼지지 않게). gap 홉은 묶지 않고 자리만 적으므로
   * 그 to 는 뒤 홉의 to 로 묶여야 한다
   */
  private *bind(rule: AccessRule, q?: AccessQuestion): Generator<Binding> {
    const self = this
    const accept = q?.accept ?? {}
    function* walk(path: Expr[], b: Binding, first: boolean): Generator<Binding> {
      if (!path.length) return yield b
      const [hop, ...rest] = path
      // any_of: 갈래마다 그 갈래의 홉을 남은 경로 앞에 이어 붙여 따로 묶는다(갈래마다 결론 행이 따로 나온다)
      if ('any_of' in hop) {
        for (const branch of hop.any_of as Expr[][]) yield* walk([...branch, ...rest], b, first)
        return
      }
      const fromVar = String(hop.from).slice(1)
      const toVar = String(hop.to).slice(1)
      if ('item' in hop) {
        if (b.objs[fromVar] === undefined) return
        for (const line of self.itemsOf(b.objs[fromVar], hop.item)) yield* walk(rest, { ...b, items: { ...b.items, [hop.as]: line } }, false)
        return
      }
      if ('gap' in hop) return yield* walk(rest, { ...b, steps: [...b.steps, { kind: 'gap', name: hop.as, reason: hop.gap }] }, false)
      if ('link' in hop) {
        if (b.objs[fromVar] === undefined) return
        for (const { to, vias } of self.linkHops(hop, b.objs[fromVar])) {
          if (!self.has(to, hop.to_interface) || (b.objs[toVar] !== undefined && b.objs[toVar] !== to)) continue
          yield* walk(rest, { ...b, objs: { ...b.objs, [toVar]: to }, links: { ...b.links, [hop.as]: vias }, steps: [...b.steps, { kind: 'link', name: hop.as }] }, false)
        }
        return
      }
      if ('ref' in hop) {
        if (b.objs[fromVar] === undefined) return
        for (const to of self.refTargets(b.objs[fromVar], hop.ref)) {
          if (!self.has(to, hop.to_interface) || (b.objs[toVar] !== undefined && b.objs[toVar] !== to)) continue
          yield* walk(rest, { ...b, objs: { ...b.objs, [toVar]: to } }, false)
        }
        return
      }
      if (b.objs[fromVar] === undefined && !first) return
      const starts = b.objs[fromVar] !== undefined ? [b.objs[fromVar]]
        : [...new Set((self.graph.relationsByType.get(hop.relation) ?? []).map(r => (hop.reverse ? r.targetKey : r.sourceKey)))]
      for (const from of starts) {
        if (!self.has(from, hop.from_interface)) continue
        const next = 'edge' in hop ? self.gHops(hop, from, b.objs) : self.relationHops(hop, from)
        for (const { to, h } of next) {
          if (b.objs[toVar] !== undefined && b.objs[toVar] !== to) continue
          if (accept[hop.as] && !accept[hop.as](h.rel)) continue
          const resolved = h.capability ? [...new Set([...b.resolved, ...SCOPE_RESOLVES])] : b.resolved
          yield* walk(rest, { ...b, objs: { ...b.objs, [fromVar]: from, [toVar]: to }, hops: { ...b.hops, [hop.as]: h }, steps: [...b.steps, { kind: 'relation', name: hop.as }], resolved }, false)
        }
      }
      // else_gap: 양 끝이 이미 묶였는데 그 사이에 그 관계 행이 하나도 없으면(interface, 조건 갈래로 거르기 전에) 그 자리를 빈 구간으로 본다.
      // 관계는 있는데 홉이 서지 않으면 빈 구간이 아니다. 끝이 안 묶였으면 뒤 홉이 시작점을 잃으므로 잇지 않는다
      if (hop.else_gap && b.objs[fromVar] !== undefined && b.objs[toVar] !== undefined && !self.relationBetween(hop, b.objs[fromVar], b.objs[toVar])) {
        yield* walk(rest, { ...b, steps: [...b.steps, { kind: 'gap', name: hop.as, reason: hop.else_gap }] }, false)
      }
    }
    const bound = Object.fromEntries(Object.entries(q?.bind ?? {}).map(([v, k]) => [v.replace(/^\$/, ''), k]))
    yield* walk(pathOf(rule), { objs: bound, hops: {}, items: {}, links: {}, steps: [], resolved: [] }, true)
  }

  private ctx(b: Binding): MatchCtx {
    const places: Record<string, MatchObject | undefined> = {}
    for (const [v, k] of Object.entries(b.objs)) places[`$${v}`] = places[v] = this.objects[k]
    for (const [h, hop] of Object.entries(b.hops)) {
      places[`$${h}`] = places[h] = this.relPlace(hop.rel)
      if (hop.rel.roleKey) places[`${h}.role`] = this.objects[hop.rel.roleKey]
      // 이름만 있는 역할(Okta 앱 배정 assigned 등)은 객체가 없어 이름 자리만 둔다. exists_relation.role 이 같은 이름의 관계 행과 대 본다
      else if (hop.rel.roleName) places[`${h}.role`] = { k: `name:${hop.rel.roleName}`, p: hop.rel.provider, t: 'role_name' }
    }
    for (const [name, line] of Object.entries(b.items)) places[`$${name}`] = places[name] = line
    return new MatchCtx(places, this.relations, this.tables, this.objects)
  }

  /** match.py 식. 칸이 없으면 언제나 */
  private test(expr: Expr | undefined, ctx: MatchCtx): boolean {
    return !expr || holds(expr, ctx)
  }

  run(rule: AccessRule, rowCtx: RowContext, q?: AccessQuestion): EffectiveAccessRow[] {
    const rows: EffectiveAccessRow[] = []
    for (const b of this.bind(rule, q)) {
      const distinct = (rule.distinct ?? []).map((v: string) => b.objs[v.slice(1)]).filter((k: string | undefined) => k !== undefined)
      if (new Set(distinct).size !== distinct.length) continue
      const ctx = this.ctx(b)
      if (rule.skip_if && this.test(rule.skip_if, ctx)) continue
      if (rule.where && !this.test(rule.where, ctx)) continue
      // via 는 홉 순서대로. 관계 홉 한 칸, link 홉은 그 링크 간선들. gap 은 via 에 들지 않고 앞뒤 via 사이의 못 푼 구간이 된다
      const via: EaVia[] = []
      const at: Record<string, number> = {}
      const gaps: EaUndecomposed[] = []
      for (const s of b.steps) {
        if (s.kind === 'gap') {
          gaps.push({ at: 'x_gap', x_between: [via.length - 1, via.length], from: 'computation', reason: s.reason } as EaUndecomposed)
          continue
        }
        at[s.name] = via.length
        if (s.kind === 'relation') via.push(relationVia(b.hops[s.name].rel, this.graph))
        else via.push(...b.links[s.name])
      }
      const index = (h: string) => at[h]
      const undecomposed: EaUndecomposed[] = []
      const add = (u: EaUndecomposed) => {
        const k = (x: EaUndecomposed) => `${x.at}|${'x_between' in x ? x.x_between.join('-') : ''}|${'reason' in x ? x.reason : ''}|${'vendor_paths' in x ? JSON.stringify(x.vendor_paths) : ''}`
        if (!undecomposed.some(x => k(x) === k(u))) undecomposed.push(u)
      }
      // 결론 강도: 빈 구간이 있거나 약한 Link 를 지나면 indeterminate(그 링크 간선은 못 푼 구간에 남긴다)
      gaps.forEach(add)
      const weak = weakLinkUndecomposed(via, this.graph)
      weak.forEach(add)
      let uncertain = gaps.length > 0 || weak.length > 0
      for (const s of b.steps) {
        if (s.kind !== 'relation') continue
        const i = at[s.name]
        const inherited = inheritedUndecomposed(b.hops[s.name].rel, i)
        if (inherited) add(inherited)
        // 효과 표와 간선의 불확실 사유는 결론에 남기고 단계를 내린다(위협 질의의 비용 1 과 같다. 2026-11-03 구조 개편, uncertainty.yaml reason_levels).
        // 같은 길의 다른 홉이 푼 사유(scopes_of 가 편 token_scope_limited)는 뺀다
        const reasons = b.hops[s.name].uncertain.filter(u => !b.resolved.includes(u))
        for (const reason of reasons) add({ at: `via[${i}]`, from: 'computation', reason } as EaUndecomposed)
        if (reasons.length) uncertain = true
      }
      for (const u of rule.uncertain_if ?? []) {
        if (index(u.hop) === undefined || !this.test(u.when, ctx)) continue
        uncertain = true
        add({ at: `via[${index(u.hop)}]`, from: 'computation', reason: u.reason } as EaUndecomposed)
      }
      for (const u of rule.undecomposed_if ?? []) {
        if (index(u.hop) !== undefined && this.test(u.when, ctx)) add({ at: `via[${index(u.hop)}]`, from: 'computation', reason: u.reason } as EaUndecomposed)
      }
      const cut: EaCut[] = []
      for (const c of rule.cut ?? []) {
        const h = b.hops[c.hop]
        if (h && isRevocable(h.rel) && this.test(c.when, ctx)) cut.push({ via: index(c.hop), x_scope: { affects: c.affects, note: '' } })
      }
      const cross = via.some(v => v.kind === 'link' || !!v.x_cross_provider)
      const source = b.objs[String(rule.yields.source).slice(1)]
      const target = b.objs[String(rule.yields.target).slice(1)]
      const query = String(rule.yields.query ?? '').replace(/\{\$(\w+)\}/g, (_, v) => nameOf(b.objs[v], this.graph))
        .replace(/\{(\w+)\.role\}/g, (_, h) => (b.hops[h]?.rel.roleKey ? nameOf(b.hops[h].rel.roleKey!, this.graph) : b.hops[h]?.rel.roleName ?? ''))
      // 보유자(x_holders): item 줄마다 하나. 줄의 칸 이름(holder_type, permission)은 규칙 파일에 칸이 없어 손코드 dynamicHolder.ts 와 같게 읽는다
      const holders = (rule.yields.holders ?? []).flatMap((name: string) => {
        const line = b.items[name]
        if (!line) return []
        return [{ type: String(line.props?.holder_type ?? ''), grant: line.k, permission: String(line.props?.permission ?? ''), evidence: `규칙 ${rule.id} 의 줄 ${name}` }]
      })
      const askedBy = q?.askedBy ?? { rule_id: 'ACCESS_RULES', check_id: rule.id }
      const capability = Object.values(b.hops).find(h => h.capability)?.capability
      rows.push(makeRow({ rule: rule.id as never, effect_query: query, source, target, level: uncertain ? 'indeterminate' : cross ? 'computed_cross' : 'computed', via, cut, undecomposed, asked_by: askedBy, holders, capability }, rowCtx))
    }
    return rows
  }
}

/** 규칙 파일의 규칙을 그래프에 돌린다. 일반 규칙은 한 번, 질문 모드 규칙은 그 규칙에 온 질문마다. 같은 동일성 키의 행은 처음 것만 남긴다 */
export function runAccessRules(graph: GraphStoreV2, opts: { rules?: readonly AccessRule[]; semantics?: Record<string, Semantics>; computedAt?: string; ctx?: RowContext; questions?: AccessQuestion[]; core?: ReachCore } = {}): RunResult {
  const rules = opts.rules ?? loadRules()
  // 닿음 핵심을 주지 않으면 관측 없이 만든다(EA 는 설정 층만 본다). semantics 는 관계 홉이 서는지 볼 효과 표(시험이 사전을 바꿔 넣을 때)
  const ex = new Executor(graph, opts.core ?? new ReachCore(new EdgeIndex(graph, buildEvidenceStore([], [])), opts.semantics as never))
  // 운영 EA 에 넣을 때는 손코드와 같은 행 맥락(계산 시각, 입력 view 판)을 받는다
  const ctx: RowContext = opts.ctx ?? { computedAt: opts.computedAt ?? '1970-01-01T00:00:00Z', inputsViewVersion: 2 }
  const rows: EffectiveAccessRow[] = []
  const seen = new Set<string>()
  const skipped: RunResult['skipped'] = []
  const unasked: string[] = []
  for (const q of opts.questions ?? []) if (!rules.some(r => r.id === q.rule)) throw new Error(`질문의 규칙 ${q.rule} 가 규칙 파일에 없다`)
  for (const rule of rules) {
    const why = unsupported(rule)
    if (why) {
      skipped.push({ rule: rule.id, why })
      continue
    }
    const asks: Array<AccessQuestion | undefined> = rule.mode === 'question' ? (opts.questions ?? []).filter(q => q.rule === rule.id) : [undefined]
    if (rule.mode === 'question' && !asks.length) unasked.push(rule.id)
    for (const q of asks) if (q) checkQuestion(rule, q)
    for (const q of asks) {
      for (const row of ex.run(rule, ctx, q)) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        rows.push(row)
      }
    }
  }
  return { rows, skipped, unasked, unknowns: ex.report() }
}
