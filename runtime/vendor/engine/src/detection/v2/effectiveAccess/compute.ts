/**
 * Effective Access 행 (적용안 §5).
 *
 * 규칙 행은 모두 규칙 파일(접근 규칙 실행기)이 계산한다: fromRules 로 받은 행을 EA_RULES 차례로 넣는다(scripts/accessRules/production.ts).
 * 어느 규칙이 운영에서 도는지는 사전 status(production)가 고른다. 돌지 않는 규칙은 fromRules 가 빈 행을 준다
 */
import type { EvidenceStore } from '../../../model/evidence'
import type { GraphStoreV2 } from '../../../model/graph'
import { EA_VIEW_VERSION, type RowContext } from './common'
import { EA_RULES, type EaRuleId, type EffectiveAccessFile, type EffectiveAccessRow } from './types'
import { isRunsAsInheritsInput } from './rules/runsAsInherits'
import { JIRA_DYNAMIC_HOLDERS, schemeLines } from './rules/dynamicHolder'

export interface ComputeInput {
  graph: GraphStoreV2
  evidenceStore: EvidenceStore
  /** 입력 스냅샷 시각 (manifest.created_at) */
  computedAt: string
}

/**
 * 규칙 파일(접근 규칙 실행기)이 계산한 규칙 행. 이 자리에 그대로 넣는다. 규칙마다 하나(EA_RULES).
 * 2026-11-08 x_acts_as_inherits(앱 → 봇 사용자), x_token_inherits(조직 소유 토큰 → 만든 사람의 권한), 2026-11-10 x_token_scoped(사람이 앱에 준 토큰 →
 * 그 사람의 권한 가운데 scope 가 덮는 것, capabilities.yaml token_scopes)는 처음부터 규칙 파일에만 있다
 */
export type RuleRows = Record<EaRuleId, (ctx: RowContext) => EffectiveAccessRow[]>

type RulesInput = ComputeInput & { fromRules: RuleRows }

/** 일반 규칙 (General Access Graph). 규칙 파일이 계산한 행을 EA_RULES 차례로 넣는다 */
function generalRules(input: RulesInput, ctx: RowContext, rows: EffectiveAccessRow[]): void {
  for (const id of EA_RULES) rows.push(...input.fromRules[id](ctx))
}

export function ruleInputs(graph: GraphStoreV2): Record<EaRuleId, number> {
  const count = (type: string, pred: (r: any) => boolean = () => true) => (graph.relationsByType.get(type) ?? []).filter(pred).length
  return {
    runs_as_inherits: count('runs_as', r => isRunsAsInheritsInput(r, graph)),
    x_member_grant: count('member_of'),
    // 권한 스킴 줄은 스킴의 permissions 속성이다(판단표 G4-Q02)
    x_dynamic_holder: (graph.objectsByInterface.get('Policy') ?? []).filter(o => o.canonical.provider === 'atlassian' && o.canonical.object_type === 'PermissionScheme')
      .flatMap(o => schemeLines(o.fixture_key, graph)).filter(l => JIRA_DYNAMIC_HOLDERS.has(l.type)).length,
    x_acts_as_inherits: count('acts_as'),
    x_token_inherits: count('authenticates_with'),
    x_token_scoped: count('authenticates_with'),
  }
}

export function computeEffectiveAccess(input: RulesInput): EffectiveAccessFile {
  const viewVersions = [...input.graph.linksById.values()].map(l => l.source?.view_version).filter((v): v is number => typeof v === 'number')
  const ctx: RowContext = { computedAt: input.computedAt, inputsViewVersion: viewVersions.length ? Math.max(...viewVersions) : 1 }
  const rows: EffectiveAccessRow[] = []
  generalRules(input, ctx, rows)
  const seen = new Set<string>()
  return {
    format: 'aegi-effective-access/v1',
    schema: 'Effective_Access_Schema_v1',
    view_version: EA_VIEW_VERSION,
    inputs_view_version: ctx.inputsViewVersion,
    computed_at: input.computedAt,
    x_rule_inputs: ruleInputs(input.graph),
    rows: rows.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true))),
  }
}
