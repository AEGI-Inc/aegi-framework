/**
 * 운영 Effective Access (EA 일반화): 정해 둔 규칙은 규칙 파일(ontology/access_rules.yaml)을 읽는 접근 규칙 실행기로, 나머지는 손코드로 계산한다.
 *
 * 운영 EA 의 바이트는 accessRulesExecutor.test.ts 의 지문이 지킨다.
 *
 *   runs_as_inherits     (2026-10-28) 손코드가 부르는 사람으로 도는 자동화에 내던 판정 보류 행이 빠지고, 벤더가 합친 실행 신원에
 *                        사유 runs_as_computed 가 붙고, 같은 자원에 has_role_on 과 owned_by 가 같이 오면 두 행이 된다(access_rules.yaml differs)
 *   x_member_grant       (2026-10-30) 질문 문구가 규칙 파일 yields.query 를 따른다. x_asked_by 가 ACCESS_RULES 가 되고(runs_as_inherits 와 같음),
 *                        같은 단계 안의 행 차례가 주체별로 묶일 수 있다. 집행 표시는 손코드와 실행기 모두 부여 관계 행의 membership_enforced 라
 *                        회수 지점과 사유는 같다(값을 싣기 전에 정규화한 데이터에서는 둘 다 소속 홉이 모름). 그룹 인원(x_scope.count)은 실행기가 세지
 *                        않아 손코드와 같은 수를 붙인다. 손코드와 행이 갈리는 입력(지금 데이터에는
 *                        없다): 지운 배정을 거친 그룹 → 테넌트 부여는 실행기가 막지 않는다(조건 갈래 deleted_assignment 가 Resource 칸에만 적혀 있다,
 *                        runs_as_inherits 와 같은 differs). 소속 대상이 Principal 이 아니면 손코드만 행을 낸다
 *   x_dynamic_holder     (2026-10-30) 한 리드에 projectLead 줄이 여럿이면 손코드는 한 행의 x_holders 로 묶고 실행기는 줄마다 한 행이다.
 *                        실행기는 스킴의 provider 도 보고, 행 차례는 스킴마다 묶이고, x_asked_by 는 ACCESS_RULES 다. 지금 데이터에는 권한 스킴 줄이
 *                        없어 어느 쪽도 행이 없다
 *
 * 위 차이 가운데 질문 문구는 규칙 파일 differs 에 아직 없다(knowledge 후속). 10-30 에 규칙 파일 쪽을 따르기로 했다.
 *
 * 2026-11-03 EA 거름(구조 개편 2단계): 실행기는 관계 홉과 G 홉을 닿음 핵심(위협 간선 위의 질의면, src/detection/v2/engine/reach.ts)에서 받고,
 * 홉의 사유(효과 표, 간선)가 단계를 내린다. 바뀐 행은 Okta 조직 역할의 그룹 부여(판정 보류, +role_rank_unknown)다(accessRulesExecutor.test.ts 지문).
 *
 * 회수 지점 설명(cut 의 x_scope.note)은 규칙 파일에 칸이 없어 실행기가 비워 둔다. 대시보드가 보여 주므로
 * 손코드와 같은 것을 붙인다(문구를 고르는 함수는 손코드의 것을 같이 쓴다).
 *
 * 운영 규칙은 사전이 고른다: 규칙 파일의 status 가 production 인 줄만 운영에서 돈다.
 * status 뜻은 production(운영이 돌림) | draft(적어 두고 시험만) | off(끔)다. 엔진이 행을 마무리할 줄 아는 규칙(EA_RULES, 회수 지점 설명과 행 자리)은
 * 코드에 남는다. 둘이 어긋나면(엔진이 모르는 production 줄, 엔진이 아는데 production 이 아닌 규칙) productionRuleProblems 가 알리고
 * 시험(scripts/ontology.test.ts)이 실패한다. 운영 실행에서는 엔진이 모르는 production 줄, 일반 모드가 아닌 production 줄, 사전에 없는 규칙에서 멈추고,
 * production 이 아닌 규칙은 행 없이 지나간다(사전에서 끈 규칙)
 *
 * 2026-11-03 EA 계산 시점 하나(구조 개편 4단계): EA 를 만드는 함수는 datasetEffectiveAccess 하나다. 데이터셋 파일을 받아 그래프와 증거를 만들고,
 * 닿음 핵심 위 거름과 회수 지점 설명(productionEffectiveAccess), 형식 검사(lint), 계산 시각(manifest.created_at)까지 끝낸 EA 를 돌려준다.
 * 정규화(products.ts buildProducts), 게시(fromCurrent.ts 의 --from-current 다시 계산과 --dataset 게시 전 견주기), 검증(accessEngine.ts,
 * verify-collected.mjs)이 이것만 부른다. 데이터셋의 effective_access.json 은 이 결과를 담아 두는 곳이고, 게시와 검증은 다시 계산해 견준다.
 */
