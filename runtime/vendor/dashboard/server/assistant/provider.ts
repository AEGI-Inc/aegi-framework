import Anthropic from '@anthropic-ai/sdk'
import { MODEL_TOOLS, modelToolJson, type ClaudeTurnBlock, type KgRound } from '../../src/assistant/chatProtocol'
import type { AssistantImage } from '../../src/assistant/images'
import { AssistantError, readBoundedText, type AssistantEnv, type PlannerDeps } from './planner'
import { resolveReasoningEffort, type ReasoningEffort } from '../../src/assistant/reasoning'

/** Provider-neutral input for one chat step. Each provider renders it into its own wire format. */
/** system: fixed rules first, then parts that change (log source list, clock). Claude caches the first two for an hour. */
export interface ModelTurn { system: string[]; context: string; question: string; images: AssistantImage[]; rounds: KgRound[]; tail: string[]; noTools: boolean }
/** Provider reply normalized to the chat-completions vocabulary the step validation uses. */
export interface ModelReply { toolCalls: unknown[]; content?: unknown; finish: string; refusal: boolean; model?: string; usage?: ModelUsage }
/** Token counts as the provider reports them. Claude input excludes cache reads; chat-completions input includes them. Unreported stays undefined, never 0. */
export interface ModelUsage { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
export type ProviderKind = 'anthropic' | 'gemini' | 'openai'
export interface AssistantProvider { kind: ProviderKind; reply(turn: ModelTurn, signal: AbortSignal): Promise<ModelReply> }

const defaultBase: Record<ProviderKind, string> = {
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
}

/** AEGI_ASSISTANT_PROVIDER wins; otherwise the model name and base URL decide, as before this setting existed. */
export function providerKind(env: AssistantEnv): ProviderKind | null {
  const named = env.AEGI_ASSISTANT_PROVIDER?.trim().toLowerCase()
  if (named) return named === 'claude' ? 'anthropic' : (Object.hasOwn(defaultBase, named) ? named as ProviderKind : null)
  if (env.AEGI_ASSISTANT_MODEL?.startsWith('claude-')) return 'anthropic'
  try { if (env.AEGI_ASSISTANT_BASE_URL && new URL(env.AEGI_ASSISTANT_BASE_URL).hostname === 'generativelanguage.googleapis.com') return 'gemini' } catch { /* validated below */ }
  return 'openai'
}

/** Validated provider and API root. Throws not_configured before any network call. */
export function providerEndpoint(env: AssistantEnv): { kind: ProviderKind; base: URL } {
  const kind = providerKind(env)
  if (!kind || !env.AEGI_ASSISTANT_API_KEY || !env.AEGI_ASSISTANT_MODEL) throw new AssistantError('not_configured', 503)
  let base: URL
  try { base = new URL(env.AEGI_ASSISTANT_BASE_URL || defaultBase[kind]) } catch { throw new AssistantError('not_configured', 503) }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new AssistantError('not_configured', 503)
  return { kind, base }
}

export function resolveProvider(env: AssistantEnv, deps: PlannerDeps): AssistantProvider {
  const { kind, base } = providerEndpoint(env)
  const effort = resolveReasoningEffort(kind, env.AEGI_ASSISTANT_MODEL!, env.AEGI_ASSISTANT_REASONING_EFFORT)
  const config = { apiKey: env.AEGI_ASSISTANT_API_KEY!, model: env.AEGI_ASSISTANT_MODEL!, root: base.href.replace(/\/$/, ''), effort, fetch: deps.fetch }
  return { kind, reply: (turn, signal) => kind === 'anthropic' ? anthropicReply(config, turn, signal) : chatCompletionsReply(config, kind, turn, signal) }
}

type ProviderConfig = { apiKey: string; model: string; root: string; effort: ReasoningEffort | null; fetch?: typeof fetch }

async function chatCompletionsReply(config: ProviderConfig, kind: ProviderKind, turn: ModelTurn, signal: AbortSignal): Promise<ModelReply> {
  const question = turn.images.length ? [{ type: 'text', text: turn.question }, ...turn.images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } }))] : turn.question
  const messages: unknown[] = [{ role: 'system', content: turn.system.join('\n') }, { role: 'user', content: turn.context }, { role: 'user', content: question }]
  for (const round of turn.rounds) {
    messages.push({ role: 'assistant', content: null, tool_calls: round.calls.map(({ extra_content, ...call }) => extra_content?.google ? { ...call, extra_content: { google: extra_content.google } } : call) })
    round.calls.forEach((call, i) => messages.push({ role: 'tool', tool_call_id: call.id, content: modelToolJson(round.outputs[i]) }))
  }
  turn.tail.forEach(text => messages.push({ role: 'user', content: text }))
  const response = await (config.fetch ?? fetch)(`${config.root}/chat/completions`, {
    method: 'POST', signal, headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, ...(kind === 'openai' ? { store: false } : {}), ...(config.effort !== null ? { reasoning_effort: config.effort } : {}), max_completion_tokens: 4096,
      messages, tools: MODEL_TOOLS, tool_choice: turn.noTools ? 'none' : 'auto' }),
  })
  if (!response.ok) throw new AssistantError('model_unavailable', 502)
  let payload
  try { payload = JSON.parse(await readBoundedText(response.body, 131_072)) } catch { throw new AssistantError('invalid_plan', 502) }
  const choice = payload.choices?.[0], message = choice?.message
  if (!message) throw new AssistantError('invalid_plan', 502)
  const usage = payload.usage && { input: payload.usage.prompt_tokens, output: payload.usage.completion_tokens, cacheRead: payload.usage.prompt_tokens_details?.cached_tokens }
  return { toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [], content: message.content, finish: choice.finish_reason, refusal: !!message.refusal, model: payload.model, usage }
}

