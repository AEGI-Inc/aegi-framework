/**
 * 수집 API 목록 생성: Profile 이 읽는 API 를 하나의 표로 모으고, 실행할 수 있는지와 그 사유를 정한다.
 *
 *   npm run api-list:build            api-list.jsonl, summary.json 을 다시 만든다
 *   npm run api-list:build -- --check 파일이 최신인지 확인만 한다 (test:collect 가 같은 검사를 한다)
 *
 * 입력
 *   - profile-binding/profiles + overlays (정규화기와 같은 깊은 병합). runtime_rules Profile 은 손코드 호출을 쓰므로 제외
 *   - IM V3.2 evidence/observation-operation-links.jsonl: 손코드 호출(GH-05 등)이 이미 읽는 operation
 *   - api-list/inventory-scopes.json: 문서상 scope 근거 (import-inventory.ts 가 total-collector 인벤토리에서 만든다)
 *   - api-list/review.json: 사람이(또는 검토 기록을 남긴 에이전트가) 실행을 승인하거나 거절한 결정
 *
 * 상태 (먼저 맞는 것)
 *   legacy     손코드 호출이 이미 읽는다. 수집 API 목록은 다시 부르지 않는다
 *   blocked    실행할 수 없다 (reason: 쓰기 메서드, 호스트 미설정, 경로 변수 못 품, GWS scope 모름, 내용 본문 등)
 *   approved   review.json 이 승인했다. npm run collect 가 실행한다
 *   rejected   review.json 이 거절했다
 *   candidate  실행할 수 있지만 아직 검토하지 않았다. 실행하지 않는다
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import YAML from 'yaml'
import type { Provider } from '../lib/store'
import { gwsScopeFor, SOURCES } from './sources'
import { planParams, QUERY_PARAMS, resolveParam, SLACK_BOT_TOKEN_OPS, SOQL_WHERE, templateParams, type FanoutSource, type ParamPlan, type ParamResolution, type TemplateParam } from './params'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENGINE = path.resolve(HERE, '../../..')
const PB = path.join(HERE, '../profile-binding')

export type EntryStatus = 'legacy' | 'blocked' | 'approved' | 'rejected' | 'candidate'

export interface ApiListEntry {
  id: string
  operation_id: string
  source: string
  provider: Provider | null
  method: string
  surface: string
  path_template: string
  /** 요청 문맥 (Salesforce soql_object 등). 원본 봉투 request_params 에 그대로 남아 정규화기가 맞춘다 */
  request: Record<string, string>
  kind: string
  /** payload 에서 항목 배열까지의 경로 ('*' 는 payload 자체, '' 는 단건) */
  items: string
  profiles: string[]
  object_types: string[]
  interfaces: string[]
  status: EntryStatus
  reason?: string
  legacy_calls?: string[]
  params?: Pick<ParamPlan, 'resolutions' | 'fanout'> & {
    /** 경로에 없는 필수 인자 값 (params.ts QUERY_PARAMS) */
    query?: Record<string, ParamResolution>
    /** Salesforce 조회의 WHERE 절 (params.ts SOQL_WHERE) */
    soql_where?: string
    /** 기본 자격증명 대신 쓸 토큰 (params.ts SLACK_BOT_TOKEN_OPS) */
    token?: 'slack_bot'
  }
  scopes: { required: string[]; basis: string }
  review?: ReviewDecision
}

export interface ReviewDecision {
  operation_id: string
  decision: 'approve' | 'reject'
  reason: string
  reviewer: string
  date: string
}

const readJsonl = (f: string) => fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))

function deepMerge(base: any, over: any): any {
  if (over === null) return undefined
  if (Array.isArray(over) || typeof over !== 'object' || typeof base !== 'object' || base === null || Array.isArray(base)) return over
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) { const m = deepMerge(base[k], v); if (m === undefined) delete out[k]; else out[k] = m }
  return out
}

