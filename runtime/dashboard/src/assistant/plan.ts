import { ALLOWED_RELATION_TYPES } from '../model/relation'

// 데이터에 들어온 SaaS. 새 SaaS를 연동하면 여기에도 더해야 AI가 그 SaaS로 좁혀 찾는다
export const PROVIDERS = ['slack', 'github', 'okta', 'gws', 'atlassian', 'salesforce'] as const
export type AssistantProvider = typeof PROVIDERS[number]
export type EntitySelector = { text: string; provider?: AssistantProvider; reference?: never }
  | { reference: 'source' | 'target'; text?: never; provider?: never }
export type AssistantPlan =
  | { intent: 'object_lookup' | 'identity_lookup'; entity: EntitySelector }
  | { intent: 'finding_explain'; findingId?: string }
  | { intent: 'remediation_suggest'; findingId?: string }
  | { intent: 'access_analyze'; entity: EntitySelector; target?: EntitySelector; minimum?: 'read' | 'write' | 'admin'; mode?: 'direct' | 'derived' | 'all' }
  | { intent: 'path_lookup'; entity: EntitySelector; target: EntitySelector; maxHops?: number; directed?: boolean; relationTypes?: string[]; identity?: 'all' | 'person' | 'none' }
  | { intent: 'credential_risk'; entity?: EntitySelector; provider?: AssistantProvider }
  | { intent: 'conversation'; answer?: string }
  | { intent: 'unsupported' }

export interface AssistantFocus { sourceKey?: string; targetKey?: string; findingId?: string; eventKey?: string }
export interface AssistantTurn { question: string; plan: AssistantPlan }
export interface AssistantConversation {
  history: AssistantTurn[]
  focus: { source: boolean; target: boolean; finding: boolean }
}
export const QUESTION_LIMIT = 1000
export const CANDIDATE_LIMIT = 20
export const HISTORY_LIMIT = 6
export const CONVERSATION_ANSWER_LIMIT = 2000
export const BODY_LIMIT = 32768
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key))
const selector = (value: unknown): value is EntitySelector => record(value) && (
  (only(value, ['reference']) && (value.reference === 'source' || value.reference === 'target')) ||
  (only(value, ['text', 'provider']) && typeof value.text === 'string' && !!value.text.trim() && value.text.length <= 200 &&
    (value.provider === undefined || PROVIDERS.includes(value.provider as AssistantProvider)))
)
const oneOf = (value: unknown, values: readonly unknown[]) => value === undefined || values.includes(value)

/** Only bounded declarative queries can reach the graph. */
export function parseAssistantPlan(value: unknown): AssistantPlan | null {
  if (!record(value)) return null
  if (value.intent === 'conversation' && only(value, ['intent', 'answer']) &&
    (value.answer === undefined || (typeof value.answer === 'string' && !!value.answer.trim() && value.answer.length <= CONVERSATION_ANSWER_LIMIT))) return value as AssistantPlan
  if (value.intent === 'credential_risk' && only(value, ['intent', 'entity', 'provider']) &&
    (value.entity === undefined || selector(value.entity)) && oneOf(value.provider, PROVIDERS)) return value as AssistantPlan
  if (value.intent === 'unsupported' && only(value, ['intent'])) return { intent: 'unsupported' }
  if ((value.intent === 'finding_explain' || value.intent === 'remediation_suggest') && only(value, ['intent', 'findingId']) &&
    (value.findingId === undefined || (typeof value.findingId === 'string' && /^FND-(?:[A-Z]{3}-[0-9A-F]{8}|[A-Z]-\d{3})$/.test(value.findingId)))) return value as AssistantPlan
  if ((value.intent === 'object_lookup' || value.intent === 'identity_lookup') && only(value, ['intent', 'entity']) && selector(value.entity)) return value as AssistantPlan
  if (value.intent === 'access_analyze' && only(value, ['intent', 'entity', 'target', 'minimum', 'mode']) && selector(value.entity) &&
    (value.target === undefined || selector(value.target)) && oneOf(value.minimum, ['read', 'write', 'admin']) && oneOf(value.mode, ['direct', 'derived', 'all'])) return value as AssistantPlan
  if (value.intent === 'path_lookup' && only(value, ['intent', 'entity', 'target', 'maxHops', 'directed', 'relationTypes', 'identity']) && selector(value.entity) && selector(value.target) &&
    (value.maxHops === undefined || (Number.isInteger(value.maxHops) && Number(value.maxHops) >= 1 && Number(value.maxHops) <= 12)) &&
    (value.directed === undefined || typeof value.directed === 'boolean') && oneOf(value.identity, ['all', 'person', 'none']) &&
    (value.relationTypes === undefined || (Array.isArray(value.relationTypes) && value.relationTypes.length > 0 && value.relationTypes.length <= 17 && value.relationTypes.every(t => ALLOWED_RELATION_TYPES.has(t))))) return value as AssistantPlan
  return null
}

export function parseConversation(value: unknown): AssistantConversation | null {
  if (!record(value) || !only(value, ['history', 'focus']) || !Array.isArray(value.history) || value.history.length > HISTORY_LIMIT ||
    !record(value.focus) || !only(value.focus, ['source', 'target', 'finding']) || !['source', 'target', 'finding'].every(k => typeof (value.focus as Record<string, unknown>)[k] === 'boolean')) return null
  const history: AssistantTurn[] = []
  for (const turn of value.history) {
    if (!record(turn) || !only(turn, ['question', 'plan']) || typeof turn.question !== 'string' || !turn.question.trim() || turn.question.length > QUESTION_LIMIT) return null
    const plan = parseAssistantPlan(turn.plan)
    if (!plan) return null
    if (plan.intent === 'conversation' && plan.answer !== undefined) return null
    history.push({ question: turn.question, plan })
  }
  return { history, focus: value.focus as AssistantConversation['focus'] }
}

