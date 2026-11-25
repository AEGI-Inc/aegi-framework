import type { GraphStoreV2 } from '../model/graph'
import type { FixtureObject } from '../model/object'
import { filterablePropertyName, propertyAt } from '../assistant/propertyRules'

/**
 * 회사가 Compliance 항목에 더하는 추가 기준 (예: 개정 예고된 기준). AI가 초안을 만들고 사람이 Compliance 화면에서 저장한다.
 * 검사 하나는 기준별 설정 판정(엔진 scripts/standards)의 항목과 같은 모양이다: 검사 데이터(provider, type, filter), 필드, 요구값, 결합 방식.
 * 요구값은 기준 문장에 적힌 것만 넣는다(conditionQuote). 없으면 관측값만 보여 주고 판정하지 않는다(unknown).
 * 새 기준이 기존 공개 기준 점검의 요구값을 바꾸는 것이면 그 점검을 replaces 로 적어 바뀌기 전과 후를 나란히 보인다.
 * 판정은 현재 그래프로 화면에서 다시 계산한다. 이 브라우저에만 저장한다(팀 저장소 아님).
 */
export type Op = '=' | '!=' | 'in' | 'not_in' | 'exists' | 'missing' | '>=' | '<=' | 'has'
export interface Condition { path: string; op: Op; values: string[] }
export interface CriterionCheck {
  id: string
  question: string
  provider: string
  type: string
  filter: string[]
  fields: string[]
  condition: string[]
  conditionJoin: 'any' | 'all'
  /** 요구값이 적힌 기준 문장 속 구절. condition 이 있을 때만 */
  conditionQuote: string
  /** 새 기준이 요구값을 바꾸는 기존 공개 기준 점검(같은 인증기준에 연결된 것). 바뀌기 전 요구값과 결과를 같이 보인다 */
  replaces?: { finding: string; standard: string; item: string; field: string; condition: string }
  combine: 'any_object' | 'every_object'
}
export interface CustomCriterion {
  id: string
  standard: 'ISMS-P'
  criterion: string
  name: string
  sourceText: string
  sourceTitle: string
  status: 'draft' | 'saved'
  createdAt: string
  checks: CriterionCheck[]
}
/** 기준별 설정 판정과 같은 상태값 */
export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'not_collected'
export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = { pass: '충족', fail: '위반', unknown: '판정 불가', not_collected: '미수집' }
export interface CheckResult { status: CheckStatus; targets: { key: string; passed: boolean | null; values: Record<string, unknown> }[] }

const STORAGE_KEY = 'aegi.compliance.custom-criteria.v2'
const listeners = new Set<() => void>()
let cache: CustomCriterion[] | null = null