const imageBlock = (image: AssistantImage) => {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(image.dataUrl)
  if (!match) throw new AssistantError('bad_question', 400)
  return { type: 'image' as const, source: { type: 'base64' as const, media_type: match[1] as 'image/png' | 'image/jpeg' | 'image/webp', data: match[2] } }
}

async function anthropicReply(config: ProviderConfig, turn: ModelTurn, signal: AbortSignal): Promise<ModelReply> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: [{ type: 'text', text: turn.context }, { type: 'text', text: turn.question }, ...turn.images.map(imageBlock)] }]
  for (const round of turn.rounds) {
    // Thinking blocks go back unchanged before their tool_use, or the next round loses that reasoning.
    messages.push({ role: 'assistant', content: round.calls.flatMap(call => [...(call.extra_content?.anthropic?.before ?? []), { type: 'tool_use' as const, id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) }]) })
    messages.push({ role: 'user', content: round.calls.map((call, i) => ({ type: 'tool_result' as const, tool_use_id: call.id, content: modelToolJson(round.outputs[i]) })) })
  }
  // Appended after the tool results so earlier turns stay unchanged and their thinking blocks remain valid.
  if (turn.tail.length) messages.push({ role: 'user', content: turn.tail.join('\n') })
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.root, maxRetries: 0, ...(config.fetch ? { fetch: config.fetch } : {}) })
  const response = await client.beta.messages.create({
    model: config.model, max_tokens: 8192, messages, cache_control: { type: 'ephemeral' },
    // Rules and the log source list are read from cache by every question for an hour; only the clock and the question are new.
    // An hour because questions often come more than five minutes apart. Longer TTL entries must come before the 5-minute tail.
    system: turn.system.map((text, i) => ({ type: 'text' as const, text, ...(i < 2 && turn.system.length > 2 ? { cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } } : {}) })),
    tools: MODEL_TOOLS.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters as unknown as Anthropic.Beta.BetaTool.InputSchema })),
    tool_choice: { type: turn.noTools ? 'none' : 'auto' },
    // Haiku 4.5 has no adaptive thinking, effort or fallbacks. Newer models think adaptively at low effort.
    // drop_block keeps a request valid when the minute in the system prompt changes between rounds.
    // Haiku 5.5 thinks by default and runs the same history check, so it needs drop_block too. Fallbacks stay off.
    ...(config.model.startsWith('claude-haiku-4-') ? {} : config.model.startsWith('claude-haiku-') ? {
      thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }, output_config: { effort: config.effort as 'low' | 'medium' | 'high' }, betas: ['thinking-binding-controls-2026-08-01'],
    } : {
      thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }, output_config: { effort: config.effort as 'low' | 'medium' | 'high' },
      fallbacks: 'default', betas: ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'],
    }),
  }, { signal })
  const toolCalls: unknown[] = [], text: string[] = []
  let before: ClaudeTurnBlock[] = []
  for (const block of response.content) {
    if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) }, ...(before.length ? { extra_content: { anthropic: { before } } } : {}) })
      before = []
    } else if (block.type === 'thinking') before.push({ type: 'thinking', thinking: block.thinking, signature: block.signature })
    else if (block.type === 'redacted_thinking') before.push({ type: 'redacted_thinking', data: block.data })
    else if (block.type === 'text' && block.text.trim()) { before.push({ type: 'text', text: block.text }); text.push(block.text) }
  }
  const finish = response.stop_reason === 'end_turn' ? 'stop' : response.stop_reason === 'tool_use' ? 'tool_calls' : String(response.stop_reason)
  const usage = { input: response.usage.input_tokens, output: response.usage.output_tokens, cacheRead: response.usage.cache_read_input_tokens ?? undefined, cacheWrite: response.usage.cache_creation_input_tokens ?? undefined }
  // With server-side fallback the served model can differ from config.model.
  return { toolCalls, content: toolCalls.length ? undefined : text.join(''), finish, refusal: response.stop_reason === 'refusal', model: response.model, usage }
}
