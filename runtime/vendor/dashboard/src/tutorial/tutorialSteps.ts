import type { Page } from '../appRouting'
import type { ConversationTurn } from '../assistant/conversationStore'
import type { FindingV2 } from '../model/findingV2'
import type { UseCase } from './useCases'

/**
 * 공개 데모 체험 단계 판정. 화면이 이미 가진 상태(주소의 화면, 그래프 진입 객체, AI 대화 기록, 위협의 Access Gap 벤)를
 * 읽기만 한다. 데이터를 만들거나 판정을 다시 하지 않는다. 대상 키와 질문은 체험 설정(useCases.ts)에서 받는다.
 */

/** 위협 하나의 Access Gap 벤 요약. id 는 위협 번호(AI 답의 gapId), keys 는 연동 지점과 대상, outsideKeys 는 새로 권한이 생긴 사람 */
export interface GapView { id: string; keys: string[]; outsideKeys: string[] }

export interface TutorialView {
  page: Page
  /** 그래프를 연 횟수와 그때 넘긴 객체 (App graphEntry) */
  graphEntry: { key: number; objectKey?: string }
  conversationId: string
  turns: readonly ConversationTurn[]
  gaps: readonly GapView[]
}

/** 단계를 시작한 때의 위치. 이 뒤에 생긴 대화와 그래프 진입만 센다 */
export interface StepMark { conversationId: string; turnId: number; graphEntryKey: number }

/** Access Gap 벤이 있는 위협마다 하나. 수에서 뺀 사람(관리자, 승인됨)은 outsideKeys 에 넣지 않는다 */
export function gapViews(findings: readonly FindingV2[]): GapView[] {
  return findings.flatMap(f => {
    const gap = f.threatAccessGap
    const path = f.threatPath
    if (!gap || !path) return []
    return [{
      id: f.id,
      keys: [...new Set([path.point, path.target, ...(f.threatTargets ?? []), ...f.involvedObjectKeys])],
      outsideKeys: gap.people.filter(p => p.gained.length > 0 && !p.excluded).map(p => p.person),
    }]
  })
}

export function markOf(view: TutorialView): StepMark {
  return { conversationId: view.conversationId, turnId: Math.max(0, ...view.turns.map(t => t.id)), graphEntryKey: view.graphEntry.key }
}

/** 표시 시점 뒤에 답을 받은 질문. 새 대화를 열었으면 그 대화의 질문은 모두 뒤에 생긴 것이다 */
function answeredSince(view: TutorialView, mark: StepMark) {
  return view.turns.filter(t => !!t.answer && !t.error && (view.conversationId !== mark.conversationId || t.id > mark.turnId))
}

/** 체험 자산을 지나는 Access Gap. 없으면(아직 게시 전) 빈 목록 */
export function relevantGaps(view: TutorialView, useCase: UseCase) {
  return view.gaps.filter(g => g.keys.some(k => useCase.targets.assetKeys.includes(k)))
}

export function outsideKeys(view: TutorialView, useCase: UseCase): string[] {
  return [...new Set([...useCase.targets.outsidePersonKeys, ...relevantGaps(view, useCase).flatMap(g => g.outsideKeys)])]
}

const hasLogEvidence = (turn: ConversationTurn) => !!turn.result && (
  turn.result.evidence.some(e => e.kind === 'event' || e.kind === 'event_link' || typeof e.data?.executedSpl === 'string')
  || !!turn.result.eventGraph?.nodes.length)

/** 단계(1부터)를 마쳤는지. 판정은 설정의 단계 판정 종류(check)를 따른다. marks[n] 은 n 단계를 시작한 때 */
export function stepDone(step: number, view: TutorialView, marks: Readonly<Record<number, StepMark>>, useCase: UseCase): boolean {
  const { targets } = useCase
  const check = useCase.steps[step - 1]?.check
  const since = (n: number) => answeredSince(view, marks[n] ?? markOf({ ...view, turns: [] }))
  if (check === 'threat') return view.page === 'Threat'
  if (check === 'read') return true
  if (check === 'answer') return since(step).length > 0
  if (check === 'graph') {
    // 그래프에 자산(또는 연동 경로의 객체)을 넘겨 연 때. 경로는 설정과 자산을 지나는 Access Gap 의 경로
    const key = view.graphEntry.objectKey
    const path = new Set([...targets.assetKeys, ...targets.pathKeys, ...relevantGaps(view, useCase).flatMap(g => g.keys)])
    return view.page === 'Graph' && view.graphEntry.key > (marks[step]?.graphEntryKey ?? -1) && !!key && path.has(key)
  }
  if (check === 'gap') {
    // 답변 근거나 이동 단추에 자산을 지나는 Access Gap 이 붙은 때. 그런 Gap 을 아직 못 읽었으면 어느 Gap 이든 센다
    const ids = new Set(relevantGaps(view, useCase).map(g => g.id))
    const fits = (id: unknown) => typeof id === 'string' && (!ids.size || ids.has(id))
    return since(step).some(t => t.result?.evidence.some(e => fits(e.data?.gapId)) || t.result?.navigation?.some(n => fits(n.gapId)))
  }
  if (check === 'outside') {
    // 차집합 사람을 골라(선택이나 답의 대상) 질문했거나 안내의 추천 질문을 보낸 때
    const outside = new Set(outsideKeys(view, useCase))
    const questions = new Set(useCase.steps[step - 1].prompts.map(p => p.question))
    const about = (t: ConversationTurn) => [t.focus?.sourceKey, t.focus?.targetKey, t.contextFocus.sourceKey, ...(t.workspace?.selection.objectKeys ?? [])]
    return since(step).some(t => questions.has(t.question) || about(t).some(k => !!k && outside.has(k)))
  }
  if (check === 'log') {
    // 앞 단계부터 받은 답 가운데 로그 근거가 있는 답이 있고, Event Board 로 옮긴 때
    return view.page === 'EventBoard' && since(Math.max(1, step - 1)).some(hasLogEvidence)
  }
  if (check === 'leak') {
    // 보드에 올라간 AI 결과 가운데 유출 이벤트가 있는 때. 차집합 사람 키를 알면 그 사람이 낀 이벤트만 센다
    const outside = new Set(targets.outsidePersonKeys)
    return view.page === 'EventBoard' && since(Math.max(1, step - 1)).some(t => t.result?.eventGraph?.nodes.some(node =>
      targets.leakEventPatterns.some(p => p.test(`${node.label} ${node.detail}`))
      && (!outside.size || node.participants.some(part => outside.has(part.objectKey)))))
  }
  return false
}