import { buildEvidenceStore, buildGraphStoreV2 } from '../../src/data/datasetStore'
import { eaCutNote, type EaCutHop } from '../../src/detection/cutActions'
import type { GraphStoreV2 } from '../../src/model/graph'
import { computeEffectiveAccess, lintEffectiveAccess, type ComputeInput } from '../../src/detection/v2/effectiveAccess'
import type { RuleRows } from '../../src/detection/v2/effectiveAccess/compute'
import { nameOf, type RowContext } from '../../src/detection/v2/effectiveAccess/common'
import { LEAD_HOLDER_EVIDENCE, schemeCutNote } from '../../src/detection/v2/effectiveAccess/rules/dynamicHolder'
import { groupGrantNote, groupSize, memberLeaveNote } from '../../src/detection/v2/effectiveAccess/rules/memberGrant'
import type { EffectiveAccessFile, EffectiveAccessRow } from '../../src/detection/v2/effectiveAccess/types'
import { EA_RULES, type EaRuleId } from '../../src/detection/v2/effectiveAccess/types'
import { loadRules, loadSemantics, ONTOLOGY, runAccessRules, type AccessRule, type RunResult } from './executor'
import { EdgeIndex } from '../../src/detection/v2/engine/edges'
import { ReachCore } from '../../src/detection/v2/engine/reach'
import type { EvidenceObservation, FindingEvidenceLink } from '../../src/model/evidence'
import type { IdentityLink } from '../../src/model/link'
import type { FixtureObject } from '../../src/model/object'
import type { FixtureRelation } from '../../src/model/relation'

/** 규칙 파일 status 의 뜻. production 운영 EA 가 실행기로 돌린다 / draft 적어 두고 시험만 한다(운영에서 돌지 않는다) / off 끈 규칙(기록만) */
export const RULE_STATUSES = ['production', 'draft', 'off'] as const

/**
 * 사전과 엔진이 어긋난 곳. 비어 있어야 한다(scripts/ontology.test.ts).
 * - status 가 셋 밖이거나 id 가 겹침
 * - 엔진이 모르는 production 줄: 행을 마무리할 코드(회수 지점 설명, 행 자리)가 없다
 * - 엔진이 아는 규칙(EA_RULES)이 사전에 없거나 production 이 아님: 운영 EA 에서 그 규칙 행이 빠진다
 * - production 인데 일반 모드가 아님: 운영에는 질문이 없어 행이 조용히 사라진다
 */
export function productionRuleProblems(all: readonly AccessRule[], known: readonly string[] = EA_RULES): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of all) {
    if (seen.has(r.id)) out.push(`규칙 ${r.id} 가 사전에 둘 이상이다`)
    seen.add(r.id)
    if (!(RULE_STATUSES as readonly string[]).includes(r.status)) out.push(`규칙 ${r.id} 의 status ${r.status} 는 ${RULE_STATUSES.join(', ')} 가운데 하나가 아니다`)
    if (r.status !== 'production') continue
    if (!known.includes(r.id)) out.push(`사전의 운영 규칙 ${r.id} 를 엔진이 모른다(회수 지점 설명과 행 자리가 없다)`)
    if (r.mode !== 'general') out.push(`운영 규칙 ${r.id} 가 mode ${r.mode} 다(운영은 일반 모드만 돌린다)`)
  }
  for (const id of known) {
    const r = all.find(x => x.id === id)
    if (!r) out.push(`엔진이 아는 규칙 ${id} 가 사전에 없다`)
    else if (r.status !== 'production') out.push(`엔진이 아는 규칙 ${id} 가 사전에서 ${r.status} 라 운영 EA 에 행이 없다`)
  }
  return out
}

/**
 * 사전에서 운영 규칙을 고른다(status production). 운영 실행이 멈추는 것: 엔진이 아는 규칙이 사전에 없거나 둘 이상, 엔진이 모르는 production 줄,
 * production 인데 일반 모드가 아닌 줄(실행기는 질문 모드 규칙을 질문이 있을 때만 돌려 행이 조용히 사라진다). production 이 아닌 규칙은 돌지 않는다
 */
export function productionRules(all: readonly AccessRule[]): AccessRule[] {
  for (const id of EA_RULES) {
    const n = all.filter(r => r.id === id).length
    if (n !== 1) throw new Error(`규칙 파일의 ${id} 가 ${n}개다(하나여야 한다)`)
  }
  const rules = all.filter(r => r.status === 'production')
  for (const r of rules) {
    if (!(EA_RULES as readonly string[]).includes(r.id)) throw new Error(`사전의 운영 규칙 ${r.id} 를 엔진이 모른다(회수 지점 설명과 행 자리가 없다). status 를 draft 로 두거나 production.ts 에 행 마무리를 더하라`)
    if (r.mode !== 'general') throw new Error(`실행기가 운영 규칙을 읽지 못했다: ${r.id} (mode ${r.mode}. 운영은 일반 모드만 돌린다)`)
  }
  return rules
}

