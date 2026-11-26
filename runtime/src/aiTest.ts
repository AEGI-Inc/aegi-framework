import { providerKind, resolveProvider, type ModelTurn } from '../dashboard/server/assistant/provider.ts'
import { AssistantError, type AssistantEnv } from '../dashboard/server/assistant/planner.ts'
import { resolveReasoningEffort, type ProviderName, type ReasoningEffort } from '../dashboard/src/assistant/reasoning.ts'
import { assistantEnv, defaultModel, type AiTestRecord } from './env.ts'
import { maskSecrets } from './server.ts'

export interface AiTestResponse {
  ok: boolean
  provider: string
  model: string
  effort: ReasoningEffort | null
  servedModel?: string
  ms: number
  error?: {
    code: string
    status?: number
    message?: string
  }
}

export interface AiModelsResponse {
  ok: boolean
  provider: string
  models: string[]
  defaultModel: string
  error?: string
}

export function extractErrorMessage(text: string): string | undefined {
  try {
    const data = JSON.parse(text)
    if (!data) return undefined
    if (data.error) {
      if (typeof data.error.message === 'string') return data.error.message
      if (Array.isArray(data.error.message) && data.error.message.length > 0) {
        const first = data.error.message[0]
        return typeof first === 'string' ? first : (first?.message || JSON.stringify(first))
      }
      if (Array.isArray(data.error) && data.error.length > 0) {
        const first = data.error[0]
        return typeof first === 'string' ? first : (first?.message || JSON.stringify(first))
      }
      if (typeof data.error === 'string') return data.error
    }
    if (typeof data.message === 'string') return data.message
  } catch {
    // not JSON
  }
  const trimmed = text.trim()
  return trimmed || undefined
}

export function maskApiKey(text: string, apiKey?: string): string {
  let masked = text
  if (apiKey && apiKey.length >= 4) {
    masked = masked.replaceAll(apiKey, '***')
  }
  return maskSecrets(masked)
}

const OPENAI_EXCLUDE_REGEX = /embedding|tts|transcribe|audio|realtime|image|dall-e|whisper|moderation|search|computer-use|codex|sora|davinci|babbage|instruct/i
const GEMINI_EXCLUDE_REGEX = /embedding|aqa|imagen|veo|tts/i

/** 저장된 키는 저장된 공급자의 키다. 다른 공급자로 바꿔 시험할 때 그 키를 보내지 않는다 */
function savedKeyFor(provider: string, currentAi: ReturnType<typeof assistantEnv>): string {
  if (!currentAi.AEGI_ASSISTANT_API_KEY) return ''
  const saved = currentAi.AEGI_ASSISTANT_PROVIDER || providerKind(currentAi)
  return saved === provider ? currentAi.AEGI_ASSISTANT_API_KEY : ''
}

const keyRequired = (provider: string) => `${provider} API 키를 입력하세요. 저장된 키는 다른 공급자의 키입니다.`