export function loadCriteria(): CustomCriterion[] {
  if (cache) return cache
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    cache = Array.isArray(stored) ? stored.filter(isCriterion) : []
  } catch { cache = [] }
  return cache
}
function store(next: CustomCriterion[]) {
  cache = next
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* 저장 실패해도 이 탭에서는 보인다 */ }
  listeners.forEach(l => l())
}
export function subscribeCriteria(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export const criteriaFor = (criterion: string) => loadCriteria().filter(c => c.criterion === criterion)

/** AI 초안: 같은 항목과 이름의 초안이 있으면 검사를 더하고(같은 질문이면 바꾼다), 없으면 새로 만든다. 저장된 기준은 건드리지 않는다 */
export function upsertDraft(input: Omit<CustomCriterion, 'id' | 'status' | 'createdAt' | 'checks'>, check: Omit<CriterionCheck, 'id'>): { criterion: CustomCriterion; check: CriterionCheck } {
  const all = loadCriteria()
  const current = all.find(c => c.status === 'draft' && c.criterion === input.criterion && c.name === input.name)
  const draft: CustomCriterion = current ?? { ...input, id: `cc-${Date.now().toString(36)}`, status: 'draft', createdAt: new Date().toISOString(), checks: [] }
  const kept = draft.checks.filter(c => c.question !== check.question)
  const added = { ...check, id: `${draft.id}-${Math.random().toString(36).slice(2, 8)}` }
  const next = { ...draft, ...input, checks: [...kept, added] }
  store(current ? all.map(c => c.id === current.id ? next : c) : [...all, next])
  return { criterion: next, check: added }
}
export const saveCriterion = (id: string) => store(loadCriteria().map(c => c.id === id ? { ...c, status: 'saved' } : c))
export const removeCriterion = (id: string) => store(loadCriteria().filter(c => c.id !== id))

const OPS: Op[] = ['has', 'not_in', 'in', '!=', '>=', '<=', '=']
/** 조건 글 한 줄을 읽는다: "경로=값", "경로!=값", "경로 in a,b", "경로 not_in a,b", "경로 exists", "경로 missing", "경로>=수", "경로<=수",
 * "경로 has 이름:값"(목록이나 묶음 안에 그 이름과 값이 있음. 따옴표와 빈칸은 무시) */
export function parseCondition(text: string): Condition | null {
  const t = text.trim()
  const unary = /^([A-Za-z_][\w.]*)\s+(exists|missing)$/.exec(t)
  if (unary) return { path: unary[1], op: unary[2] as Op, values: [] }
  for (const op of OPS) {
    const sep = op === 'in' || op === 'not_in' || op === 'has' ? ` ${op} ` : op
    const at = t.indexOf(sep)
    if (at <= 0) continue
    const path = t.slice(0, at).trim(), rest = t.slice(at + sep.length).trim()
    if (!/^[A-Za-z_][\w.]*$/.test(path) || !rest) continue
    return { path, op, values: op === 'in' || op === 'not_in' ? rest.split(',').map(v => v.trim()).filter(Boolean) : [rest] }
  }
  return null
}

/** 검사가 읽을 수 있는 필드 이름: 점으로 이은 이름 여섯 단계까지, 단계마다 비밀값이나 본문 이름이 아님 */
export const checkFieldName = (path: string) => /^[A-Za-z_]\w*(\.[A-Za-z_]\w*){0,5}$/.test(path) && path.split('.').every(filterablePropertyName)
const asText = (v: unknown) => v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
export const hasValue = (v: unknown) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)
function holds(o: FixtureObject, c: Condition): boolean {
  const v = propertyAt(o.canonical.properties, c.path)
  const present = hasValue(v)
  if (c.op === 'exists') return present
  if (c.op === 'missing') return !present
  if (c.op === '>=' || c.op === '<=') { const n = Number(v), x = Number(c.values[0]); return Number.isFinite(n) && Number.isFinite(x) && (c.op === '>=' ? n >= x : n <= x) }
  const s = asText(v)
  if (c.op === 'has') { const bare = (x: string) => x.replace(/["\s]/g, ''); return present && bare(s).includes(bare(c.values[0])) }
  if (c.op === '=') return s === c.values[0]
  if (c.op === '!=') return present && s !== c.values[0]
  if (c.op === 'in') return c.values.includes(s)
  return present && !c.values.includes(s)
}

/** 검사 데이터에 해당하는 객체 */
export function checkTargets(graph: GraphStoreV2, check: Pick<CriterionCheck, 'provider' | 'type' | 'filter'>): FixtureObject[] {
  const filter = check.filter.map(parseCondition).filter((c): c is Condition => !!c)
  return [...graph.objectsByKey.values()].filter(o => o.canonical.provider === check.provider && o.canonical.object_type === check.type && filter.every(c => holds(o, c)))
}

/** 검사 하나를 현재 그래프에 적용한다. 대상이 없으면 not_collected, 요구값이 없으면 관측값만 보이고 unknown */
export function evaluateCheck(graph: GraphStoreV2, check: CriterionCheck): CheckResult {
  const cond = check.condition.map(parseCondition).filter((c): c is Condition => !!c)
  const targets = checkTargets(graph, check).map(o => ({ key: o.fixture_key,
    passed: cond.length ? (check.conditionJoin === 'all' ? cond.every(c => holds(o, c)) : cond.some(c => holds(o, c))) : null,
    values: Object.fromEntries(check.fields.map(p => [p, propertyAt(o.canonical.properties, p) ?? null])) }))
  if (!targets.length) return { status: 'not_collected', targets }
  if (!cond.length) return { status: 'unknown', targets }
  const ok = check.combine === 'every_object' ? targets.every(t => t.passed) : targets.some(t => t.passed)
  return { status: ok ? 'pass' : 'fail', targets }
}

export const describeSource = (check: CriterionCheck) => `${check.provider} ${check.type}${check.filter.length ? ` 중 ${check.filter.join(', ')}` : ''}`
export const describeCondition = (check: CriterionCheck) => check.condition.length ? check.condition.join(check.conditionJoin === 'all' ? ' 그리고 ' : ' 또는 ') : '기준 문장에 없음'
export const describeBasis = (check: CriterionCheck) => check.conditionQuote ? `기준 문장 「${check.conditionQuote}」` : ''
export const describeReplaced = (r: NonNullable<CriterionCheck['replaces']>) => `${r.finding} [${r.standard} ${r.item}] 필드 ${r.field}, 요구 ${r.condition || '없음'}`
export const describeCombine = (check: CriterionCheck) => check.combine === 'every_object' ? '대상 중 하나라도 어기면 위반' : '대상 중 하나라도 만족하면 충족'

function isCriterion(x: unknown): x is CustomCriterion {
  const c = x as CustomCriterion
  return !!c && typeof c.id === 'string' && typeof c.criterion === 'string' && typeof c.name === 'string' && (c.status === 'draft' || c.status === 'saved') && Array.isArray(c.checks)
    && c.checks.every(k => k && typeof k.question === 'string' && typeof k.provider === 'string' && typeof k.type === 'string' && Array.isArray(k.filter) && Array.isArray(k.fields) && Array.isArray(k.condition))
}
