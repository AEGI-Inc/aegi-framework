/**
 * 관계 의미 층 — 설정 조건(칸 conditions_on). 사전 semantic_mapping.yaml settings 표(생성 SEMANTIC_SETTINGS), 명세 Relation_Semantic_Layer_v1 4.3.
 *
 * 한 줄 = 테넌트 설정 하나: 누구(holder)에게 어떤 능력(caps)을 어디(target)에 허용 · 제한하나.
 *   값    select 로 고른 설정 객체의 property 칸. values 가 값 → allow | deny. 칸이 없으면(수집하지 않음) default(벤더 기본값)
 *   근거  칸이 있으면 flag, 없으면 vendor_default 에 모름 사유 setting_not_collected(조직이 기본값을 바꿨으면 틀림)
 *   허용  grants 사실 하나: 출발 = 테넌트(구성원 전원), 도착 = target. except 에 맞는 구성원은 테넌트 소속을 펼 때 뺀다
 *         (역할 제외 roleExcludes 와 같은 길 — 간선의 roleKey 가 열쇠)
 *   막음  conditions(exclude) 사실: 설정 객체 → 구성원 하나하나(exempt 빼고). 간선이 아니다. 질의가 그 구성원의 다른 근거 권한에서
 *         그 대상의 그 능력을 깎는다(ceiling.ts underCeiling, 상한과 같은 자리)
 *   대상  tenant = 설정 객체의 테넌트, objects:<종류> = 그 테넌트와 그 상위 테넌트 안의 그 종류 객체
 * SaaS 이름은 표에만 있다. 이 파일에는 provider 이름 분기가 없다.
 */
import type { GraphStoreV2 } from '../../../../model/graph'
import { holds as holdsExpr, MatchCtx, resolve, type MatchObject } from '../../../../model/match'
import { RELATION_RESOLVERS, SEMANTIC_SETTINGS, type SemanticSetting } from '../../../../ontology/generated'
import type { SemanticFact } from './facts'

export const SETTING_NOT_COLLECTED = 'setting_not_collected'
/** 허용 간선의 roleKey(테넌트 소속을 펼 때 except 구성원을 뺄 열쇠) */
export const settingRole = (name: string, setting: string) => `setting:${name}:${setting}`

/** 설정 객체 칸 값(점으로 깊이) */
function valueOf(props: Record<string, unknown> | undefined, field: string): unknown {
  let v: unknown = props
  for (const k of field.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined
  return v
}

/** 설정 하나의 판정: allow | deny 와 근거. 칸이 있는데 values 가 모르는 값이면 기본값 + 모름 */
export function settingDecision(s: Pick<SemanticSetting, 'property' | 'values' | 'default'>, props: Record<string, unknown> | undefined): { effect: 'allow' | 'deny'; basis: 'flag' | 'vendor_default'; uncertain: string[] } {
  const raw = s.property ? valueOf(props, s.property) : undefined
  const known = raw !== undefined && raw !== null ? s.values?.[String(raw)] : undefined
  if (known) return { effect: known, basis: 'flag', uncertain: [] }
  return { effect: s.default, basis: 'vendor_default', uncertain: [SETTING_NOT_COLLECTED] }
}

export interface SettingsOut {
  facts: SemanticFact[]
  /** roleKey → 뺄 구성원 */
  excludes: Map<string, Set<string>>
  stats: Record<string, { allow: number; deny: number; flag: number; vendor_default: number; targets: number; members: number }>
}

/**
 * 설정 조건 표 → 사실. objects 는 변환기의 객체 표(match 자리), relationsFrom 은 tenant_of 해결기가 읽는 관계 목록, skip 은 뺄 객체(측정 도구)
 */
export function convertSettings(graph: GraphStoreV2, objects: Record<string, MatchObject>, relationsFrom: Map<string, any[]>, skip?: (key: string) => boolean, table: readonly SemanticSetting[] = SEMANTIC_SETTINGS): SettingsOut {
  const out: SettingsOut = { facts: [], excludes: new Map(), stats: {} }
  const tenantOf = (k: string): string[] => resolve(RELATION_RESOLVERS.tenant_of as Record<string, unknown>, k, objects, relationsFrom as any)
  const isTenant = (k: string) => (objects[k]?.i ?? []).includes('Tenant')
  // 테넌트 → 구성원(member_of 관계 행이나 tenant 참조로 그 테넌트에 드는 Principal)
  const membersOf = (tenant: string): string[] => Object.values(objects).filter(o => (o.i ?? []).includes('Principal') && !isTenant(o.k) && tenantOf(o.k).includes(tenant)).map(o => o.k)
  const matches = (expr: Record<string, unknown> | undefined, k: string) => !!expr && holdsExpr(expr as Record<string, any>, new MatchCtx({ source: objects[k], target: objects[k] }, [], {}, objects))

  for (const s of table) {
    const st = (out.stats[s.name] = { allow: 0, deny: 0, flag: 0, vendor_default: 0, targets: 0, members: 0 })
    for (const [k, mo] of Object.entries(objects)) {
      if (skip?.(k) || !holdsExpr(s.select as Record<string, any>, new MatchCtx({ source: mo, target: mo }, [], {}, objects))) continue
      const tenant = isTenant(k) ? k : tenantOf(k)[0]
      if (!tenant) continue
      const scope = new Set([tenant, ...tenantOf(tenant)])
      const targets = s.target === 'tenant'
        ? [tenant]
        : s.target.startsWith('objects:')
          ? Object.values(objects).filter(o => o.t === s.target.slice('objects:'.length) && !skip?.(o.k) && tenantOf(o.k).some(t => scope.has(t))).map(o => o.k)
          : []
      if (!targets.length) continue
      const d = settingDecision(s, graph.objectsByKey.get(k)?.canonical.properties as Record<string, unknown> | undefined)
      st[d.effect]++
      st[d.basis]++
      st.targets += targets.length
      const origin = { kind: 'record' as const, id: k, route: `setting:${s.name}` }
      if (d.effect === 'allow') {
        const role = settingRole(s.name, k)
        // 테넌트 소속을 펼 때 그룹 · 상위 테넌트를 거쳐 들어오는 계정도 같은 열쇠로 거른다: except 는 Principal 마다 본다
        const ex = new Set(Object.values(objects).filter(o => (o.i ?? []).includes('Principal') && !isTenant(o.k) && matches(s.except, o.k)).map(o => o.k))
        out.excludes.set(role, ex)
        st.members = membersOf(tenant).filter(m => !ex.has(m)).length
        const grant = (from: string, to: string) => out.facts.push({ p: 'grants', from, to, caps: [...s.caps], capsSource: 'table', basis: d.basis, uncertain: [...d.uncertain], origin, fromEnd: from === tenant ? 'tenant' : 'self', roleKey: role, title: s.label, revocable: false })
        // 테넌트 자체가 대상이면 테넌트 → 그 테넌트 간선은 생기지 않으므로(제 자신으로 가는 간선) 구성원마다 하나
        for (const to of targets) {
          if (to === tenant) for (const m of membersOf(tenant)) { if (!ex.has(m)) grant(m, to) }
          else grant(tenant, to)
        }
      } else {
        const members = membersOf(tenant).filter(m => !matches(s.exempt, m))
        st.members = members.length
        for (const m of members) out.facts.push({ p: 'conditions', from: k, to: m, polarity: 'exclude', caps: [...s.caps], targets, basis: d.basis, uncertain: [...d.uncertain], origin, title: s.label, revocable: false })
      }
    }
  }
  return out
}