export const emptyConversation = (): AssistantConversation => ({ history: [], focus: { source: false, target: false, finding: false } })

/** Local-only interpretation for UI verification, never used in production. */
export function localFixturePlan(question: string, context = emptyConversation()): AssistantPlan {
  if (/^(안녕(?:하세요)?|하이|hello|hi)[!?.\s]*$/i.test(question.trim())) return { intent: 'conversation', answer: '안녕하세요. 계정과 권한, 연결 경로, 탐지와 자격증명 위험을 함께 확인할 수 있습니다.' }
  if (/^1\s*\+\s*1\s*(?:이|은)?\s*(?:뭐야|얼마야|=|\?)?[?\s]*$/.test(question.trim())) return { intent: 'conversation', answer: '1 + 1은 2입니다.' }
  if (/크리덴셜|자격증명|credential|토큰|token/i.test(question) && /위험|탈취|유출|영향|점검|우선|취약|분석/.test(question)) {
    return { intent: 'credential_risk', ...(/그 (?:토큰|자격증명|크리덴셜)/.test(question) && context.focus.source ? { entity: { reference: 'source' as const } } : {}),
      ...(/github/i.test(question) ? { provider: 'github' as const } : /okta/i.test(question) ? { provider: 'okta' as const } : /slack/i.test(question) ? { provider: 'slack' as const } : /google|gws/i.test(question) ? { provider: 'gws' as const } : {}) }
  }
  const findingId = question.match(/FND-(?:[A-Z]{3}-[0-9A-F]{8}|[A-Z]-\d{3})/i)?.[0]?.toUpperCase()
  if (/조치|추천|해결|막아/.test(question)) return findingId || context.focus.finding ? { intent: 'remediation_suggest', ...(findingId ? { findingId } : {}) } : { intent: 'unsupported' }
  if ((findingId || context.focus.finding) && /왜|이유|설명|탐지/.test(question)) return { intent: 'finding_explain', ...(findingId ? { findingId } : {}) }
  if (/탐지|Finding|왜|이유/i.test(question)) return { intent: 'unsupported' }
  const select = (text: string): EntitySelector => {
    const clean = text.trim().replace(/(?:의|은|는|이|가)$/, '').trim()
    if (/^(그 사람|그 계정|이 사람|이 계정|이 객체|그 객체|그 사용자)$/.test(clean) && context.focus.source) return { reference: 'source' }
    if (/^(그 대상|이 대상|그 자원|이 자원)$/.test(clean) && context.focus.target) return { reference: 'target' }
    const provider: AssistantProvider | undefined = /github/i.test(clean) ? 'github' : /okta/i.test(clean) ? 'okta' : /slack/i.test(clean) ? 'slack' : /google|workspace|gws/i.test(clean) ? 'gws' : /atlassian/i.test(clean) ? 'atlassian' : /salesforce/i.test(clean) ? 'salesforce' : undefined
    return { text: clean.replace(/(?:GitHub|Okta|Slack|Google Workspace|GWS|Atlassian|Salesforce)/gi, '').trim(), ...(provider ? { provider } : {}) }
  }
  if (/경로|연결선/.test(question)) {
    const pair = question.match(/^(.+?)(?:에서|부터)\s*(.+?)(?:까지|로|으로)\s*(?:가는\s*)?(?:경로|연결선)/)
    if (pair) return { intent: 'path_lookup', entity: select(pair[1]), target: select(pair[2]) }
    if (context.focus.source && context.focus.target) return { intent: 'path_lookup', entity: { reference: 'source' }, target: { reference: 'target' } }
    return { intent: 'unsupported' }
  }
  if (/권한|접근|읽|쓰|수정|관리|admin/i.test(question)) {
    if (/^(?:GitHub|Okta|Slack|Google Workspace|GWS|Atlassian|Salesforce)\s+(?:admin|관리자)\s*(?:알려줘)?$/i.test(question.trim())) return { intent: 'unsupported' }
    const pair = question.match(/^(.+?)(?:가|는|은)\s+(.+?)(?:에|을|를)\s+/)
    const minimum = /admin|관리자/i.test(question) ? 'admin' : /쓰|수정|write/i.test(question) ? 'write' : 'read'
    const mode = /자동화|통해|우회|사본|전달|파생/.test(question) ? 'derived' : 'all'
    const entity = pair ? select(pair[1]) : select(question.split(/의|\s+(?:권한|접근)/)[0])
    return { intent: 'access_analyze', entity, ...(pair ? { target: select(pair[2]) } : {}), minimum, mode }
  }
  const identity = /다른|연결|모든|전부|전체|SaaS/i.test(question)
  const text = question.replace(/^(?:객체|계정)\s+/, '').split(/의|\s+(?:계정|객체|연결)/)[0].replace(/찾아줘|보여줘|알려줘|검색|다른|전부|모든|전체/g, '').trim()
  const entity = select(text)
  const provider = select(question).provider
  return text ? { intent: identity ? 'identity_lookup' : 'object_lookup', entity: entity.reference ? entity : { ...entity, ...(provider ? { provider } : {}) } } : { intent: 'unsupported' }
}
