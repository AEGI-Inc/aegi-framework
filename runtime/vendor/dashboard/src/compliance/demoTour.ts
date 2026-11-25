import { isDemoMode } from '../demoMode'

/**
 * Compliance 시연 순서(데모 모드). 「데모 시연」 단추가 단계마다 화면 한 곳을 강조하며 넘어간다.
 * AI 단계는 아래 가이드라인 문장을 AI 에게 보낸다. AI 는 등록된 가이드라인(GUIDELINES)이라 guideline_criterion 으로 정해 둔 검사를 붙인다(결과가 매번 같다).
 * 가이드라인은 시연용 가상 문서다. 실제 강화 인증기준(안) 세부 가이드라인이 아니다.
 */
export const DEMO_CRITERION = '2.5.3'
export const DEMO_NAME = '사용자 인증 강화 (강화 인증기준(안))'
export const DEMO_GUIDELINE = '(가상 가이드라인) 강화된 인증수단: 중요 정보시스템에 접근하는 모든 인증 규칙은 피싱 방지 인증수단(phishingResistant)을 필수(REQUIRED)로 요구해야 한다. ' +
  '적응형 인증: 앱 로그인 규칙 중 접속 위치(network.connection)나 위험 수준(riskScore.level)을 조건으로 두는 규칙이 하나 이상 있어야 하며, 모든 위치(ANYWHERE)와 모든 위험 수준(ANY)에 같은 인증을 적용하는 규칙만으로는 충족하지 않는다.'
export const DEMO_QUESTION = `강화 인증기준 사용자 인증 항목의 예상 기준이야. 이 기준으로 ISMS-P 2.5.3을 다시 검사해 줘.\n\n${DEMO_GUIDELINE}`

const common = { criterion: DEMO_CRITERION, name: DEMO_NAME, source_title: '강화 인증기준 세부 가이드라인 (시연용 가상 문서)', source_text: DEMO_GUIDELINE, provider: 'okta', type: 'PolicyRule',
  filter: ['status=ACTIVE', 'actions.appSignOn.verificationMethod.factorMode exists'] }
/** AI가 부를 custom_criterion 인자 (검사 하나에 한 번) */
export const DEMO_TOOL_CALLS: Record<string, unknown>[] = [
  { ...common, question: '앱 로그인 규칙이 피싱 방지 인증수단을 필수로 요구하는가?',
    fields: ['actions.appSignOn.verificationMethod.factorMode', 'actions.appSignOn.verificationMethod.constraints'],
    condition: ['actions.appSignOn.verificationMethod.constraints has phishingResistant:REQUIRED'],
    condition_quote: '피싱 방지 인증수단(phishingResistant)을 필수(REQUIRED)로 요구', replaces_check: 'okta-029', combine: 'every_object' },
  { ...common, question: '접속 위치나 위험 수준에 따라 인증을 달리하는 앱 로그인 규칙이 있는가?',
    fields: ['conditions.network.connection', 'conditions.riskScore.level'],
    condition: ['conditions.network.connection not_in ANYWHERE', 'conditions.riskScore.level not_in ANY'], condition_join: 'any',
    condition_quote: '모든 위치(ANYWHERE)와 모든 위험 수준(ANY)에 같은 인증을 적용하는 규칙만으로는 충족하지 않는다', replaces_check: 'okta-058', combine: 'any_object' },
]

/**
 * 등록된 가이드라인. AI 가 받은 기준 문장이 여기 있는 문서면 검사를 직접 짜지 않고 guideline_criterion 에 id 만 넘긴다.
 * 그러면 정해 둔 검사(checks)가 같은 검증을 거쳐 붙어, 언제 물어도 결과가 같다(src/assistant/complianceTools.ts guidelineCriterion)
 */
export interface RegisteredGuideline { id: string; title: string; criterion: string; text: string; checks: Record<string, unknown>[] }
export const GUIDELINES: readonly RegisteredGuideline[] = [
  { id: 'isms-p-2027-user-auth-demo', title: '강화 인증기준 세부 가이드라인 (시연용 가상 문서)', criterion: DEMO_CRITERION, text: DEMO_GUIDELINE, checks: DEMO_TOOL_CALLS },
]

/** AI 에 등록할 가이드라인은 데모 빌드에서만 돌려준다. 시연 화면은 GUIDELINES 를 직접 쓴다. */
export function registeredGuidelines(): readonly RegisteredGuideline[] {
  return isDemoMode() ? GUIDELINES : []
}
