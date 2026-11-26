import type { ToolProgress } from './toolProgress'
import { collectionStatus, investigationStatus, standardFindings } from './supportTools'
import { complianceItem, complianceRemediationPlan, customCriterion, guidelineCriterion } from './complianceTools'
import { eventContext } from './eventContext'
import { CHAT_ROUNDS, KG_STREAM_TYPE, LOG_TOOLS, parseKgCall, type KgHistory, type KgRound, type KgStreamEvent, type LogToolOutput } from './chatProtocol'
import { executeKgTool, logToolExecution, mergeKgResults, SERVER_KG_TOOLS, usableExecution, type KgContext, type KgExecution } from './kgTools'
import type { KgCall } from './chatProtocol'
import { parseAssistantPlan, type AssistantPlan } from './plan'
import type { AssistantResult } from './types'
import type { AssistantImage } from './images'
import { EVENT_KG_TOOLS, executeEventTool, type EventReader } from './eventTools'
import { hasGuide } from './workspace'

export class ChatFailure extends Error {
  constructor(public code: string, public partial?: AssistantResult) { super(code) }
}
/** 서버 도구 실행 조건. 배포본(D1 스냅샷)에서만 준다 */
export interface RemoteTools {
  snapshotId: string
  /** 화면에 보이는 탐지 수 (예외 반영) */
  visibleFindings: number
  /** 화면이 아무도 쓰지 않는 플랫폼 기본 객체를 숨겼는가 */
  hideDefaults: boolean
}

/**
 * SERVER_KG_TOOLS 를 서버(D1 스냅샷)에서 실행한다 (server/graphTools.ts). 서버가 답하지 못하거나 스냅샷이 바뀌었으면
 * null 을 돌려준다. 그래프 도구는 브라우저에서 다시 실행할 수 있지만 이벤트 도구는 조회 불가를 반환한다.
 */
export async function executeRemoteTool(call: KgCall, index: number, remote: RemoteTools, signal: AbortSignal, request: typeof fetch = fetch): Promise<KgExecution | null> {
  try {
    const deadline = Date.now() + 120_000
    for (;;) {
      const response = await request('/api/measured/graph/tools', { method: 'POST', credentials: 'same-origin', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call, index, snapshotId: remote.snapshotId, visibleFindings: remote.visibleFindings, hideDefaults: remote.hideDefaults }) })
      if (response.status === 202 && EVENT_KG_TOOLS.has(call.function.name)) {
        if (Date.now() >= deadline) return null
        await new Promise<void>((resolve, reject) => {
          const stop = () => { clearTimeout(timer); reject(new ChatFailure('model_timeout')) }
          const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, 1000)
          signal.addEventListener('abort', stop, { once: true })
          if (signal.aborted) stop()
        })
        continue
      }
      if (!response.ok) return null
      const body = await response.json() as { execution?: KgExecution }
      return usableExecution(body.execution) ? body.execution : null
    }
  } catch {
    if (signal.aborted) throw new ChatFailure('model_timeout')
    return null
  }
}

/** A chat step that refused remote came from a Worker deployed before the server tool loop; later requests leave remote out. */
let serverLoop = true
/** The step reply as the JSON route sends it (the stream ends in the same shape). */
type StepReply = { ok: boolean; body: Awaited<ReturnType<Response['json']>> }

