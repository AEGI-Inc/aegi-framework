/**
 * 화면 설명 문구를 만드는 모델 호출. 출력 형식(JSON 스키마)을 강제하고 결과 JSON 을 돌려준다.
 * Claude 는 Anthropic SDK, Gemini 와 OpenAI 는 OpenAI 호환 chat completions 로 부른다(대시보드 server/assistant/provider.ts 와 같은 규칙).
 *
 * 설정은 AEGI_DISPLAY_TEXT_* 가 먼저고, 비어 있으면 같은 이름의 AEGI_ASSISTANT_* 를 쓴다.
 */
import Anthropic from '@anthropic-ai/sdk'

export type ProviderKind = 'anthropic' | 'gemini' | 'openai'

const DEFAULT_BASE: Record<ProviderKind, string> = {
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
}

export interface ModelSettings { kind: ProviderKind; apiKey: string; model: string; base: string }

export interface ModelCall { system: string; user: string; schema: Record<string, unknown>; name: string }

export interface ModelClient {
  model: string
  complete(call: ModelCall): Promise<unknown>
}

const pick = (env: NodeJS.ProcessEnv, name: string) => env[`AEGI_DISPLAY_TEXT_${name}`]?.trim() || env[`AEGI_ASSISTANT_${name}`]?.trim() || ''

/** 설정이 모자라면 무엇이 없는지 알리는 오류를 던진다. 키 값은 메시지에 넣지 않는다 */
export function modelSettings(env: NodeJS.ProcessEnv = process.env): ModelSettings {
  const apiKey = pick(env, 'API_KEY'), model = pick(env, 'MODEL'), named = pick(env, 'PROVIDER').toLowerCase(), baseUrl = pick(env, 'BASE_URL')
  const missing = [!apiKey && 'API_KEY', !model && 'MODEL'].filter(Boolean)
  if (missing.length) throw new Error(`AI 설정이 없다: AEGI_DISPLAY_TEXT_${missing.join(', AEGI_DISPLAY_TEXT_')} (또는 AEGI_ASSISTANT_*)`)
  let kind: ProviderKind
  if (named) {
    const k = named === 'claude' ? 'anthropic' : named
    if (!Object.hasOwn(DEFAULT_BASE, k)) throw new Error(`모르는 AI 제공자: ${named} (anthropic, gemini, openai)`)
    kind = k as ProviderKind
  } else if (model.startsWith('claude-')) kind = 'anthropic'
  else if (baseUrl.includes('generativelanguage.googleapis.com')) kind = 'gemini'
  else kind = 'openai'
  const base = new URL(baseUrl || DEFAULT_BASE[kind])
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('AI 주소는 https 만, 계정, 쿼리 없이 쓴다')
  return { kind, apiKey, model, base: base.href.replace(/\/$/, '') }
}

function parseJson(text: string, name: string): unknown {
  try { return JSON.parse(text) } catch { throw new Error(`${name}: 모델 응답이 JSON 이 아니다`) }
}

function anthropicClient(s: ModelSettings, fetchImpl?: typeof fetch): ModelClient {
  const client = new Anthropic({ apiKey: s.apiKey, baseURL: s.base, maxRetries: 2, ...(fetchImpl ? { fetch: fetchImpl } : {}) })
  // Haiku 4.5 는 effort 와 서버 대체 모델을 받지 않는다
  const extra = s.model.startsWith('claude-haiku-') ? {} : { fallbacks: 'default' as const, betas: ['server-side-fallback-2026-07-01'] }
  return {
    model: s.model,
    async complete(call) {
      const response = await client.beta.messages.create({
        model: s.model,
        max_tokens: 8192,
        system: call.system,
        messages: [{ role: 'user', content: call.user }],
        output_config: { format: { type: 'json_schema', schema: call.schema }, ...(s.model.startsWith('claude-haiku-') ? {} : { effort: 'low' as const }) },
        ...extra,
      })
      if (response.stop_reason === 'refusal') throw new Error(`${call.name}: 모델이 거절했다`)
      if (response.stop_reason === 'max_tokens') throw new Error(`${call.name}: 응답이 잘렸다(max_tokens)`)
      const text = response.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('')
      return parseJson(text, call.name)
    },
  }
}

function chatCompletionsClient(s: ModelSettings, fetchImpl: typeof fetch = fetch): ModelClient {
  return {
    model: s.model,
    async complete(call) {
      const response = await fetchImpl(`${s.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify({
          model: s.model,
          messages: [{ role: 'system', content: call.system }, { role: 'user', content: call.user }],
          response_format: { type: 'json_schema', json_schema: { name: call.name.replace(/[^a-zA-Z0-9_-]/g, '_'), schema: call.schema, strict: true } },
          ...(s.kind === 'gemini' ? { reasoning_effort: 'low' } : { store: false }),
        }),
      })
      if (!response.ok) throw new Error(`${call.name}: 모델 호출 실패 HTTP ${response.status}`)
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string; refusal?: string }; finish_reason?: string }> }
      const choice = payload.choices?.[0]
      if (choice?.message?.refusal) throw new Error(`${call.name}: 모델이 거절했다`)
      if (choice?.finish_reason === 'length') throw new Error(`${call.name}: 응답이 잘렸다`)
      return parseJson(choice?.message?.content ?? '', call.name)
    },
  }
}

export function createModelClient(s: ModelSettings, fetchImpl?: typeof fetch): ModelClient {
  return s.kind === 'anthropic' ? anthropicClient(s, fetchImpl) : chatCompletionsClient(s, fetchImpl)
}