export function loadProfiles(pbDir = PB): Array<{ file: string; provider: string; prof: any }> {
  const out: Array<{ file: string; provider: string; prof: any }> = []
  for (const p of fs.readdirSync(path.join(pbDir, 'profiles')).sort()) {
    for (const f of fs.readdirSync(path.join(pbDir, 'profiles', p)).filter(f => f.endsWith('.yaml')).sort()) {
      let prof = YAML.parse(fs.readFileSync(path.join(pbDir, 'profiles', p, f), 'utf8'))
      const ov = path.join(pbDir, 'overlays', p, f)
      if (fs.existsSync(ov)) prof = deepMerge(prof, YAML.parse(fs.readFileSync(ov, 'utf8')) ?? {})
      out.push({ file: `${p}/${f}`, provider: p, prof })
    }
  }
  return out
}

/** 문자열이 내용 본문(메시지, 파일 내용, 녹음, 댓글, 연락처 등)을 돌려주는 API 를 가리키는가. 권한 그래프에는 메타데이터만 쓴다 */
const CONTENT = /(\/|\.|^)(messages?|history|replies|attachments?|content|download|exports?|recordings?|transcripts?|drafts?|threads?|blobs?|raw|search|comments?|footer-comments|inline-comments|readme|photos|events|otherContacts|contactGroups|pages|blogposts|tasks|custom-content|notifications)(\b|\/|\.|$)/i
/** 본문 내용을 담는 Salesforce 객체 */
const SF_CONTENT = /^(EmailMessage|ContentVersion|ContentNote|Attachment|Note|FeedItem|FeedComment|.*Feed|.*History|ChatterMessage|.*Share)$/
/** Slack RPC 중 읽기 메서드만 (마지막 조각이 list, info, get, lookup, fetch …) */
const SLACK_READ = /\.(list\w*|info|get\w*|lookup|fetch)$/
/** Slack RPC 중 내용, 앱 개인 데이터, 화면 조작 메서드 */
const SLACK_CONTENT = /^(files|reactions|chat|reminders|bookmarks|apps\.datastore|admin\.analytics|slackLists|agents\.conversations|views|oauth|tooling)\./
/** GitHub 앱 설치 토큰에는 사용자가 없다. 인증 사용자 문맥 API 는 의미가 없다 */
const GITHUB_USER_CONTEXT = /^\/(user|notifications|gists|issues|agents\/tasks)(\/|$)/

export function opName(operationId: string): string {
  return operationId.split(':').slice(2).join(':')
}

export function entryId(prefix: string, operationId: string, taken: Set<string>): string {
  let name = opName(operationId).replace(/^(GET|POST)\s+/, '').replace(/\.query$/, '').replace(/[/{}\s]+/g, '.').replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.+/g, '.').replace(/^\.|\.$/g, '')
  if (name.length > 70) name = name.slice(0, 60) + '.' + crypto.createHash('sha256').update(operationId).digest('hex').slice(0, 8)
  let id = `RG-${prefix}-${name}`
  if (taken.has(id)) id = `${id}.${crypto.createHash('sha256').update(operationId).digest('hex').slice(0, 6)}`
  taken.add(id)
  return id
}

/**
 * identity 의 $req.<이름> 중 실행이 줄 수 없는 것. 정규화기(normalize.mjs)와 같은 규칙:
 * 경로 변수와 요청 값은 있고, parent_id 는 경로의 부모 변수(목록 경로는 마지막 변수, 단건 경로는 끝에서 두 번째)다.
 */
export function unresolvedReq(refs: Iterable<string>, template: string, request: Record<string, string>, surface: string): string[] {
  const segs = template.split('?')[0].split('/').filter(Boolean)
  const vars = segs.filter(x => /^\{[^}]+\}$/.test(x))
  const lastIsVar = /^\{[^}]+\}$/.test(segs[segs.length - 1] ?? '')
  const hasParent = Boolean(lastIsVar ? vars[vars.length - 2] : vars[vars.length - 1])
  const names = new Set(vars.map(v => v.slice(1, -1)))
  return [...refs].filter(r => !names.has(r) && !(r in request) && !(r === 'parent_id' && hasParent) && !(surface === 'rpc' && r === 'method'))
}