export async function runKgConversation(question: string, history: KgHistory[], context: KgContext, signal: AbortSignal,
  options: { fetch?: typeof fetch; onProgress?: (tools: number) => void; onToolProgress?: (progress: ToolProgress) => void; images?: AssistantImage[]; remote?: RemoteTools; events?: EventReader } = {}): Promise<{ result?: AssistantResult; plan?: AssistantPlan; pathPlan?: AssistantPlan; fixture: boolean }> {
  const rounds: KgRound[] = [], executions: KgExecution[] = []
  /** Outputs of log tools the Worker ran for the current step (server/assistant/logTools.ts), by call ID. */
  let logResults: Record<string, LogToolOutput> = {}
  const execute = async (call: KgCall, index: number): Promise<KgExecution> => {
    signal.throwIfAborted()
    const progress = { id: call.id, name: call.function.name }
    options.onToolProgress?.({ ...progress, status: 'running' })
    try {
      const execution = await executeTool(call, index)
      options.onToolProgress?.({ ...progress, status: 'complete' })
      return execution
    } catch (error) {
      options.onToolProgress?.({ ...progress, status: 'failed' })
      throw error
    }
  }
  const executeTool = async (call: KgCall, index: number): Promise<KgExecution> => {
    // The Worker already ran it; a missing output is a failure, never an empty result.
    if (LOG_TOOLS.has(call.function.name)) return logToolExecution(context, call.function.name, index, logResults[call.id])
    if (call.function.name === 'collection_status') return collectionStatus(context, call, index)
    if (call.function.name === 'standard_findings') return standardFindings(context, call, index)
    if (call.function.name === 'compliance_item') return complianceItem(context, call, index)
    if (call.function.name === 'compliance_remediation_plan') return complianceRemediationPlan(context, call, index)
    if (call.function.name === 'custom_criterion') return customCriterion(context, call, index)
    if (call.function.name === 'guideline_criterion') return guidelineCriterion(context, call, index)
    if (call.function.name === 'investigation_status') return investigationStatus(context, call, index, signal, options.fetch)
    if (call.function.name === 'event_context') return eventContext(context, call, index, signal, execute)
    const remote = options.remote && SERVER_KG_TOOLS.has(call.function.name) ? await executeRemoteTool(call, index, options.remote, signal, options.fetch) : null
    return remote ?? (EVENT_KG_TOOLS.has(call.function.name)
      ? executeEventTool(context, call, index, options.remote ? async () => ({ events: [], links: null, total: 0, available: false }) : options.events ?? (await import('./localEventReader')).readLocalEvents, signal)
      : executeKgTool(context, call, index))
  }

  /** Tools the server finished in this request, for the progress count until their round arrives. */
  let pending = 0
  /** A round the server ran (runAssistantSteps): graph results as returned, log outputs numbered here, in call order like a browser round. */
  const adopt = (event: Extract<KgStreamEvent, { type: 'round' }>) => {
    const calls = event.calls.map(parseKgCall)
    if (!calls.length || calls.some(c => !c)) throw new ChatFailure('invalid_plan')
    const base = executions.length
    const ran = calls.map((call, i) => LOG_TOOLS.has(call!.function.name) ? logToolExecution(context, call!.function.name, base + i + 1, event.results?.[call!.id]) : event.executions[call!.id])
    if (!ran.every(usableExecution)) throw new ChatFailure('invalid_plan')
    executions.push(...ran)
    rounds.push({ calls: calls as NonNullable<ReturnType<typeof parseKgCall>>[], outputs: ran.map(execution => execution.output) })
    pending = 0
  }
  /** Reads the server tool loop: progress lines, finished rounds, then the step or error that ends it. */
  const readStream = async (response: Response): Promise<StepReply> => {
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = '', last: Extract<KgStreamEvent, { type: 'step' | 'error' }> | undefined
    const handle = (line: string) => {
      if (!line.trim()) return
      const event = JSON.parse(line) as KgStreamEvent
      if (event.type === 'tool') {
        options.onToolProgress?.({ id: event.id, name: event.name, status: event.status })
        if (event.status === 'complete') options.onProgress?.(executions.length + ++pending)
      } else if (event.type === 'round') adopt(event)
      else last = event
    }
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const lines = (buffer + value).split('\n')
      buffer = lines.pop()!
      lines.forEach(handle)
    }
    handle(buffer)
    if (!last) throw new ChatFailure('model_unavailable')
    return last.type === 'error' ? { ok: false, body: { error: last.error } } : { ok: true, body: { ...last.step, mode: 'model' } }
  }
  const step = async (loop: boolean): Promise<StepReply> => {
    const remote = loop && options.remote ? { remote: { snapshotId: options.remote.snapshotId, visibleFindings: options.remote.visibleFindings, hideDefaults: options.remote.hideDefaults } } : {}
    const response = await (options.fetch ?? fetch)('/api/measured/assistant/chat', { method: 'POST', credentials: 'same-origin', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history, focus: context.focus ?? {}, workspace: hasGuide(context.workspace?.page) ? context.workspace : undefined, images: options.images, rounds, ...remote }) })
    if (response.headers.get('Content-Type')?.startsWith(KG_STREAM_TYPE)) return readStream(response)
    const reply = { ok: response.ok, body: await response.json() }
    if (!('remote' in remote) || response.status !== 400 || reply.body.error !== 'bad_question') return reply
    // An older Worker refuses the unknown remote field. Ask again the old way; only a different answer proves it was the field.
    const retry = await step(false)
    if (retry.ok || retry.body.error !== 'bad_question') serverLoop = false
    return retry
  }

  try {
    for (;;) {
      const { ok, body } = await step(serverLoop)
      if (!ok) throw new ChatFailure(body.error || 'model_unavailable', executions.length ? mergeKgResults(executions.map(e => e.result)) : undefined)
      if (body.mode === 'fixture') {
        const plan = parseAssistantPlan(body.plan)
        if (!plan) throw new ChatFailure('invalid_plan')
        return { plan, fixture: true }
      }
      if (typeof body.answer === 'string' && body.answer.trim()) {
        const result = mergeKgResults(executions.map(e => e.result)); result.answer = body.answer
        return { result, pathPlan: [...executions].reverse().find(e => e.plan?.intent === 'path_lookup')?.plan, fixture: false }
      }
      if (!Array.isArray(body.calls) || !body.calls.length || body.calls.length > 4 || rounds.length >= CHAT_ROUNDS) throw new ChatFailure('invalid_plan')
      const calls = (body.calls as unknown[]).map(parseKgCall)
      if (calls.some(c => !c)) throw new ChatFailure('invalid_plan')
      logResults = body.results && typeof body.results === 'object' ? body.results as Record<string, LogToolOutput> : {}
      if (signal.aborted) throw new ChatFailure('model_timeout')
      // Calls of one round do not depend on each other: run them together, keep call order for numbering and history.
      const base = executions.length
      let done = 0
      const ran = await Promise.all(calls.map((call, i) => execute(call!, base + i + 1).then(execution => { options.onProgress?.(base + ++done); return execution })))
      executions.push(...ran)
      const outputs = ran.map(execution => execution.output)
      rounds.push({ calls: calls as NonNullable<ReturnType<typeof parseKgCall>>[], outputs })
      pending = 0
    }
  } catch (error) {
    const failure = error instanceof ChatFailure ? error : new ChatFailure(signal.aborted ? 'model_timeout' : 'model_unavailable')
    if (!failure.partial && executions.length) failure.partial = mergeKgResults(executions.map(e => e.result))
    throw failure
  }
}
