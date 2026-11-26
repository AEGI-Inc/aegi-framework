import { AssistantError, createAssistantPlan, readBoundedText, type AssistantEnv, type PlannerDeps } from './planner'
import { BODY_LIMIT } from '../../src/assistant/plan'

type JsonResponse = (status: number, body: Record<string, unknown>, headers?: Record<string, string>) => Response
const limits = new Map<string, { starts: number; count: number; inFlight: number }>()

/** Isolate-local limiter bounds concurrent/rapid calls. Production deployments can also use edge rate limits. */
export async function handleAssistantPlan(request: Request, env: AssistantEnv, json: JsonResponse, client: string, now: number, deps: PlannerDeps = {}): Promise<Response> {
  for (const [key, value] of limits) if (!value.inFlight && now - value.starts >= 60_000) limits.delete(key)
  let rate = limits.get(client)
  if (!rate) {
    if (limits.size >= 1000) return json(429, { error: 'rate_limited' }, { 'Retry-After': '60' })
    rate = { starts: now, count: 0, inFlight: 0 }; limits.set(client, rate)
  }
  if (rate.count >= 10 || rate.inFlight >= 2) return json(429, { error: 'rate_limited' }, { 'Retry-After': '60' })
  rate.count++; rate.inFlight++
  try {
    let body: { question?: unknown; context?: unknown }
    try {
      const value = JSON.parse(await readBoundedText(request.body, BODY_LIMIT))
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['question', 'context'].includes(k))) return json(400, { error: 'bad_question' })
      body = value
    } catch (error) {
      return json(error instanceof AssistantError ? error.status : 400, { error: 'bad_question' })
    }
    const plan = await createAssistantPlan(body.question, env, deps, body.context)
    return json(200, { plan, mode: 'model' })
  } catch (error) {
    return error instanceof AssistantError ? json(error.status, { error: error.code }) : json(502, { error: 'model_unavailable' })
  } finally { rate.inFlight-- }
}