export function readsOnlyApiList(rules: any[]): boolean {
  const calls = rules.flatMap(r => (r?.sources ?? []).map((s: any) => String(s?.call ?? '')))
  return calls.length > 0 && calls.every(c => c.startsWith('RG-'))
}

export interface BuildInputs {
  profiles: Array<{ file: string; provider: string; prof: any }>
  observationLinks: any[]
  inventoryScopes: Record<string, string[]>
  review: ReviewDecision[]
}

export function buildApiList(inp: BuildInputs): ApiListEntry[] {
  // 손코드 호출이 이미 읽는 operation (모델의 실측 연결 + Profile binding.call)
  const legacy = new Map<string, Set<string>>()
  const addLegacy = (op: string | undefined, call: string | null | undefined) => {
    if (!op || !call) return
    if (!legacy.has(op)) legacy.set(op, new Set())
    legacy.get(op)!.add(call)
  }
  for (const l of inp.observationLinks) if (l.operation?.status === 'matched') {
    addLegacy(l.operation.ir_operation_id, l.collection?.call_id)
    for (const alt of l.operation.alternates ?? []) addLegacy(alt, l.collection?.call_id)
  }
  const ops = new Map<string, { b: any; profiles: string[]; types: string[]; ifaces: string[]; source: string; reqRefs: Set<string>; idFields: Set<string> }>()
  for (const { file, prof } of inp.profiles) {
    // 실행 규칙 Profile 은 손코드 호출을 읽는다. 다만 규칙 출처가 모두 수집 API 목록 호출(RG-)이면 그 호출을 수집해야 하므로 남긴다
    // (예: Salesforce 권한 내용 행을 부모 권한 세트에 접는 enrich 규칙)
    if (prof.runtime_rules && !readsOnlyApiList(prof.runtime_rules)) continue
    const b = prof.binding ?? {}
    for (const s of [b, ...(b.sources ?? []), ...(b.observed_sources ?? [])]) addLegacy(s.operation_id, s.call)
    if (!b.operation_id || b.status === 'non_object') continue
    const source = String(b.operation_id).split(':')[1]
    const key = b.operation_id
    const cur = ops.get(key) ?? { b, profiles: [], types: [], ifaces: [], source, reqRefs: new Set<string>(), idFields: new Set<string>() }
    // identity 가 쓰는 요청 값($req.<이름>). 실행이 그 값을 주지 못하면 모든 레코드가 identity 거부된다
    const idExprs = [...(prof.identity?.primary ?? []).map((k: any) => k?.expr), prof.identity?.parent?.expr]
    for (const e of idExprs) for (const m of String(e ?? '').matchAll(/\$req\.([A-Za-z_]\w*)/g)) cur.reqRefs.add(m[1])
    // 목록 항목을 가리키는 필드(자식 경로 변수 값으로 쓴다)
    for (const k of prof.identity?.primary ?? []) if (/^[A-Za-z_]\w*$/.test(String(k?.expr ?? ''))) cur.idFields.add(String(k.expr))
    cur.profiles.push(file)
    cur.types.push(String(prof.object_type))
    for (const i of prof.interfaces ?? []) cur.ifaces.push(String(i))
    ops.set(key, cur)
  }
  const reviews = new Map(inp.review.map(r => [r.operation_id, r]))
  const taken = new Set<string>()
  const out: ApiListEntry[] = []
  const idFieldsOf = new Map<string, Set<string>>()
  const deferred: Array<{ entry: ApiListEntry; provider: Provider; template: string }> = []
  for (const [operationId, { b, profiles, types, ifaces, source, reqRefs, idFields }] of [...ops].sort(([a], [b2]) => a.localeCompare(b2))) {
    const spec = SOURCES[source]
    const surface = String(b.surface ?? (b.endpoint_template ? 'rest' : ''))
    const template = String(b.endpoint_template ?? (surface === 'rpc' ? opName(operationId) : ''))
    const method = String(b.method ?? (surface === 'rpc' ? 'GET' : '')).toUpperCase()
    const firstPath = b.paths?.[0]?.path ?? []
    const star = firstPath.indexOf('*')
    const items = star === 0 ? '*' : star > 0 ? firstPath.slice(0, star).join('.') : ''
    const entry: ApiListEntry = {
      id: entryId(spec?.prefix ?? 'XX', operationId, taken),
      operation_id: operationId,
      source,
      provider: spec?.provider ?? null,
      method,
      surface,
      path_template: template,
      request: Object.fromEntries(Object.entries(b.request ?? {}).map(([k, v]) => [k, String(v)])),
      kind: String(b.kind ?? ''),
      items,
      profiles: [...new Set(profiles)].sort(),
      object_types: [...new Set(types)].sort(),
      interfaces: [...new Set(ifaces)].sort(),
      status: 'candidate',
      scopes: { required: [], basis: 'none' },
    }
    idFieldsOf.set(operationId, idFields)
    const block = (reason: string) => { entry.status = 'blocked'; entry.reason = reason }
    const legacyCalls = legacy.get(operationId)
    if (legacyCalls?.size) {
      entry.status = 'legacy'
      entry.legacy_calls = [...legacyCalls].sort()
      out.push(entry)
      continue
    }
    // scope 근거
    const invScopes = inp.inventoryScopes[operationId]
    if (spec?.auth === 'gws') {
      const s = gwsScopeFor(source, template)
      if (s) entry.scopes = { required: [s], basis: 'gws_service_scope' }
    } else if (invScopes?.length) entry.scopes = { required: invScopes, basis: 'inventory_document' }

    const sfObject = entry.request.soql_object
    // 경로에 없는 필수 인자(쿼리, RPC 인자)는 값을 줄 방법이 없다
    const inTemplate = new Set([...template.matchAll(/\{([^}]+)\}/g)].map(m => m[1]))
    // Google Discovery 의 parent, name 은 경로(customers/{customersId} 등)를 이어 붙인 자원 이름이라 경로가 채워지면 함께 정해진다
    const pathNamed = spec?.auth === 'gws' && inTemplate.size > 0 ? new Set(['parent', 'name']) : new Set<string>()
    const query = QUERY_PARAMS[operationId]
    const extraRequired = ((b.required_params ?? []) as string[]).filter(p => !inTemplate.has(p) && !pathNamed.has(p) && !query?.[p])
    if (!spec) block('source_not_in_registry_table')
    else if (spec.blocked) block(spec.blocked)
    else if (method !== 'GET') block(`method_${method || 'unknown'}`)
    else if (!template) block('no_endpoint_template')
    else if (surface === 'rpc' && (!SLACK_READ.test(template) || /\.(set|open|push|rotate|begin)\w*$/i.test(template))) block('rpc_not_read_method')
    else if (surface === 'rpc' && SLACK_CONTENT.test(template)) block('content_bearing_endpoint')
    else if (spec.provider === 'github' && GITHUB_USER_CONTEXT.test(template)) block('user_context_api')
    else if (spec.auth === 'gws' && !entry.scopes.required.length) block('gws_scope_unknown')
    else if (sfObject ? SF_CONTENT.test(sfObject) : surface !== 'rpc' && CONTENT.test(template)) block('content_bearing_endpoint')
    else if (extraRequired.length) block(`required_argument:${extraRequired.join(',')}`)
    else if (unresolvedReq(reqRefs, template, entry.request, surface).length) block(`identity_needs_request_param:${unresolvedReq(reqRefs, template, entry.request, surface).join(',')}`)
    else {
      const plan = planParams(spec.provider, template)
      if (!plan.ok) { block(plan.reason!); deferred.push({ entry, provider: spec.provider, template }) }
      else entry.params = { resolutions: plan.resolutions, ...(plan.fanout ? { fanout: plan.fanout } : {}), ...fixedArgs(operationId, sfObject) }
    }
    out.push(entry)
  }

  // 두 번째 단계: 표로 못 푼 경로 변수를 부모 목록 operation 으로 푼다. 부모가 풀리면 자식이 풀릴 수 있어 바뀌지 않을 때까지 돈다
  const lists = new Map<string, ApiListEntry[]>()
  for (const e of out) {
    if (e.method !== 'GET' || e.surface !== 'rest' || e.kind === 'read_one' || !e.items || !e.provider) continue
    const key = `${e.provider}|${shapeOf(e.path_template)}`
    lists.set(key, [...(lists.get(key) ?? []), e])
  }
  const parentFor = (provider: Provider, template: string) => (last: TemplateParam, inherit: string[]): FanoutSource | null => {
    const segs = template.split('?')[0].split('/')
    const at = segs.indexOf(`{${last.name}}`)
    if (at <= 1) return null
    const parentTemplate = segs.slice(0, at).join('/')
    for (const parent of (lists.get(`${provider}|${shapeOf(parentTemplate)}`) ?? []).sort((a, b) => Number(b.status === 'legacy') - Number(a.status === 'legacy') || a.id.localeCompare(b.id))) {
      // 검토에서 거절된 부모는 실행되지 않으므로 부모로 쓰지 않는다
      const runnable = parent.status === 'legacy' ? Boolean(parent.legacy_calls?.length) : parent.status !== 'blocked' && parent.status !== 'rejected' && reviews.get(parent.operation_id)?.decision !== 'reject' && Boolean(parent.params)
      if (!runnable) continue
      // 부모 경로의 fanout 변수와 자식의 앞 변수는 자리로 맞춘다. 부모 페이지의 요청 값 이름은 경로 변수 이름(손코드는 Id 를 뗀 이름도)이다
      const parentVars = templateParams(parent.path_template).filter(p => resolveParam(provider, p)?.kind !== 'const' && resolveParam(provider, p)?.kind !== 'literal').map(p => p.name)
      if (parentVars.length !== inherit.length) continue
      const ids = [...(idFieldsOf.get(parent.operation_id) ?? [])]
      const singular = last.name.replace(/s(Id)$/, '$1')
      // Google 경로 변수는 자원 이름(name: devices/abc)의 마지막 조각이다. deviceId 같은 필드는 다른 값일 수 있어 name 을 먼저 본다
      const fields = [...new Set([last.name, ...(provider === 'gws' ? ['name'] : []), singular, ...nameHints(last.name), ...(ids.includes('id') ? ['id'] : []), ...ids, 'id'])]
      return {
        call: parent.status === 'legacy' ? parent.legacy_calls![0] : parent.id,
        items: parent.items,
        field: fields[0],
        fields,
        ...(provider === 'gws' ? { last_segment: true } : {}),
        path_template: parent.path_template,
        ...(inherit.length ? { inherit: Object.fromEntries(inherit.map((n, i) => [n, parentVars[i]])) } : {}),
      }
    }
    return null
  }
  for (let changed = true; changed;) {
    changed = false
    for (const { entry, provider, template } of deferred) {
      if (entry.status !== 'blocked') continue
      const plan = planParams(provider, template, parentFor(provider, template))
      if (!plan.ok) { entry.reason = plan.reason; continue }
      entry.status = 'candidate'
      delete entry.reason
      entry.params = { resolutions: plan.resolutions, ...(plan.fanout ? { fanout: plan.fanout } : {}), ...fixedArgs(entry.operation_id, entry.request.soql_object) }
      changed = true
    }
  }

  for (const entry of out) {
    const r = reviews.get(entry.operation_id)
    if (!r || entry.status === 'legacy') continue
    entry.review = r
    if (entry.status === 'candidate') entry.status = r.decision === 'approve' ? 'approved' : 'rejected'
    else if (r.decision === 'approve' && entry.status === 'blocked') entry.reason = `${entry.reason} (review approve ignored)`
  }
  return out
}