/** via 의 관계 칸이 가리키는 관계 행 */
const relationAt = (row: EffectiveAccessRow, i: number, graph: GraphStoreV2) => {
  const v = row.via[i]
  return v?.kind === 'relation' ? graph.relationsByKey.get(v.ref) : undefined
}

/** 회수 지점마다 손코드와 같은 설명을 붙인다. 붙일 설명이 없는 칸이면(규칙 파일의 cut 이 바뀌었다) 빈 설명으로 내지 않고 멈춘다 */
function withNotes(row: EffectiveAccessRow, note: (via: number, affects: string) => string | undefined): EffectiveAccessRow {
  return {
    ...row,
    cut: row.cut.map(c => {
      const text = note(c.via, c.x_scope.affects)
      if (text === undefined) throw new Error(`${row.source.rule} 회수 지점 via ${c.via} ${c.x_scope.affects} 의 설명이 없다`)
      return { ...c, x_scope: { ...c.x_scope, note: text } }
    }),
  }
}

/**
 * x_acts_as_inherits(via 0 acts_as, via 1 봇 사용자의 권한), x_token_inherits(via 0 토큰 ← 만든 사람, via 1 그 사람의 권한).
 * 회수 지점 설명은 사전 phrases.ea_cut. 주체는 via 1 관계의 출발(봇 사용자, 토큰을 만든 사람)이다
 */
function actsForNote(row: EffectiveAccessRow, graph: GraphStoreV2, rule: 'x_acts_as_inherits' | 'x_token_inherits' | 'x_token_scoped') {
  const principal = relationAt(row, 1, graph)?.sourceKey
  const first = rule === 'x_acts_as_inherits' ? 'r' : 't'
  return (via: number, affects: string) => {
    if (via === 0 && affects === 'source_only') return eaCutNote(`${rule}.${first}` as EaCutHop)
    if (via === 1 && affects === 'group' && principal) return eaCutNote(`${rule}.h` as EaCutHop, { 주체: nameOf(principal, graph) })
    return undefined
  }
}

/** runs_as_inherits: 회수 지점 설명은 사전 phrases.ea_cut(손코드 rules/runsAsInherits.ts 와 같은 틀) */
function runsAsNote(row: EffectiveAccessRow, graph: GraphStoreV2) {
  const principal = relationAt(row, 0, graph)?.targetKey
  return (via: number, affects: string) => {
    if (via === 0 && affects === 'source_only') return eaCutNote('runs_as_inherits.r')
    if (via === 1 && affects === 'group' && principal) return eaCutNote('runs_as_inherits.h', { 주체: nameOf(principal, graph) })
    return undefined
  }
}

/** x_member_grant: via 0 은 그룹 소속(주체 → 그룹), via 1 은 그룹의 부여. 그룹 인원(x_scope.count)도 손코드처럼 센다. 규칙의 홉 차례가 바뀌어 자리가 어긋나면 멈춘다 */
function withMemberGrantScope(row: EffectiveAccessRow, graph: GraphStoreV2): EffectiveAccessRow {
  const membership = relationAt(row, 0, graph)
  const grant = relationAt(row, 1, graph)
  if (membership?.relationType !== 'member_of' || membership.sourceKey !== row.references.source || grant?.relationType !== 'has_role_on' || grant.sourceKey !== membership.targetKey) {
    throw new Error('x_member_grant 행의 via 0, 1 이 그룹 소속과 그 그룹의 부여가 아니다')
  }
  const group = membership.targetKey
  return {
    ...row,
    cut: row.cut.map(c => {
      if (group && c.via === 0 && c.x_scope.affects === 'source_only') return { ...c, x_scope: { affects: c.x_scope.affects, note: memberLeaveNote(row.references.source, group, graph) } }
      if (group && c.via === 1 && c.x_scope.affects === 'group') {
        const size = groupSize(group, graph)
        return { ...c, x_scope: { affects: c.x_scope.affects, count: size, note: groupGrantNote(group, size, graph) } }
      }
      throw new Error(`x_member_grant 회수 지점 via ${c.via} ${c.x_scope.affects} 의 설명이 없다`)
    }),
  }
}

/** x_dynamic_holder 의 프로젝트 리드 보유자 근거를 손코드 문구로 */
const withLeadEvidence = (row: EffectiveAccessRow): EffectiveAccessRow =>
  row.x_holders ? { ...row, x_holders: row.x_holders.map(h => (h.type === 'projectLead' ? { ...h, evidence: LEAD_HOLDER_EVIDENCE } : h)) } : row

