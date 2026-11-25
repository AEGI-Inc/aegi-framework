import { handleMeasured, type HandlerDeps, type MeasuredEnv } from '../measured'

const PATHS = new Set(['/api/measured/assistant/chat', '/api/measured/assistant/plan'])

export async function handleAssistantWorker(request: Request, env: MeasuredEnv, deps: HandlerDeps = {}): Promise<Response> {
  if (!PATHS.has(new URL(request.url).pathname)) return new Response(null, { status: 404 })
  // Reuse the Pages session, Origin checks, validation and request limits.
  const response = await handleMeasured(request, env, deps)
  response.headers.set('X-Aegi-Assistant-Runtime', 'regional-worker')
  return response
}

export default {
  fetch(request: Request, env: MeasuredEnv): Promise<Response> {
    return handleAssistantWorker(request, env)
  },
}