/** 경로 밖 고정 인자: 쿼리 값과 Salesforce WHERE 절 (없으면 빈 객체라 항목 모양이 그대로다) */
function fixedArgs(operationId: string, sfObject: string | undefined): { query?: Record<string, ParamResolution>; soql_where?: string; token?: 'slack_bot' } {
  const query = QUERY_PARAMS[operationId]
  const where = sfObject ? SOQL_WHERE[sfObject] : undefined
  return { ...(query ? { query } : {}), ...(where ? { soql_where: where } : {}), ...(SLACK_BOT_TOKEN_OPS.has(operationId) ? { token: 'slack_bot' as const } : {}) }
}

/** 경로 모양: 변수 이름을 지운 틀 (부모 경로와 비교할 때 쓴다) */
const shapeOf = (template: string) => template.split('?')[0].replace(/\{[^}]+\}/g, '{}').replace(/\/$/, '')

/** 변수 이름이 가리키는 항목 필드 (pull_number → number, tree_sha → sha …) */
function nameHints(name: string): string[] {
  if (/(_number|Number)$/.test(name)) return ['number']
  if (/sha$/i.test(name)) return ['sha']
  if (/slug$/i.test(name)) return ['slug']
  if (/(_name|Name)$/.test(name)) return ['name']
  if (/(_key|Key)$/.test(name)) return ['key']
  return []
}