export async function runAiTest(
  body: { provider?: unknown; model?: unknown; apiKey?: unknown; effort?: unknown },
  currentEnv: Record<string, string>,
  customFetch?: typeof fetch,
): Promise<{ result: AiTestResponse; record: AiTestRecord }> {
  const currentAi = assistantEnv(currentEnv)
  const reqProvider = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim().toLowerCase() : undefined
  const reqModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined
  const reqApiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined
  const reqEffort = typeof body.effort === 'string' && body.effort.trim() ? body.effort.trim() : undefined

  const provider = (reqProvider || currentAi.AEGI_ASSISTANT_PROVIDER || (currentAi.AEGI_ASSISTANT_API_KEY ? providerKind(currentAi) : null) || 'anthropic') as ProviderName
  const isDifferentProvider = Boolean(reqProvider && reqProvider !== (currentAi.AEGI_ASSISTANT_PROVIDER || ''))

  let model: string
  if (reqModel) {
    model = reqModel
  } else if (isDifferentProvider) {
    model = defaultModel(reqProvider!)
  } else {
    model = currentAi.AEGI_ASSISTANT_MODEL || defaultModel(provider)
  }

  const effortSetting = reqEffort !== undefined ? reqEffort : (isDifferentProvider ? '' : (currentEnv.AEGI_ASSISTANT_REASONING_EFFORT || ''))
  const effectiveEffort = resolveReasoningEffort(provider, model, effortSetting)

  const apiKey = reqApiKey || savedKeyFor(provider, currentAi)
  if (!apiKey) {
    const message = currentAi.AEGI_ASSISTANT_API_KEY ? keyRequired(provider) : 'API 키가 설정되지 않았습니다.'
    return {
      result: { ok: false, provider, model, effort: effectiveEffort, ms: 0, error: { code: 'key_required', message } },
      record: { ok: false, provider, model, effort: effectiveEffort, at: new Date().toISOString(), message },
    }
  }

  const startedAt = Date.now()
  const lastError: { response: { status: number; bodyText: string } | null } = { response: null }

  const wrappedFetch: typeof fetch = async (input, init) => {
    const baseFetch = customFetch ?? fetch
    const res = await baseFetch(input, init)
    if (!res.ok) {
      try {
        const clone = res.clone()
        const text = await clone.text()
        lastError.response = { status: res.status, bodyText: text }
      } catch {
        // ignore clone error
      }
    }
    return res
  }

  const testEnv: AssistantEnv = {
    AEGI_ASSISTANT_PROVIDER: provider,
    AEGI_ASSISTANT_MODEL: model,
    AEGI_ASSISTANT_API_KEY: apiKey,
    AEGI_ASSISTANT_BASE_URL: currentAi.AEGI_ASSISTANT_BASE_URL,
    AEGI_ASSISTANT_REASONING_EFFORT: effortSetting,
  }

  const signal = AbortSignal.timeout(30_000)
  const turn: ModelTurn = {
    // Claude 는 빈 글 블록과 빈 system 을 400 으로 거절한다. 채팅처럼 둘 다 채워 보낸다
    system: ['AEGI 연결 시험입니다.'],
    context: '연결 시험이라 맥락 데이터는 없습니다.',
    question: '연결 시험입니다. ok 라고만 답하세요.',
    images: [],
    rounds: [],
    tail: [],
    noTools: false,
  }

  try {
    const assistantProvider = resolveProvider(testEnv, { fetch: wrappedFetch })
    const reply = await assistantProvider.reply(turn, signal)
    const ms = Date.now() - startedAt
    const status = 200

    console.log(`[AI test] provider=${provider} model=${model} effort=${effectiveEffort ?? 'n/a'} ok=true status=${status}`)

    const result: AiTestResponse = {
      ok: true,
      provider,
      model,
      effort: effectiveEffort,
      ...(reply.model ? { servedModel: reply.model } : {}),
      ms,
    }
    const record: AiTestRecord = {
      ok: true,
      provider,
      model,
      effort: effectiveEffort,
      at: new Date().toISOString(),
    }
    return { result, record }
  } catch (err) {
    const ms = Date.now() - startedAt
    const lastErrorResponse = lastError.response
    let status: number | undefined = lastErrorResponse?.status
    let code: string
    let message: string | undefined

    if (signal.aborted || (err instanceof Error && err.name === 'TimeoutError')) {
      code = 'timeout'
      message = '요청 시간이 초과되었습니다.'
    } else if (err instanceof AssistantError) {
      code = err.code
      if (status === undefined) status = err.status
    } else {
      code = 'network_error'
    }

    if (lastErrorResponse?.bodyText) {
      message = extractErrorMessage(lastErrorResponse.bodyText)
    } else if (!message && err instanceof Error) {
      message = err.message
    }

    if (message) {
      message = maskApiKey(message, apiKey)
    }

    console.log(`[AI test] provider=${provider} model=${model} effort=${effectiveEffort ?? 'n/a'} ok=false status=${status ?? ''}`)

    const result: AiTestResponse = {
      ok: false,
      provider,
      model,
      effort: effectiveEffort,
      ms,
      error: {
        code,
        ...(status !== undefined ? { status } : {}),
        ...(message ? { message } : {}),
      },
    }
    const record: AiTestRecord = {
      ok: false,
      provider,
      model,
      effort: effectiveEffort,
      at: new Date().toISOString(),
      ...(message ? { message } : {}),
    }
    return { result, record }
  }
}

