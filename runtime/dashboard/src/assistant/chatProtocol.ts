import { parseAssistantPlan, QUESTION_LIMIT, type AssistantPlan } from './plan'
import { DASHBOARD_GUIDES, parseWorkspace, type WorkspaceContext } from './workspace'
import { parseImages, type AssistantImage } from './images'
import { filterablePropertyName } from './propertyRules'
import { checkFieldName, parseCondition } from '../compliance/customCriteria'
import { GUIDELINES, registeredGuidelines } from '../compliance/demoTour'
import type { KgExecution } from './kgTools'

export const CHAT_BODY_LIMIT = 3_000_000
export const CHAT_ROUNDS = 6
export const TOOL_LIMIT = 16
export const TOOL_OUTPUT_LIMIT = 16_384
export const ANSWER_LIMIT = 8000
const providers = ['slack', 'github', 'okta', 'gws', 'atlassian', 'salesforce', 'microsoft', 'onepassword', 'snowflake', 'gcp']
/** 자주 비교하는 속성 (값 하나인 고정 목록 속성). search_objects property 는 객체 사실에 보이는 이름이면 다 받는다(propertyRules filterablePropertyName) */
export const FILTER_PROPERTIES = ['is_private', 'public', 'visibility', 'is_admin', 'is_owner', 'is_suspended', 'status', 'type', 'role', 'role_name', 'role_type', 'sign_on_mode', 'signOnMode', 'perm_ModifyAllData', 'perm_ManageUsers', 'perm_AuthorApex', 'perm_ViewAllData']
const string = { type: 'string' }
const enumeration = (values: string[]) => ({ type: 'string', enum: values })
const page = { offset: { type: 'integer', minimum: 0, maximum: 10000 }, limit: { type: 'integer', minimum: 1, maximum: 20 } }
const eventPage = { ...page, offset: { type: 'integer', minimum: 0, maximum: 1_000_000 } }
/** engine eventClasses.ts EVENT_CATEGORIES 와 같다. 다르면 logTools 가 Connector schema 와 비교해 모델에 알린다 */
export const EVENT_CATEGORIES = ['auth', 'admin', 'membership', 'policy', 'token', 'data', 'mail', 'other'] as const
const eventFilters = {
  from: string, to: string, provider: string, category: enumeration([...EVENT_CATEGORIES]),
  outcome: enumeration(['success', 'failure', 'unknown']), suspicious: { type: 'boolean' },
  objectKeys: { type: 'array', items: { type: 'string', maxLength: 512 }, maxItems: 17 }, actorKey: string, eventKey: string, eventType: string,
  text: string, clientIp: string, sessionId: string,
}
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({ type: 'function', function: {
  name, description, parameters: { type: 'object', properties, required, additionalProperties: false },
} })
export const KG_TOOLS = [
  tool('search_logs', 'Search audit logs in Splunk. sourceRefs are log sources listed in the system prompt. The server writes the base search of each source (index, sourcetype, period, tenant scope) and adds common fields with the same names for every source: aegi_event_id, aegi_event_type, aegi_category, aegi_outcome, aegi_outcome_reason, aegi_actor_id, aegi_actor_login, aegi_target_type, aegi_target_id, aegi_target_name (multivalue), aegi_client_ip. GWS and Atlassian Guard rows are single child events, and an event stored twice is counted once (by aegi_event_id). matchCategories and matchOutcomes filter by the event class table that Timeline also uses; a source that does not record the outcome is not searched and is reported in notRecordedSources. spl is only the pipeline after the base search, starting with | (for example | stats count by sourcetype aegi_event_type aegi_outcome), or empty for raw events. Raw field paths per source are also available. from/to are absolute UTC ISO (to exclusive). Writing, sending, lookups, subsearches, macros and other data sources are refused (spl_rejected). Returns completion, total stored count, queryId and the first page: normalized events when the result keeps raw events, otherwise result rows. A search runs at most 120 seconds.', { sourceRefs: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 8 }, spl: { type: 'string', maxLength: 3500 }, from: string, to: string,
    matchCategories: { type: 'array', items: enumeration([...EVENT_CATEGORIES]), maxItems: 8 }, matchOutcomes: { type: 'array', items: enumeration(['success', 'failure']), maxItems: 2 } }, ['sourceRefs', 'from', 'to']),
  tool('read_logs', 'Read a later page of a search_logs result by its queryId: rows or events [offset, offset + limit). Use when a result has more rows than the first page.', { queryId: string, offset: { type: 'integer', minimum: 0, maximum: 100000 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['queryId']),
  tool('collection_status', 'Read snapshot collection timestamps and published API coverage by SaaS. Missing coverage is unknown, not complete. Object API coverage never establishes audit-event coverage. Read-only; cannot collect or change settings.', { provider: string, ...page, callOffset: { type: 'integer', minimum: 0, maximum: 10000 } }),
  tool('event_context', 'Investigate one exact event: published direct event links, actor/target objects, actor identity and structural neighbors, and a bounded time neighborhood. Shared objects and time proximity are context, never causal links. Reports each lookup failure and pagination. Reads existing tools only.', { eventKey: string, direction: enumeration(['in', 'out', 'both']), linkOffset: { type: 'integer', minimum: 0, maximum: 1_000_000 }, eventOffset: { type: 'integer', minimum: 0, maximum: 1_000_000 }, windowMinutes: { type: 'integer', minimum: 1, maximum: 120 }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, ['eventKey']),
  tool('standard_findings', 'Read configuration findings judged against public security standards (CIS, CISA SCuBA, vendor checklists) from the assessment run the user currently selected. Filter by exact objectKey, provider, item status or text. A status other than pass is not always a violation: not_collected and unknown mean the setting was not read. Targets with inGraph false are not in the current graph. Text also matches the finding id (for example gws-124). Each finding carries its remediation data (console path, setting and value, steps, review state) and in-scope compliance items: recommend only those steps, and when the data says it is missing or lacks evidence, say so instead of giving general guidance. Read-only.', { objectKey: string, provider: enumeration([...providers, 'salesforce']), status: enumeration(['fail', 'pass', 'unknown', 'not_collected', 'org_policy', 'manual']), text: string, ...page }),
  tool('compliance_item', 'Read one compliance requirement by framework and item key (for example framework isms-p, item 2.5.1 또는 2.5.1-02, or iso27001 5.16, or pipa 제5조 제2항): the official requirement text, current verdict and check counts, failing configuration checks with targets and remediation, and navigation. Call it when investigating a compliance requirement or planning remediation. Optional object narrows failing configuration checks and full remediation cards (where, steps, verify, reference URLs) to one target object key; selection 의 객체를 object 로 넘긴다.', { framework: enumeration(['isms-p', 'iso27001', 'pipa']), item: string, object: string }, ['framework', 'item']),
  tool('compliance_remediation_plan', 'Recommend an ordered remediation plan for compliance violations based on impact (number of requirements satisfied and failing targets resolved). Never changes SaaS settings. Only recommend steps present in the remediation data; if missing say so.', { framework: enumeration(['isms-p', 'iso27001', 'pipa']), item: string, limit: { type: 'integer', minimum: 1, maximum: 50 } }),
  tool('custom_criterion', 'Add one setting check for a new or changed standard sentence to an ISMS-P criterion as a browser draft, and judge it on the current collected settings, in the same shape as the standard checks: the data to read (provider, exact object type as in kg_schema, optional filter conditions), the fields to read, the required value, and how targets combine. Call once per check; checks with the same criterion and name join one draft. Read the fields from object facts first (search_objects with provider and type); a field without collected values is refused. condition is the required value and only when source_text states it: condition_quote must be the exact phrase of source_text that states it. When source_text gives no value, leave condition out: the check shows observed values and stays unknown, never pass or fail. When the new standard changes what an existing public-standard check linked to the same criterion requires (compliance_item lists them with field and required value), set replaces_check to that finding id and read the same or a related field: the screen shows the current requirement and result next to the changed one. Conditions are lines like path=value, path!=value, path in a,b, path not_in a,b, path exists, path missing, path>=n, path<=n, or path has name:value for a value inside a list or nested object (quotes and spaces ignored). Paths are dotted names of up to six parts. combine every_object (default) fails when any target misses the requirement; any_object passes when one target meets it. The draft becomes a company criterion only after the user confirms it on the Compliance screen; say so. Changes no SaaS setting.', {
    criterion: string, name: string, source_title: string, source_text: string, question: string, provider: enumeration(providers), type: string,
    filter: { type: 'array', items: string, maxItems: 4 }, fields: { type: 'array', items: string, maxItems: 6 }, condition: { type: 'array', items: string, maxItems: 6 },
    condition_quote: string, replaces_check: string, condition_join: enumeration(['any', 'all']), combine: enumeration(['every_object', 'any_object']),
  }, ['criterion', 'name', 'source_title', 'source_text', 'question', 'provider', 'type', 'fields']),
  tool('guideline_criterion', `Add the fixed setting checks of a registered guideline document to its ISMS-P criterion as a browser draft and judge them on the current collected settings. When the standard text the user gives is one of these documents, call this once instead of composing custom_criterion checks: the checks are fixed, so the result is the same every time. Registered: ${registeredGuidelines().map(g => `${g.id} (${g.title}, ISMS-P ${g.criterion})`).join('; ')}. The draft becomes a company criterion only after the user confirms it on the Compliance screen; say so. Changes no SaaS setting.`, { criterion: string, guideline: enumeration(GUIDELINES.map(g => g.id)) }, ['criterion', 'guideline']),
  tool('investigation_status', 'Read a Finding\'s recorded handling owner/history, remediation progress/verification, and exception reason/expiry. Resolve exact Finding ID first. Uses its stable fingerprint; no record is not resolved. Reports team vs browser source and unavailable stores separately. Never changes records or SaaS.', { findingId: string, section: enumeration(['all', 'handling', 'remediation', 'exceptions']), ...page, historyOffset: { type: 'integer', minimum: 0, maximum: 10000 } }, ['findingId']),
  // 화면 목록은 DASHBOARD_GUIDES 하나만 쓴다. 따로 적은 목록에 Compliance가 빠져 인자가 거절됐다
  tool('dashboard_help', 'Read dashboard feature guidance and return real navigation buttons. Product guidance is not evidence that an environment action occurred.', { page: enumeration(DASHBOARD_GUIDES.map(g => g.page)) }),
  tool('search_events', 'Search collected events, newest first, with totals and pagination over the retrieved collection. Partial results are observed counts, not exact totals for the requested period. from/to must be paired ISO timestamps with timezone; from inclusive, to exclusive. objectKeys matches actor or targets (OR across keys); resolve names with search_objects and identity first. Other filters combine with AND. No events does not prove no activity. eventKey retrieves one exact event. Only safe normalized fields are returned.', { ...eventFilters, ...eventPage }),
  tool('event_connections', 'Read one event and a page of its published incoming/outgoing engine links and neighboring events. Follow returned endpoint keys for further hops. Never infer causality from proximity or same-person links. Preserve confirmed vs review, primary/supporting bases, rule version, missing endpoints and unavailable link storage.', { eventKey: string, direction: enumeration(['in', 'out', 'both']), ...eventPage }, ['eventKey']),
  tool('selection_context', 'Resolve exact objects, relations, identity links, Findings and Effective Access rows explicitly selected by the user. Use for this object, connection, threat or selected area. Paginated. Never guess selection from an image.', { ...page }),
  tool('access_gaps', 'Read Access Gaps per threat, computed by the engine judgment. Each threat with a gap gives directCount (직접 권한), derivedCount (파생 접근), unauthorized (권한 없는 접근자: gained access with no direct permission) and excess (권한 초과 접근자: gained a higher level than direct permission); admins and approved people are excluded from the counts. People list their column, direct level, derived level, gained level and certainty; the list is capped unless gapId (a threat id) reads one threat. State the four numbers as counts says, like the dashboard. key keeps threats whose integration point or target is that object.', { key: string, gapId: string, ...page }),
  tool('dashboard_summary', 'Read current snapshot counts, visible Findings, threats with Access Gaps and exception counts. No credential registry secret values are accessible.', {}),
  tool('kg_schema', 'Get KG counts, available providers, object counts per SaaS, object counts per SaaS and object type (objectsByType, the names search_objects type accepts), interfaces, relation counts per type and per cross-SaaS pair (from>to, structural relations, not identity links), Principal object counts per SaaS and type, each split by account kind (human, service, group are recorded judgements; likely_human, likely_service are inferred from account type or bot flags; unknown), and identity link counts per SaaS for every collected SaaS (person links, other links such as automation, person account pairs by link level). No need to call before every query.', {}),
  tool('search_objects', 'Search the whole current KG by name or exact object key. Empty text lists objects. type keeps one exact object type as named in kg_schema objectsByType; use it with provider to list or count one kind of object completely. Object facts carry collected properties: a fixed set first, then other properties by rule (nested values as dotted names such as permissions.contents, URLs as host only, secret-like names and values and long text withheld and counted in propertiesOmitted). property with value keeps objects whose property equals value (true, false or text such as private; default true); property is any name shown in object facts, dotted for nested values; objects without that property are counted apart as unknown, and the same fact may be stored under another property (repositories use visibility, channels and projects use is_private). Results are paginated and report matches hidden from the default view. Never guess a key. Disambiguate multiple matches using provider or ask the user.', { text: string, provider: enumeration(providers), interface: string, type: string, property: string, value: string, ...page }),
  tool('neighbors', 'Read an object and its actual relations and identity links: outgoing, incoming, and relations that use the object as their role (accounts holding a profile, permission set or role). Returns safe properties, roles with permission level and permission keys, and endpoints. Structural relations do not prove access.', { key: string, direction: enumeration(['in', 'out', 'both']), relationType: string, ...page }, ['key']),
  tool('identity', 'Find linked SaaS accounts of a person account, preserving confirmed and inferred identity certainty. Bots, groups and service accounts return a not-a-person note; use neighbors for them.', { key: string }, ['key']),
  tool('identity_links', 'List identity link account pairs across the KG, with the SaaS and account kind of both ends. provider and otherProvider filter the SaaS of the two ends, level filters the link level, kind keeps person links or other links such as automation. resolved and disclosed_relation are confirmed; possibly_same is inferred from names or email. Each end has linkedSaas, every SaaS the same person is linked to. With both provider and otherProvider, the summary counts provider accounts linked only to otherProvider, so do not pick them from the pairs yourself. Paginated.', { provider: enumeration(providers), otherProvider: enumeration(providers), level: string, kind: enumeration(['person', 'other']), ...page }),
  tool('accounts', 'List accounts (Principal objects that are not groups: people, service and bot accounts) in original order with account state read from collected account properties by the same rules as the account explorer: status, admin, 2-step verification and last login, null when not recorded. Filters: provider, kind (account kind as in kg_schema), status (active; inactive means any recorded status other than active; or an exact status such as suspended or deactivated), admin, mfa. Accounts whose filtered value is not recorded are counted apart as unknown. The summary counts the whole result by SaaS, account kind, status, admin, 2-step verification and last login. Paginated.', { provider: enumeration(providers), kind: enumeration(['human', 'service', 'likely_human', 'likely_service', 'unknown']), status: string, admin: { type: 'boolean' }, mfa: { type: 'boolean' }, ...page }),
  tool('relations', 'List structural relations across the KG in original order. relationType filters the relation type, fromProvider and toProvider filter the SaaS of the source and target ends, level keeps role relations (has_role_on) with that permission level, computed like the detection engine (role name, permission keys and role grants; unknown when not decidable). Counts by type, by SaaS pair (from>to) and by role permission level cover the whole result. Each relation returns its ends, role, permission level and permission keys. Paginated.', { relationType: string, fromProvider: enumeration(providers), toProvider: enumeration(providers), level: enumeration(['admin', 'write', 'read', 'none', 'unknown']), ...page }),
  tool('access', 'Read the engine access table for an account: direct permission (직접 권한, permission edges) and derived access (파생 접근, reached through automations, apps and tokens) per target, with the gained level, its certainty and the integration point. Person accounts only: groups and automations have no rows and are not analyzed. Missing evidence means unknown, never denied. Person account key required; targetKey optional for inventory.', { key: string, targetKey: string, minimum: enumeration(['read', 'write', 'admin']), mode: enumeration(['direct', 'derived', 'all']) }, ['key']),
  tool('paths', 'Find actual structural paths, default 6 hops, maximum 12. Does not prove permission or execution.', { key: string, targetKey: string, maxHops: { type: 'integer', minimum: 1, maximum: 12 }, directed: { type: 'boolean' }, identity: enumeration(['all', 'person', 'none']), relationTypes: { type: 'array', items: string, maxItems: 17 } }, ['key', 'targetKey']),
  tool('findings', 'List currently visible Findings, or explain a specific findingId with checks and observed evidence. Each Finding has providers (the SaaS its detection path passes through, as the dashboard path graph shows), certainty (확인 confirmed or 추정 inferred) and basis (실행 기록 observed or 구성 기반 structural). The list summary counts the whole result by severity, category, certainty, basis and involved SaaS. List filters, combined with AND: severity, category, provider (a SaaS on the detection path), key (an involved object); the summary then counts only the filtered result. Exceptions are scoped to the current UI.', { findingId: string, key: string, severity: enumeration(['critical', 'high', 'medium', 'low', 'info']), category: string, provider: enumeration(providers), ...page }),
  tool('remediation', 'Read recommended remediation for a collected Finding. Never changes SaaS settings.', { findingId: string }, ['findingId']),
  tool('credential_blast', 'Rank credentials by computed compromise impact, or investigate a specific credential/account. mode account means owner account takeover; token means only stolen credential scope. Default both compares both and ranks each credential by the more dangerous of the two. Ranking uses highest level, tenant administration, certainty, cross-provider spread, then reached count; not an exploit probability score. key narrows to credential or owner, targetKey retrieves an exact impact path, type keeps one credential object type (as in the summary counts, without the SaaS). The summary counts the whole result by credential type, owner (with top owner accounts), highest level (사용 means reach without read or higher), tenant administration, cross-SaaS reach and calculation notes. Inventory is paginated, details bounded.', { key: string, targetKey: string, provider: enumeration(providers), type: string, mode: enumeration(['token', 'account', 'both']), ...page }),
] as const
export type KgToolName = typeof KG_TOOLS[number]['function']['name']
/** Log tools the AI Worker runs itself (server/assistant/logTools.ts); the browser only records their outputs. */
export const LOG_TOOLS: ReadonlySet<string> = new Set(['search_logs', 'read_logs'])
/**
 * Earlier event tools, replaced for the model by search_logs and read_logs. Still parsed because event_context reads
 * events through them (server/logEvents.ts logEventTool); never offered to the model, and the server refuses a model call to them.
 */
export const RETIRED_TOOLS: ReadonlySet<string> = new Set(['search_events', 'event_connections'])
export const MODEL_TOOLS = KG_TOOLS.filter(t => !RETIRED_TOOLS.has(t.function.name) && (t.function.name !== 'guideline_criterion' || registeredGuidelines().length > 0))
export type ToolArgs = Record<string, string | number | boolean | string[]>
/** Claude blocks that preceded a tool_use in the same turn. Replayed unchanged so preserved thinking stays valid. */
export type ClaudeTurnBlock = { type: 'thinking'; thinking: string; signature: string } | { type: 'redacted_thinking'; data: string } | { type: 'text'; text: string }
export interface KgCall { id: string; type: 'function'; function: { name: KgToolName; arguments: string }; extra_content?: { google?: { thought_signature: string }; anthropic?: { before: ClaudeTurnBlock[] } } }
export interface KgFact { id: string; kind: string; ref: string; label: string; detail?: string; state?: string; data?: Record<string, unknown> }
export interface KgOutput { summary: string; facts: KgFact[]; truncated: boolean }
export interface KgRound { calls: KgCall[]; outputs: KgOutput[] }
export interface KgHistory { question: string; answer: string }
/** The graph snapshot the screen shows. With it the chat step runs server graph tools itself (server/assistant/chat.ts runAssistantSteps). */
export interface KgRemote { snapshotId: string; visibleFindings: number; hideDefaults: boolean }
export interface KgRequest { question: string; history: KgHistory[]; focus: { sourceKey?: string; targetKey?: string; findingId?: string; eventKey?: string }; rounds: KgRound[]; workspace?: WorkspaceContext; images?: AssistantImage[]; remote?: KgRemote }
/** A log tool output the Worker computed: facts without citation IDs, numbered by the browser in call order. */
export interface LogToolOutput { summary: string; facts: Array<Omit<KgFact, 'id'>>; truncated: boolean }
/** 도구 결과를 모델에 보내는 글. 실행 SPL(executedSpl)은 패널 복사용이라 모델에 보내지 않고 근거 크기에도 세지 않는다 */
export const modelToolJson = (value: unknown) => JSON.stringify(value, (key, v) => key === 'executedSpl' ? undefined : v)
export type KgStep = { calls: KgCall[]; results?: Record<string, LogToolOutput>; answer?: never } | { answer: string; calls?: never; results?: never }
/**
 * One line of the chat stream (application/x-ndjson) when the request carries remote.
 * tool: progress of a call the server runs. round: a finished server round; executions holds the graph tool results, results the log outputs.
 * step: the last line, an answer or calls the browser must run itself, same shape as the JSON reply. error: the last line on failure.
 */
export type KgStreamEvent =
  | { type: 'tool'; id: string; name: string; status: 'running' | 'complete' | 'failed' }
  | { type: 'round'; calls: KgCall[]; results?: Record<string, LogToolOutput>; executions: Record<string, KgExecution> }
  | { type: 'step'; step: KgStep; timing?: string }
  | { type: 'error'; error: string; timing?: string }
export const KG_STREAM_TYPE = 'application/x-ndjson'

export const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const text = (x: unknown, max = 512): x is string => typeof x === 'string' && x.length <= max && !!x.trim()

/** An SPL pipeline is longer than other text arguments. */
const textLimit = (name: string, key: string) => key === 'spl' && name === 'search_logs' ? 3500 : 512
/**
 * 도구 인자를 검사하고, 거절하면 이유를 돌려준다(통과는 null). 이유는 모델이 인자를 고쳐 다시 부를 수 있게 그대로 알려 준다.
 * 판정 규칙은 여기 한 곳이다. parseToolArgs 는 이 결과로 통과 여부만 본다.
 */
export function toolArgsProblem(name: string, value: unknown): string | null {
  const schema = KG_TOOLS.find(t => t.function.name === name)?.function.parameters
  if (!schema) return `${name} is not a tool`
  if (!isRecord(value)) return 'arguments must be a JSON object'
  const unknown = Object.keys(value).filter(k => !Object.prototype.hasOwnProperty.call(schema.properties, k))
  if (unknown.length) return `unknown arguments: ${unknown.join(', ')}`
  const missing = schema.required.filter(k => Array.isArray(value[k]) ? false : !text(value[k], textLimit(name, k)))
  if (missing.length) return `required arguments missing, empty or too long: ${missing.join(', ')}`
  for (const [key, v] of Object.entries(value)) {
    const field = schema.properties[key] as { type: string; enum?: string[]; minimum?: number; maximum?: number; maxItems?: number; items?: { maxLength?: number; enum?: string[] } }
    // Only these four types are checked; any other schema type fails closed instead of passing unchecked.
    if (!['string', 'boolean', 'integer', 'array'].includes(field.type)) return `${key} has an unsupported schema type`
    if (field.type === 'string' && (typeof v !== 'string' || v.length > (textLimit(name, key)))) return `${key} must be a string of at most ${textLimit(name, key)} characters`
    if (field.type === 'string' && field.enum && !field.enum.includes(v as string)) return `${key} must be one of ${field.enum.join(', ')}`
    if (field.type === 'boolean' && typeof v !== 'boolean') return `${key} must be true or false`
    if (field.type === 'integer' && (!Number.isInteger(v) || Number(v) < field.minimum! || Number(v) > field.maximum!)) return `${key} must be an integer from ${field.minimum} to ${field.maximum}`
    if (field.type === 'array' && (!Array.isArray(v) || v.length > (field.maxItems ?? 17) || v.some(x => !text(x, field.items?.maxLength ?? 100)))) return `${key} must be a list of at most ${field.maxItems ?? 17} non-empty strings`
    if (field.type === 'array' && field.items?.enum && (!(v as unknown[]).length || (v as unknown[]).some(x => !field.items!.enum!.includes(x as string)) || new Set(v as unknown[]).size !== (v as unknown[]).length))
      return `${key} must list distinct values from ${field.items.enum.join(', ')}, or be left out`
  }
  if (name === 'compliance_item' && value.object !== undefined && !text(value.object)) return 'object must be a non-empty string of at most 512 characters'
  if (name === 'search_objects' && typeof value.property === 'string' && !filterablePropertyName(value.property)) return 'property must be a property name shown in object facts (letters, digits, underscore, up to two dots for nested values) and not a secret-like name'
  if (name === 'custom_criterion') {
    const lines = (k: string) => (value[k] as string[] | undefined) ?? []
    const bad = [...lines('filter'), ...lines('condition')].filter(t => !parseCondition(t))
    if (bad.length) return `filter and condition lines must be like path=value, path in a,b, path exists or path>=n: ${bad.join(' | ')}`
    if (!lines('fields').length || lines('fields').some(f => !checkFieldName(f))) return 'fields must list dotted property names (up to six parts) shown in object facts'
    if (lines('condition').length && !text(value.condition_quote)) return 'condition needs condition_quote, the exact phrase of source_text that states the required value'
  }
  if (name === 'search_logs') {
    const iso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v))
    if (!iso(value.from) || !iso(value.to)) return 'from and to must be absolute UTC times like 2026-11-01T00:00:00Z'
    if (Date.parse(String(value.from)) >= Date.parse(String(value.to))) return 'from must be before to'
    if (!Array.isArray(value.sourceRefs) || !value.sourceRefs.length) return 'sourceRefs must name at least one source'
    if (typeof value.spl === 'string' && value.spl.trim() && !value.spl.trim().startsWith('|')) return 'spl is only the pipeline after the base search and must start with |'
  }
  if (name === 'search_events') {
    // 모델에 주는 현재 시각이 분 단위(2026-10-30T03:15Z)라 초를 뺀 시각도 받는다. 날짜만 있거나 시간대가 없는 값은 거절한다.
    const iso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(`${v.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === v.slice(0, 10)
    if ((value.from !== undefined || value.to !== undefined) && (!iso(value.from) || !iso(value.to) || Date.parse(String(value.from)) >= Date.parse(String(value.to)))) return 'from and to must both be ISO times with a time zone, from before to'
    const blank = Object.entries(value).filter(([k, v]) => typeof v === 'string' && !v.trim() && !['text'].includes(k)).map(([k]) => k)
    if (blank.length) return `empty arguments: ${blank.join(', ')}`
    if (Array.isArray(value.objectKeys) && !value.objectKeys.length) return 'objectKeys must not be empty; leave it out instead'
  }
  if (name === 'paths' && !parseAssistantPlan({ intent: 'path_lookup', entity: { text: String(value.key) }, target: { text: String(value.targetKey) }, ...Object.fromEntries(Object.entries(value).filter(([k]) => !['key', 'targetKey'].includes(k))) })) return 'key and targetKey must name a path lookup the planner accepts'
  return null
}
export function parseToolArgs(name: string, value: unknown): ToolArgs | null {
  return toolArgsProblem(name, value) === null ? value as ToolArgs : null
}
/** 도구 호출 하나가 왜 거절되는지(parseKgCall 과 같은 순서). 통과하면 null */
export function kgCallProblem(value: unknown): string | null {
  if (!isRecord(value) || !text(value.id, 200) || value.type !== 'function' || !isRecord(value.function) || !text(value.function.name, 100)) return 'malformed tool call'
  if (typeof value.function.arguments !== 'string' || value.function.arguments.length > 4096) return `${value.function.name}: arguments must be a JSON string of at most 4096 characters`
  let args: unknown
  try { args = JSON.parse(value.function.arguments) } catch { return `${value.function.name}: arguments are not valid JSON` }
  const problem = toolArgsProblem(value.function.name, args)
  if (problem) return `${value.function.name}: ${problem}`
  return parseKgCall(value) ? null : `${value.function.name}: malformed provider metadata`
}
export function parseKgCall(value: unknown): KgCall | null {
  if (!isRecord(value) || !text(value.id, 200) || value.type !== 'function' || !isRecord(value.function) || !text(value.function.name, 100) || typeof value.function.arguments !== 'string' || value.function.arguments.length > 4096) return null
  try { if (!parseToolArgs(value.function.name, JSON.parse(value.function.arguments))) return null } catch { return null }
  const signature = isRecord(value.extra_content) && isRecord(value.extra_content.google) ? value.extra_content.google.thought_signature : undefined
  if (signature !== undefined && !text(signature, 24000)) return null
  const before = isRecord(value.extra_content) && isRecord(value.extra_content.anthropic) ? parseClaudeBlocks(value.extra_content.anthropic.before) : undefined
  if (before === null) return null
  const extra = { ...(signature ? { google: { thought_signature: signature as string } } : {}), ...(before?.length ? { anthropic: { before } } : {}) }
  return { id: value.id, type: 'function', function: { name: value.function.name, arguments: value.function.arguments }, ...(Object.keys(extra).length ? { extra_content: extra } : {}) }
}
function parseClaudeBlocks(value: unknown): ClaudeTurnBlock[] | null {
  if (!Array.isArray(value) || value.length > 8 || JSON.stringify(value).length > 120_000) return null
  const blocks: ClaudeTurnBlock[] = []
  for (const b of value) {
    if (!isRecord(b)) return null
    if (b.type === 'thinking' && typeof b.thinking === 'string' && typeof b.signature === 'string' && b.signature) blocks.push({ type: 'thinking', thinking: b.thinking, signature: b.signature })
    else if (b.type === 'redacted_thinking' && text(b.data, 100_000)) blocks.push({ type: 'redacted_thinking', data: b.data })
    else if (b.type === 'text' && text(b.text, 4000)) blocks.push({ type: 'text', text: b.text })
    else return null
  }
  return blocks
}
export function parseKgRequest(value: unknown): KgRequest | null {
  if (!isRecord(value) || Object.keys(value).some(k => !['question', 'history', 'focus', 'rounds', 'workspace', 'images', 'remote'].includes(k)) || !text(value.question, QUESTION_LIMIT) || !Array.isArray(value.history) || value.history.length > 6 || !isRecord(value.focus) || !Array.isArray(value.rounds) || value.rounds.length > CHAT_ROUNDS) return null
  const workspace = value.workspace === undefined ? undefined : parseWorkspace(value.workspace)
  const images = value.images === undefined ? undefined : parseImages(value.images)
  const remote = value.remote === undefined ? undefined : parseRemote(value.remote)
  if (workspace === null || images === null || remote === null) return null
  if (value.history.some(h => !isRecord(h) || Object.keys(h).some(k => !['question', 'answer'].includes(k)) || !text(h.question, QUESTION_LIMIT) || !text(h.answer, 4000))) return null
  if (Object.entries(value.focus).some(([k, v]) => !['sourceKey', 'targetKey', 'findingId', 'eventKey'].includes(k) || !text(v))) return null
  const ids = new Set<string>()
  const rounds: KgRound[] = []
  for (const round of value.rounds) {
    if (!isRecord(round) || Object.keys(round).some(k => !['calls', 'outputs'].includes(k)) || !Array.isArray(round.calls) || !round.calls.length || round.calls.length > 4 || !Array.isArray(round.outputs) || round.outputs.length !== round.calls.length) return null
    const calls: KgCall[] = []
    for (let i = 0; i < round.calls.length; i++) {
      const call = parseKgCall(round.calls[i])
      const output = round.outputs[i]
      if (!call || ids.has(call.id) || !isRecord(output) || Object.keys(output).some(k => !['summary', 'facts', 'truncated'].includes(k)) || typeof output.summary !== 'string' || output.summary.length > 8000 || !Array.isArray(output.facts) || output.facts.length > 60 || typeof output.truncated !== 'boolean' || modelToolJson(output).length > TOOL_OUTPUT_LIMIT) return null
      const prefix = `T${ids.size + 1}-E`
      if (output.facts.some((f, index) => !isRecord(f) || Object.keys(f).some(k => !['id', 'kind', 'ref', 'label', 'detail', 'state', 'data'].includes(k)) || f.id !== `${prefix}${index + 1}` || !text(f.kind, 40) || !text(f.ref) || !text(f.label, 512) || (f.detail !== undefined && typeof f.detail !== 'string') || (f.state !== undefined && !['confirmed', 'inferred', 'unknown'].includes(String(f.state))) || (f.data !== undefined && !isRecord(f.data)))) return null
      ids.add(call.id); calls.push(call)
    }
    rounds.push({ calls, outputs: round.outputs as KgOutput[] })
  }
  if (ids.size > TOOL_LIMIT) return null
  return { question: value.question, history: value.history as KgHistory[], focus: value.focus, rounds, ...(workspace ? { workspace } : {}), ...(images ? { images } : {}), ...(remote ? { remote } : {}) }
}
function parseRemote(value: unknown): KgRemote | null {
  if (!isRecord(value) || Object.keys(value).some(k => !['snapshotId', 'visibleFindings', 'hideDefaults'].includes(k))) return null
  if (!text(value.snapshotId, 100) || !Number.isInteger(value.visibleFindings) || (value.visibleFindings as number) < 0 || typeof value.hideDefaults !== 'boolean') return null
  return { snapshotId: value.snapshotId, visibleFindings: value.visibleFindings as number, hideDefaults: value.hideDefaults }
}
/** Legacy queries are deterministic engines behind tools, not the model's single allowed intent. */
export function toolPlan(name: string, args: ToolArgs): AssistantPlan | null {
  const entity = { text: String(args.key) }
  const common = Object.fromEntries(Object.entries(args).filter(([k]) => !['key', 'targetKey'].includes(k)))
  if (name === 'identity') return { intent: 'identity_lookup', entity }
  if (name === 'access') return parseAssistantPlan({ intent: 'access_analyze', entity, ...(args.targetKey ? { target: { text: String(args.targetKey) } } : {}), ...common })
  if (name === 'paths') return parseAssistantPlan({ intent: 'path_lookup', entity, target: { text: String(args.targetKey) }, ...common })
  if (name === 'remediation') return parseAssistantPlan({ intent: 'remediation_suggest', findingId: args.findingId })
  if (name === 'findings' && args.findingId) return parseAssistantPlan({ intent: 'finding_explain', findingId: args.findingId })
  return null
}