export function summarize(entries: ApiListEntry[]) {
  const by = (f: (e: ApiListEntry) => string) => entries.reduce<Record<string, number>>((a, e) => { const k = f(e); a[k] = (a[k] ?? 0) + 1; return a }, {})
  const providers: Record<string, Record<string, number>> = {}
  for (const e of entries) {
    const p = e.provider ?? 'unknown'
    providers[p] ??= {}
    providers[p][e.status] = (providers[p][e.status] ?? 0) + 1
  }
  return {
    format: 'aegi-collect-registry-summary/v1',
    operations: entries.length,
    profiles: new Set(entries.flatMap(e => e.profiles)).size,
    by_status: by(e => e.status),
    by_provider: providers,
    blocked_reasons: by(e => (e.status === 'blocked' ? (e.reason ?? '').replace(/:.*/, '') : '')).valueOf(),
  }
}

export function loadInputs(modelDir: string): BuildInputs {
  const scopesFile = path.join(HERE, 'inventory-scopes.json')
  const reviewFile = path.join(HERE, 'review.json')
  return {
    profiles: loadProfiles(),
    observationLinks: readJsonl(path.join(modelDir, 'evidence/observation-operation-links.jsonl')),
    inventoryScopes: fs.existsSync(scopesFile) ? JSON.parse(fs.readFileSync(scopesFile, 'utf8')).scopes : {},
    review: fs.existsSync(reviewFile) ? JSON.parse(fs.readFileSync(reviewFile, 'utf8')).decisions : [],
  }
}

