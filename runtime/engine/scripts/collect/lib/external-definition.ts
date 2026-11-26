import { sha256Hex, urlRef } from './sanitize'

/** Extract references before dropping arbitrary vendor definitions and secure header values. */
export function definitionReferences(value: unknown): { url_refs: ReturnType<typeof urlRef>[]; property_refs: string[] } {
  const urls = new Map<string, ReturnType<typeof urlRef>>(), properties = new Set<string>()
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/https?:\/\/[^\s"'<>\\]+/g)) {
        if (/\$\{|\{\{|%7B/i.test(m[0])) continue
        const ref = urlRef(m[0]); urls.set(ref.sha256, ref)
      }
      for (const m of v.matchAll(/getProperty\(['"]([A-Za-z0-9_]+)['"]\)/g)) properties.add(m[1])
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      if (/^(?:headers?|authorization|password|secret|token|webhookToken)$/i.test(k)) continue
      walk(x)
    }
  }
  walk(value)
  return { url_refs: [...urls.values()], property_refs: [...properties].sort() }
}

export function summarizeAutomationRule(body: any): any {
  const rule = body?.rule ?? body ?? {}
  const components: any[] = []
  const requests: any[] = [], secretFingerprints = new Set<string>()
  const visit = (c: any) => {
    if (!c || typeof c !== 'object') return
    const ids = Object.fromEntries(Object.entries(c.value ?? {}).filter(([k,v]) => /^(?:channelId|teamId|workspaceId|connectionId)$/.test(k) && typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v)))
    components.push({ id: c.id, type: c.type, ...definitionReferences(c.value), identifiers: ids })
    const field = c.type === 'slack.notification' ? 'webhookUrl' : ['jira.issue.outgoing.webhook', 'outgoing.webhook'].includes(c.type) ? 'url' : null
    const value = field && c.value?.[field]
    if (typeof value === 'string' && !/\$\{|\{\{|%7B/i.test(value)) {
      try {
        const u = new URL(value)
        if (u.protocol === 'https:' && !u.username && !u.password && !u.port) {
          requests.push({ component_id: String(c.id ?? components.length - 1), component_type: c.type, field, ...urlRef(value) })
          if (u.hostname === 'hooks.slack.com' && /^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(u.pathname) && !u.search && !u.hash) secretFingerprints.add(sha256Hex(value))
        }
      } catch { /* Redacted or malformed targets remain references only. */ }
    }
    for (const child of c.children ?? []) visit(child)
  }
  if (rule.trigger) visit(rule.trigger)
  for (const c of rule.components ?? []) visit(c)
  // 범위(ruleScopeARIs 의 프로젝트 id)와 규칙 행위자(actor)는 비밀값이 아닌 id 라 남긴다. 규칙 → 프로젝트 triggered_by, 규칙 → 행위자 runs_as 를 잇는 재료다
  const scopeProjectIds = (Array.isArray(rule.ruleScopeARIs) ? rule.ruleScopeARIs : []).map((a: unknown) => typeof a === 'string' ? a.match(/^ari:cloud:jira:[A-Za-z0-9-]*:project\/(\d+)$/)?.[1] : undefined).filter((v: unknown): v is string => typeof v === 'string')
  const actorAccountId = rule.actor?.type === 'ACCOUNT_ID' && typeof rule.actor.actor === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(rule.actor.actor) ? rule.actor.actor : undefined
  return { rule: { uuid: rule.uuid, name: rule.name, state: rule.state, incoming_webhook: ['jira.incoming.webhook','incoming.webhook'].includes(rule.trigger?.type), trigger_type: typeof rule.trigger?.type === 'string' ? rule.trigger.type : undefined, scope_project_ids: [...new Set(scopeProjectIds)].sort(), actor_account_id: actorAccountId, components, request_targets: requests, request_secret_fingerprints: [...secretFingerprints].sort() }, definition_sha256: sha256Hex(JSON.stringify(rule)), reference_basis: 'definition_reference_only', connection_ids: (body?.connections ?? []).map((c: any) => c.id ?? c.connectionId).filter((v: unknown) => typeof v === 'string') }
}

export function summarizeFlowMetadata(body: any): any {
  const m = body?.Metadata ?? {}
  return { Id: body?.Id, Status: body?.Status, flow_definition: {
    ...definitionReferences(m), reference_basis: 'definition_reference_only',
    actions: (m.actionCalls ?? []).map((a: any) => ({ name: a.name, action_type: a.actionType, action_name: a.actionName,
      identifiers: (a.inputParameters ?? []).filter((p: any) => /^(?:slackAppId|slackAppIdForToken|slackWorkspaceId|slackWorkspaceIdForToken|slackConversationId|channelId|workspaceId)$/.test(p.name)).map((p: any) => {
        const value = p.value?.stringValue
        return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? { name: p.name, value, resolution: 'literal' } : { name: p.name, resolution: 'unresolved' }
      }),
    })),
    subflows: (m.subflows ?? []).map((s: any) => s.flowName).filter((v: unknown) => typeof v === 'string'),
    // 누가 이 Flow 를 시작시키고 어떤 권한으로 도는지(Flow 메타데이터 processType, runInMode, start). 조건식과 필터 값은 남기지 않는다
    ...flowStart(m),
  } }
}

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/
const name = (v: unknown) => (typeof v === 'string' && NAME.test(v) ? v : undefined)
function flowStart(m: any) {
  const s = m.start ?? {}
  const start = { object: name(s.object), trigger_type: name(s.triggerType), record_trigger_type: name(s.recordTriggerType) }
  return { process_type: name(m.processType), run_in_mode: name(m.runInMode), start: Object.values(start).some(v => v !== undefined) ? start : undefined }
}

export function maskExternalConfigUrls(body: any): any {
  return { ...body, records: (body?.records ?? []).map((r: any) => Object.fromEntries(Object.entries(r).map(([k,v]) => [k, /^(?:Endpoint|AuthorizeUrl|TokenUrl|UserInfoUrl)$/.test(k) && typeof v === 'string' ? urlRef(v) : v]))) }
}

/** Apex bodies stay in memory. These are definition references, not executed callouts. */
export function summarizeApexDefinitions(body: any): any {
  return { done: body?.done, nextRecordsUrl: body?.nextRecordsUrl, records: (body?.records ?? []).map((r: any) => ({
    Id: r.Id, Name: r.Name, NamespacePrefix: r.NamespacePrefix,
    source_sha256: sha256Hex(String(r.Body ?? '')),
    ...definitionReferences(r.Body),
    named_credential_refs: [...new Set([...String(r.Body ?? '').matchAll(/callout:([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]))],
    reference_basis: 'definition_reference_only',
  })) }
}

export function summarizeOutboundDefinition(body: any, expected: string): any {
  if (body?.FullName !== expected) return { matched: false }
  const m = body.Metadata ?? {}
  return { matched: true, definition: {
    id: body.Id, full_name: body.FullName, action_type: 'outboundMessage',
    endpoint: typeof m.endpointUrl === 'string' ? urlRef(m.endpointUrl) : undefined,
    integration_user: m.integrationUser, include_session_id: m.includeSessionId === true,
    reference_basis: 'definition_reference_only',
  } }
}