export async function fetchAiModels(
  body: { provider?: unknown; apiKey?: unknown },
  currentEnv: Record<string, string>,
  customFetch?: typeof fetch,
): Promise<AiModelsResponse> {
  const currentAi = assistantEnv(currentEnv)
  const reqProvider = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim().toLowerCase() : undefined
  const reqApiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined

  const provider = reqProvider || currentAi.AEGI_ASSISTANT_PROVIDER || (currentAi.AEGI_ASSISTANT_API_KEY ? providerKind(currentAi) : null) || 'anthropic'
  const apiKey = reqApiKey || savedKeyFor(provider, currentAi)
  const defModel = defaultModel(provider)

  if (!apiKey) {
    return {
      ok: false,
      provider,
      models: [],
      defaultModel: defModel,
      error: currentAi.AEGI_ASSISTANT_API_KEY ? keyRequired(provider) : 'API 키가 설정되지 않았습니다.',
    }
  }

  const baseUrl = currentAi.AEGI_ASSISTANT_BASE_URL
  let url: string
  const headers: Record<string, string> = {}

  if (baseUrl) {
    const cleanBase = baseUrl.replace(/\/+$/, '')
    if (provider === 'anthropic') {
      url = `${cleanBase}/v1/models?limit=1000`
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      url = `${cleanBase}/models`
      headers['Authorization'] = `Bearer ${apiKey}`
    }
  } else {
    if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/models?limit=1000'
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else if (provider === 'gemini') {
      url = 'https://generativelanguage.googleapis.com/v1beta/openai/models'
      headers['Authorization'] = `Bearer ${apiKey}`
    } else {
      url = 'https://api.openai.com/v1/models'
      headers['Authorization'] = `Bearer ${apiKey}`
    }
  }

  const signal = AbortSignal.timeout(30_000)
  try {
    const doFetch = customFetch ?? fetch
    const res = await doFetch(url, { method: 'GET', headers, signal })
    if (!res.ok) {
      let rawText = ''
      try { rawText = await res.text() } catch { /* ignore */ }
      const errMsg = extractErrorMessage(rawText) || `HTTP ${res.status}`
      return {
        ok: false,
        provider,
        models: [],
        defaultModel: defModel,
        error: maskApiKey(errMsg, apiKey),
      }
    }

    const payload = (await res.json()) as { data?: Array<{ id?: string } | string>; models?: Array<{ id?: string; name?: string } | string> }
    const rawList: string[] = []
    if (Array.isArray(payload?.data)) {
      for (const item of payload.data) {
        if (typeof item === 'string') rawList.push(item)
        else if (item && typeof item.id === 'string') rawList.push(item.id)
      }
    } else if (Array.isArray(payload?.models)) {
      for (const item of payload.models) {
        if (typeof item === 'string') rawList.push(item)
        else if (item && typeof item.name === 'string') rawList.push(item.name)
        else if (item && typeof item.id === 'string') rawList.push(item.id)
      }
    }

    const filtered = new Set<string>()
    for (const raw of rawList) {
      let id = raw.trim()
      if (!id) continue
      if (provider === 'gemini') {
        if (id.startsWith('models/')) id = id.slice(7)
        if (GEMINI_EXCLUDE_REGEX.test(id)) continue
      } else {
        if (OPENAI_EXCLUDE_REGEX.test(id)) continue
      }
      filtered.add(id)
    }

    const models = Array.from(filtered).sort((a, b) => a.localeCompare(b))
    return {
      ok: true,
      provider,
      models,
      defaultModel: defModel,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      provider,
      models: [],
      defaultModel: defModel,
      error: maskApiKey(msg, apiKey),
    }
  }
}