export function render(entries: ApiListEntry[]): { apiList: string; summary: string } {
  const summary = summarize(entries)
  delete (summary.blocked_reasons as any)['']
  return {
    apiList: entries.map(e => JSON.stringify(e)).join('\n') + '\n',
    summary: JSON.stringify(summary, null, 2) + '\n',
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const i = args.indexOf('--model')
  const modelDir = path.resolve(i >= 0 ? args[i + 1] : process.env.IM_MODEL_DIR ?? path.join(ENGINE, '../aegi-knowledge/schema/im-model/model/v3.2'))
  if (!fs.existsSync(path.join(modelDir, 'evidence/observation-operation-links.jsonl'))) {
    // CI 에는 aegi-knowledge 가 없다. 확인만 할 때는 건너뛰고, 만들 때는 실패한다
    console.error(`IM 모델 폴더가 없다: ${modelDir} (--model 또는 IM_MODEL_DIR)`)
    process.exit(args.includes('--check') ? 0 : 2)
  }
  const { apiList, summary } = render(buildApiList(loadInputs(modelDir)))
  const files: Array<[string, string]> = [[path.join(HERE, 'api-list.jsonl'), apiList], [path.join(HERE, 'summary.json'), summary]]
  if (args.includes('--check')) {
    const stale = files.filter(([f, text]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n') !== text).map(([f]) => path.basename(f))
    if (stale.length) { console.error(`수집 API 목록이 최신이 아니다: ${stale.join(', ')} (npm run api-list:build)`); process.exit(1) }
    console.log('수집 API 목록 최신')
  } else {
    for (const [f, text] of files) fs.writeFileSync(f, text)
    console.log(summary)
  }
}
