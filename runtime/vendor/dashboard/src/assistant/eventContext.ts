import type { KgCall, KgFact, ToolArgs } from './chatProtocol'
import { parseToolArgs } from './chatProtocol'
import { emptyKgResult, finishKgExecution, type KgContext, type KgExecution } from './kgTools'
import { eventGraphFromFacts } from './eventGraph'

type Run = (call: KgCall, index: number) => Promise<KgExecution>
const isKey = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 512

/** Bounded composition of existing read tools. The final fact cap also bounds graph evidence. */
export async function eventContext(context: KgContext, call: KgCall, index: number, signal: AbortSignal, execute: Run): Promise<KgExecution> {
  const args = parseToolArgs(call.function.name, JSON.parse(call.function.arguments))!
  const seedKey = String(args.eventKey), limit = Number(args.limit ?? 5), windowMinutes = Number(args.windowMinutes ?? 15)
  const queries: Array<{ tool: string; available: boolean; truncated: boolean }> = []
  let failed = false
  const run = async (name: string, input: ToolArgs) => {
    signal.throwIfAborted()
    try {
      const execution = await execute({ id: `${call.id}-${queries.length + 1}`, type: 'function', function: { name, arguments: JSON.stringify(input) } }, index)
      const available = !execution.output.facts.some(f => f.data?.available === false)
      queries.push({ tool: name, available, truncated: execution.output.truncated })
      return execution
    } catch {
      signal.throwIfAborted(); failed = true
      queries.push({ tool: name, available: false, truncated: false })
      return { output: { summary: '보조 조회 불가', facts: [], truncated: false }, result: emptyKgResult('보조 조회 불가') }
    }
  }
  const connections = await run('event_connections', { eventKey: seedKey, direction: args.direction ?? 'both', limit, offset: args.linkOffset ?? 0 })
  const seed = connections.output.facts.find(f => f.kind === 'event' && f.ref === seedKey)
  const objects: KgExecution[] = [], structural: KgExecution[] = []
  let neighborhood: KgExecution | undefined, from: string | null = null, to: string | null = null
  const data = seed?.data, actor = data?.actor as { objectKey?: unknown } | null | undefined
  const targets = Array.isArray(data?.targets) ? data.targets as Array<{ objectKey?: unknown } | null> : []
  const keys = [...new Set([actor?.objectKey, ...targets.map(t => t?.objectKey)].filter(isKey))], selectedKeys = keys.slice(0, 4)
  if (seed) {
    for (const key of selectedKeys) objects.push(await run('search_objects', { text: key, limit: 1 }))
    if (isKey(actor?.objectKey)) {
      structural.push(await run('identity', { key: actor.objectKey }))
      structural.push(await run('neighbors', { key: actor.objectKey, limit }))
    }
    if (selectedKeys.length && typeof data?.occurredAt === 'string' && Number.isFinite(Date.parse(data.occurredAt))) {
      const time = Date.parse(data.occurredAt), span = windowMinutes * 60_000
      from = new Date(Math.max(-8.64e15, time - span)).toISOString(); to = new Date(Math.min(8.64e15, time + span)).toISOString()
      neighborhood = await run('search_events', { objectKeys: selectedKeys, from, to, offset: args.eventOffset ?? 0, limit })
    }
  }
  const matched = objects.flatMap(e => e.output.facts.filter(f => f.kind === 'object' && selectedKeys.includes(f.ref)).map(f => f.ref))
  const unresolved = selectedKeys.filter((_key, i) => queries[i + 1]?.available === false)
  const scope: Omit<KgFact, 'id'> = { kind: 'reference', ref: 'event_context:scope', label: '이벤트 조사 범위',
    detail: `기존 도구로 조회한 이벤트와 객체입니다. 같은 객체나 시간대에 속하는 활동은 인과 관계가 아닙니다.\n객체 매칭: ${matched.length}개, 객체 조회 불가: ${unresolved.length}개\n시간대 활동 조회: ${from && to ? `${from} ~ ${to}` : '시각 또는 객체 미확인으로 조회하지 않음'}\n보조 조회: ${queries.length}회, 조회 불가: ${queries.filter(q => !q.available).length}회`,
    data: { eventKey: seedKey, eventFound: !!seed, queries, matchedObjectKeys: matched, unmatchedObjectKeys: selectedKeys.filter(k => !matched.includes(k) && !unresolved.includes(k)), unresolvedObjectKeys: unresolved,
      objectsTruncated: keys.length > selectedKeys.length || data?.targetsTruncated === true, objectLimit: 4,
      timeNeighborhood: { queried: !!neighborhood, from, to, windowMinutes, reason: !seed ? 'event_not_found_or_unavailable' : !selectedKeys.length ? 'no_object_key' : !from ? 'missing_time' : null },
      linkOffset: args.linkOffset ?? 0, eventOffset: args.eventOffset ?? 0, limit } }
  const all = [scope, ...(seed ? [seed] : []), ...objects.flatMap(e => e.output.facts), ...structural.flatMap(e => e.output.facts),
    ...connections.output.facts.filter(f => f !== seed), ...(neighborhood?.output.facts ?? [])]
  const seen = new Set<string>(), facts: Omit<KgFact, 'id'>[] = []
  let omitted = false
  for (const item of all) {
    const key = `${item.kind}:${item.ref}`
    // Scope metadata must retain separate connection and neighborhood pagination.
    if (seen.has(key)) continue
    seen.add(key)
    const { id: _id, ...fact } = item as KgFact
    if (facts.length >= 55 || JSON.stringify([...facts, fact]).length > 13_000) { omitted = true; continue }
    facts.push(fact)
  }
  const result = emptyKgResult(seed ? '이벤트와 매칭 객체, 게시된 직접 연결 및 제한된 시간대의 활동을 조회했습니다. 각 범위와 누락을 확인하세요.' : '이벤트를 찾지 못했거나 조회하지 못했습니다. 연결 없음으로 해석하지 마세요.')
  if (seed) result.focus = { eventKey: seedKey }
  result.navigation = [{ page: 'EventBoard', eventKey: seedKey, label: '이벤트 상세 열기' }]
  const execution = finishKgExecution(context, call.function.name, args, index, result, facts, omitted || failed || queries.some(q => q.truncated) || scope.data?.objectsTruncated === true)
  execution.result.eventGraph = eventGraphFromFacts(execution.output.facts, execution.output.truncated)
  const retained = execution.output.facts, known = new Set(retained.filter(f => f.kind === 'object').map(f => f.ref))
  execution.result.graph.objectKeys = [...known].filter(key => context.graph.objectsByKey.has(key))
  execution.result.graph.relationKeys = retained.filter(f => f.kind === 'relation' && known.has(String(f.data?.from)) && known.has(String(f.data?.to))).map(f => f.ref)
  const identities = retained.filter(f => f.kind === 'identity_link')
  execution.result.graph.identityEdges = structural.flatMap(e => e.result.graph.identityEdges).filter(edge => known.has(edge.from) && known.has(edge.to)
    && identities.some(f => f.ref === edge.linkId || f.ref.startsWith(`${edge.linkId}:`)))
  execution.result.graph.linkIds = [...new Set(execution.result.graph.identityEdges.map(edge => edge.linkId))]
  return execution
}
