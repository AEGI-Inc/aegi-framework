/**
 * 대조: 엔진 결과가 EA 줄과 같은 말을 하는가. 설계서 §6.
 * 어긋남은 셋으로 나눈다.
 * - conflict: 엔진이 EA 판정을 못 낸다 → 엔진이나 간선 표가 틀렸다 (막는다)
 * - engine_weaker: EA 는 확정인데 엔진은 추정 → 엔진이 모르는 사실이 있다 (사유를 보고 수집·overrides 로 푼다)
 * - engine_stronger: 엔진이 더 단단하다 → 사람이 보고 맞는지 판단한다 (보고만)
 */
import type { EffectiveAccessFile, EffectiveAccessRow } from '../effectiveAccess/types'
import { RANK } from './accessModel'
import type { AccessEngine, PointAnswer } from './index'
import { relationRoleCapability } from './relationEffects'
import type { Verdict, WitnessLevel } from './types'

export interface EaParity {
  rowId: string
  rule: string
  source: string
  target: string
  question: string
  ea: WitnessLevel
  engine: Verdict
  engineLevel?: WitnessLevel
  status: 'same' | 'engine_stronger' | 'engine_weaker' | 'conflict'
  reasons: string[]
}

export interface ParityReport {
  ok: boolean
  ea: EaParity[]
  summary: string[]
}

const EA_VERDICT: Record<WitnessLevel, Verdict> = { denied: 'no', computed: 'yes', computed_cross: 'yes', indeterminate: 'unknown' }

/**
 * x_member_grant 행을 물을 세기. 규칙 파일 행(일반 규칙)은 「그 소속으로 그 대상에 그 역할을 가지는가」라, 부여 관계(has_role_on)의 역할 세기로 묻는다. 세기는 엔진이 그 간선에
 * 다는 것(relationRoleCapability)과 같고, 그 세기를 넘지 않는 가장 센 이름으로 묻는다. 세기를 모르면 read(닿는가)로 묻는다(엔진은 그 간선을 모름으로 둔다)
 */
function memberGrantCap(r: EffectiveAccessRow, engine: AccessEngine): 'read' | 'write' | 'admin' {
  const via = [...r.via].reverse().find(v => v.kind === 'relation' && v.relation_type === 'has_role_on')
  const grant = via ? engine.ix.graph.relationsByKey.get(via.ref) : undefined
  const rank = grant ? relationRoleCapability(grant, engine.ix.graph, engine.ix.options.overrides).rank : undefined
  return rank === undefined ? 'read' : rank >= RANK.admin ? 'admin' : rank >= RANK.write ? 'write' : 'read'
}

export function eaParity(engine: AccessEngine, file: EffectiveAccessFile | undefined): EaParity[] {
  if (!file) return []
  const out: EaParity[] = []
  for (const r of file.rows) {
    const { source, target } = r.references
    let answer: PointAnswer
    let question: string
    switch (r.source.rule) {
      case 'x_member_grant': {
        const cap = memberGrantCap(r, engine)
        answer = engine.askCan(source, cap, target)
        question = `can(${cap})`
        break
      }
      case 'runs_as_inherits':
        answer = engine.actsCan(source, 'read', target)
        question = 'acts(read)'
        break
      default:
        continue
    }
    const ea = EA_VERDICT[r.level]
    const status: EaParity['status'] =
      answer.verdict === ea ? 'same' : ea === 'unknown' ? 'engine_stronger' : answer.verdict === 'unknown' ? 'engine_weaker' : 'conflict'
    out.push({
      rowId: r.id,
      rule: r.source.rule,
      source,
      target,
      question,
      ea: r.level,
      engine: answer.verdict,
      engineLevel: answer.witness?.level,
      status,
      reasons: answer.witness?.reasons.length ? answer.witness.reasons : answer.open,
    })
  }
  return out
}

export function parity(engine: AccessEngine, input: { effectiveAccess?: EffectiveAccessFile }): ParityReport {
  const ea = eaParity(engine, input.effectiveAccess)
  const bad = ea.filter(e => e.status === 'conflict')
  const tally = <T extends { status: string }>(list: T[]) => {
    const m = new Map<string, number>()
    for (const x of list) m.set(x.status, (m.get(x.status) ?? 0) + 1)
    return [...m].map(([k, v]) => `${k} ${v}`).join(', ') || '없음'
  }
  return {
    ok: bad.length === 0,
    ea,
    summary: [`EA 줄 ${tally(ea)}`],
  }
}