/** x_dynamic_holder: via 0 은 스킴 → 프로젝트 적용 관계 */
function holderNote(row: EffectiveAccessRow, graph: GraphStoreV2) {
  const applies = relationAt(row, 0, graph)
  return (via: number, affects: string) => (via === 0 && affects === 'all_callers' && applies ? schemeCutNote(applies.targetKey, applies.sourceKey, graph) : undefined)
}

/**
 * 운영 EA. computeEffectiveAccess 와 같은 입력을 받고, 사전이 고른 운영 규칙(status production)의 실행기 행을 넣는다. ontology 는 시험용.
 * 실행기는 홉을 닿음 핵심(위협 간선, 설정 층)에서 받고 규칙의 길 모양만 고른다(EA 거름, 2026-11-03 구조 개편)
 */
export function productionEffectiveAccess(input: ComputeInput, ontology = ONTOLOGY): EffectiveAccessFile {
  const rules = productionRules(loadRules(ontology))
  const on = new Set(rules.map(r => r.id))
  const semantics = loadSemantics(ontology)
  const { graph, evidenceStore } = input
  const core = new ReachCore(new EdgeIndex(graph, evidenceStore), semantics as never)
  // 운영 규칙을 한 번에 돌린다
  let result: RunResult | undefined
  const rowsOf = (ctx: RowContext, rule: EaRuleId) => {
    if (!result) result = runAccessRules(graph, { rules, semantics, ctx, core })
    // 실행기가 못 읽으면 행이 0개가 되어 조용히 사라진다. 운영에서는 멈춘다
    if (result.skipped.length) throw new Error(`실행기가 운영 규칙을 읽지 못했다: ${result.skipped.map(s => `${s.rule} (${s.why})`).join(', ')}`)
    return result.rows.filter(r => r.source.rule === rule)
  }
  // 행 마무리(회수 지점 설명 등)는 규칙마다 코드에 있다. 사전에서 production 이 아닌 규칙은 행이 없다
  const finish: RuleRows = {
    runs_as_inherits: ctx => rowsOf(ctx, 'runs_as_inherits').map(r => withNotes(r, runsAsNote(r, graph))),
    x_member_grant: ctx => rowsOf(ctx, 'x_member_grant').map(r => withMemberGrantScope(r, graph)),
    x_acts_as_inherits: ctx => rowsOf(ctx, 'x_acts_as_inherits').map(r => withNotes(r, actsForNote(r, graph, 'x_acts_as_inherits'))),
    x_token_inherits: ctx => rowsOf(ctx, 'x_token_inherits').map(r => withNotes(r, actsForNote(r, graph, 'x_token_inherits'))),
    x_token_scoped: ctx => rowsOf(ctx, 'x_token_scoped').map(r => withNotes(r, actsForNote(r, graph, 'x_token_scoped'))),
    x_dynamic_holder: ctx => rowsOf(ctx, 'x_dynamic_holder').map(r => withLeadEvidence(withNotes(r, holderNote(r, graph)))),
  }
  const fromRules = Object.fromEntries(EA_RULES.map(id => [id, on.has(id) ? finish[id] : () => []])) as unknown as RuleRows
  return computeEffectiveAccess({ ...input, fromRules })
}

/**
 * EA 를 만드는 데이터셋 파일(정규화 산출, 데이터셋 폴더, --from-current 로 꺼낸 폴더). 계산 시각은 manifest.created_at 이다.
 * loader 의 DatasetFiles 와 같은 칸이다. 운영 입구가 loader 코드를 불러오지 않게 여기 적는다(EA_CODE_FILES 가 입구가 불러오는 코드를 따라간다)
 */
export interface EffectiveAccessDataset {
  manifest: Record<string, any>
  objects: FixtureObject[]
  relations: FixtureRelation[]
  links: IdentityLink[]
  observations: EvidenceObservation[]
  evidence_links: FindingEvidenceLink[]
}

/** 데이터셋 하나의 운영 EA. EA 를 만드는 함수는 이것 하나다(머리말 「EA 계산 시점 하나」). 형식 검사에 걸리면 던진다. ontology 는 시험용 */
export function datasetEffectiveAccess(files: EffectiveAccessDataset, options: { ontology?: string } = {}): EffectiveAccessFile {
  const graph = buildGraphStoreV2(files.objects, files.relations, files.links)
  const evidenceStore = buildEvidenceStore(files.observations, files.evidence_links)
  const ea = productionEffectiveAccess({ graph, evidenceStore, computedAt: String(files.manifest.created_at) }, options.ontology)
  const problems = lintEffectiveAccess(ea, graph)
  if (problems.length) throw new Error(`effective_access 형식 검사 실패 ${problems.length}건: ${problems.slice(0, 5).join('; ')}`)
  return ea
}
