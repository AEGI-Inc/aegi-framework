export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high'
export type ProviderName = 'anthropic' | 'gemini' | 'openai'

const GPT5_FAMILY = /^gpt-5(-mini|-nano|-pro)?(-\d{4}-\d{2}-\d{2})?$/

/** 이 공급자, 모델이 도구 호출과 함께 받는 추론 강도 목록과 자동 값. options 가 비면 「해당 없음」(보내지 않는다) */
export function reasoningOptions(provider: ProviderName, model: string): { options: ReasoningEffort[]; auto: ReasoningEffort | null } {
  const p = (provider || '').trim().toLowerCase()
  const m = (model || '').trim().toLowerCase()

  if (p === 'openai') {
    if (m.startsWith('gpt-3.5') || m.startsWith('gpt-4') || m.endsWith('-chat-latest') || m.endsWith('chat-latest')) {
      return { options: [], auto: null }
    }
    if (GPT5_FAMILY.test(m)) {
      return { options: ['minimal', 'low', 'medium', 'high'], auto: 'low' }
    }
    return { options: ['none'], auto: 'none' }
  }

  if (p === 'anthropic') {
    if (m.startsWith('claude-haiku-4-') || m === 'claude-haiku-4') {
      return { options: [], auto: null }
    }
    return { options: ['low', 'medium', 'high'], auto: 'low' }
  }

  if (p === 'gemini') {
    return { options: ['none', 'low', 'medium', 'high'], auto: 'low' }
  }

  return { options: [], auto: null }
}

/** 설정값(빈 값, 'auto', 목록 밖 값은 자동)을 실제로 보낼 값으로. null 이면 보내지 않는다 */
export function resolveReasoningEffort(provider: ProviderName, model: string, setting?: string): ReasoningEffort | null {
  const { options, auto } = reasoningOptions(provider, model)
  const normalized = setting?.trim().toLowerCase() as ReasoningEffort | undefined
  if (normalized && options.includes(normalized)) return normalized
  return auto
}
