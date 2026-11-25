/**
 * 수집 API 목록 호출 (total collector). scripts/collect/api-list/api-list.jsonl 의 approved 항목을 호출로 만든다.
 *
 * - 손코드 호출(GH-05 등)이 모두 끝난 뒤에 돈다. 부모 목록(사용자, 앱, 저장소 …)은 그 호출들이 이번 실행에 저장한 페이지에서 읽는다.
 * - 호스트는 api-list/sources.ts 표에서만 나온다. 만든 주소의 호스트가 허용 목록 밖이면 부르지 않는다.
 * - 원본 봉투에 IR operation(operation.id, path_template)을 남긴다. 정규화기는 이 값으로 Profile binding 과 맞춘다.
 * - 탐색 호출이라 HTTP·API 오류(401 포함)는 그 호출만 partial(사유)로 남긴다. 인증 오류가 연달아 AUTH_STRIKE_LIMIT 번 나면 그 SaaS 의 남은 수집 API 목록 호출을 건너뛴다.
 * - scope 가 설정에 없으면(Okta config.okta.scopes, GWS DWD 허용 목록) 부르지 않고 skipped(scope_not_granted) 다.
 * - Salesforce 는 먼저 조직의 sObject 목록(describeGlobal, SF_OBJECTS_CALL)을 한 번 받는다. 그 목록에 없거나 조회할 수 없는 객체는
 *   부르지 않고 skipped(object_not_in_org, object_not_queryable) 다. 목록을 받지 못하면 거르지 않고 모두 부른다.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { atlassianBasicAuth, bearerAuth, githubAppAuth, googleDwdAuthFactory, normalizeAtlassianSiteUrl, normalizeOktaOrgUrl, normalizeSalesforceUrl, type GoogleKey } from '../lib/auth'
import { salesforceAuth } from './salesforce'
import type { Auth } from '../lib/http'
import { buildUrl, httpClassifier, type CallApi, type CallDef, type Classifier } from '../lib/runner'
import { missingCredential } from '../config'
import type { ApiListEntry } from '../api-list/build'
import { fanoutTuples } from '../api-list/params'
import { SOURCES, trustedHost, type SourceSpec } from '../api-list/sources'
import { GWS_COLLECT_SCOPES, gwsClassifier } from './gws'
import { oktaAuth, oktaGrantedScopes } from './okta'
import { slackClassifier } from './slack'
import type { ProviderContext } from './common'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const API_LIST_FILE = path.join(HERE, '../api-list/api-list.jsonl')
/** fanout 부모 수 상한. 넘으면 앞에서 자르고 partial(fanout_limit) */
export const FANOUT_LIMIT = 200
/** GWS DWD 에 기본으로 허용한 scope. 나머지는 config.gws.grantedScopes 에 있어야 한다 (providers/gws.ts 와 같은 규칙) */
const GATED_GWS = new Set(['drive.readonly', 'script.deployments.readonly', 'gmail.settings.basic', 'apps.groups.settings', 'apps.licensing'])

export function loadApiList(file = API_LIST_FILE): ApiListEntry[] {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l) as ApiListEntry)
}

/** Salesforce 조직의 sObject 목록을 받는 호출 ID. Salesforce 수집 API 목록 호출보다 먼저 돈다 */
export const SF_OBJECTS_CALL = 'RG-SF-describeGlobal'

/** describeGlobal 응답에서 이름과 조회 가능 여부만 남긴다 (필드 설명과 URL 은 크고 쓰지 않는다) */
export function summarizeSObjects(body: any): { sobjects: Array<{ name: string; queryable: boolean }> } {
  const list = Array.isArray(body?.sobjects) ? body.sobjects : []
  return { sobjects: list.filter((o: any) => typeof o?.name === 'string').map((o: any) => ({ name: o.name, queryable: o.queryable !== false })) }
}

/** 같은 SaaS 에서 인증 오류로만 끝난 수집 API 목록 호출이 이만큼 이어지면 남은 수집 API 목록 호출을 건너뛴다 (자격증명 자체가 깨진 경우) */
export const AUTH_STRIKE_LIMIT = 5

/** Okta 가 조직에 없는 기능을 부르면 주는 응답(401 + E0000015). 토큰은 유효하므로 인증 실패가 아니다 */
const OKTA_FEATURE_GATE = 'okta_E0000015'

/** 호출 하나가 받은 응답: 성공 수, 인증 오류 수, 기능 없음(gate) 수 */
interface CallSeen { ok: number; auth: number; gate: number }

/**
 * 탐색 호출 분류: 실패는 모두 그 호출만 partial 로 남긴다.
 * 401 도 기능·라이선스 게이트(예: Copilot 전용 API, Forge 전용 속성)인 경우가 많아 SaaS 를 멈추지 않는다.
 * 손코드 호출이 같은 자격증명을 먼저 검증했고, 인증 오류로만 끝난 호출이 이어지면 남은 호출을 막는다.
 * 세는 단위는 요청이 아니라 호출이다. fanout 호출 하나가 부모마다 401 을 받아도 1 번이다.
 */
function soften(base: Classifier, seen: () => CallSeen): Classifier {
  return res => {
    const v = base(res)
    if (!v) { seen().ok++; return null }
    // 기능 없음 401 은 인증 실패로 세지 않는다. 세면 이런 호출이 이어질 때 남은 호출을 모두 건너뛴다
    if (v.kind === 'auth') { if (errorCause(res.body) === OKTA_FEATURE_GATE) seen().gate++; else seen().auth++ }
    if (v.kind === 'not_found' || v.kind === 'partial') return v
    // Salesforce 는 [{ errorCode }] 로 이유를 준다 (INVALID_TYPE: 이 조직에 없는 객체)
    const sfCode = Array.isArray(res.body) && typeof (res.body as any)[0]?.errorCode === 'string' ? `sf_${(res.body as any)[0].errorCode}` : null
    const cause = sfCode ? null : errorCause(res.body)
    return { kind: 'partial', code: sfCode ?? (cause ? `${v.code}:${cause}` : v.code) }
  }
}

/**
 * 응답 본문이 주는 오류 원인 코드. HTTP 코드만으로는 기능 없음, API 꺼짐, scope 미위임을 가를 수 없다.
 * Okta errorCode(E0000015: 기능 없음), Google error.details[].reason(SERVICE_DISABLED, ACCESS_TOKEN_SCOPE_INSUFFICIENT) 또는 error.errors[].reason(notACalendarUser)
 */
export function errorCause(body: unknown): string | null {
  const b = body as any
  if (typeof b?.errorCode === 'string' && /^E\d+$/.test(b.errorCode)) return `okta_${b.errorCode}`
  const g = b?.error
  if (g && typeof g === 'object') {
    const reason = (Array.isArray(g.details) ? g.details.find((d: any) => typeof d?.reason === 'string')?.reason : undefined) ?? (Array.isArray(g.errors) ? g.errors.find((e: any) => typeof e?.reason === 'string')?.reason : undefined)
    if (typeof reason === 'string' && /^\w+$/.test(reason)) return `gws_${reason}`
  }
  return null
}

const gwsAllowed = (ctx: ProviderContext) => new Set([
  ...Object.values(GWS_COLLECT_SCOPES).map(s => s.replace('https://www.googleapis.com/auth/', '')).filter(s => !GATED_GWS.has(s)),
  ...(ctx.config.gws?.grantedScopes ?? []),
])

function configValue(ctx: ProviderContext, key: string): string | undefined {
  let cur: any = ctx.config
  for (const k of key.split('.')) cur = cur?.[k]
  return typeof cur === 'string' && cur ? cur : undefined
}

function itemsOf(selector: string): (body: any) => any[] {
  if (selector === '*') return b => (Array.isArray(b) ? b : [])
  return b => {
    let cur = b
    for (const k of selector.split('.')) cur = cur?.[k]
    return Array.isArray(cur) ? cur : []
  }
}

/** 부모 목록이 수집 API 목록 호출이면 그 호출이 먼저 돌게 줄을 세운다 (부모가 없거나 손코드면 깊이 0) */
export function orderByParent(entries: ApiListEntry[]): ApiListEntry[] {
  const byId = new Map(entries.map(e => [e.id, e]))
  const depth = new Map<string, number>()
  const depthOf = (e: ApiListEntry, seen = new Set<string>()): number => {
    if (depth.has(e.id)) return depth.get(e.id)!
    const parent = e.params?.fanout ? byId.get(e.params.fanout.from.call) : undefined
    const d = parent && !seen.has(parent.id) ? depthOf(parent, new Set([...seen, e.id])) + 1 : 0
    depth.set(e.id, d)
    return d
  }
  return entries.map((e, i) => ({ e, i, d: depthOf(e) })).sort((a, b) => a.d - b.d || a.i - b.i).map(x => x.e)
}

export function apiListCalls(ctx: ProviderContext, entries: ApiListEntry[] = loadApiList()): CallDef[] {
  const { config, creds, transport } = ctx
  const authCache = new Map<string, Auth>()
  let dwd: ((subject: string, scopes: string[]) => Auth) | null = null
  const strikes = new Map<string, { n: number }>()
  const strikesOf = (p: string) => strikes.get(p) ?? strikes.set(p, { n: 0 }).get(p)!
  /** 조직의 sObject 이름(소문자) → 조회 가능 여부. SF_OBJECTS_CALL 이 받기 전이나 받지 못했으면 null 이고 거르지 않는다 */
  let sfObjects: Map<string, boolean> | null = null

  const host = (spec: SourceSpec): string | null => {
    if (spec.base) return spec.base
    const raw = spec.hostFrom ? creds.get(spec.hostFrom.credential) : undefined
    if (!raw) return null
    const norm = spec.auth === 'okta' ? normalizeOktaOrgUrl(raw) : spec.auth === 'salesforce' ? normalizeSalesforceUrl(raw) : spec.auth === 'atlassian' ? normalizeAtlassianSiteUrl(raw) : raw
    return norm + (spec.hostFrom?.suffix ?? '')
  }

  const authFor = (spec: SourceSpec, entry: ApiListEntry, subject?: string): Auth => {
    switch (spec.auth) {
      case 'github_app':
        // 엔터프라이즈 API 는 조직에 설치한 App 토큰으로 부를 수 없다(403). 엔터프라이즈 소유자 토큰이 있으면 그것으로 부른다 (github.ts 손코드와 같은 규칙)
        if (entry.path_template.startsWith('/enterprises/') && creds.get('GITHUB_OWNER_TOKEN')) return bearerAuth('CRED-GH-02', creds.get('GITHUB_OWNER_TOKEN')!)
        return authCache.get('gh') ?? authCache.set('gh', githubAppAuth({ ref: 'CRED-GH-01', appId: creds.get('GITHUB_APP_ID')!, installationId: creds.get('GITHUB_APP_INSTALLATION_ID')!, privateKeyPem: creds.get('GITHUB_APP_PRIVATE_KEY')!, transport })).get('gh')!
      case 'okta':
        return authCache.get('okta') ?? authCache.set('okta', oktaAuth(ctx)).get('okta')!
      case 'gws':
        dwd ??= googleDwdAuthFactory({ ref: 'CRED-GW-01', key: JSON.parse(creds.get('GWS_COLLECTOR_SA_KEY')!) as GoogleKey, transport })
        return dwd(subject ?? config.gws.adminSubject, entry.scopes.required.map(s => `https://www.googleapis.com/auth/${s}`))
      case 'slack_org':
        if (entry.params?.token === 'slack_bot') return bearerAuth('CRED-SL-02', creds.get('SLACK_COLLECTOR_BOT_TOKEN')!)
        return bearerAuth('CRED-SL-01', creds.get('SLACK_COLLECTOR_USER_TOKEN')!)
      case 'salesforce':
        return authCache.get('sf') ?? authCache.set('sf', salesforceAuth(ctx)).get('sf')!
      case 'atlassian':
        return authCache.get('at') ?? authCache.set('at', atlassianBasicAuth('CRED-AT-01', creds.get('ATLASSIAN_COLLECTOR_EMAIL')!, creds.get('ATLASSIAN_COLLECTOR_API_TOKEN')!)).get('at')!
      case 'atlassian_org':
        return bearerAuth('CRED-AT-ORG-01', creds.get('ATLASSIAN_COLLECTOR_ORG_API_KEY')!)
    }
  }

  const approved = orderByParent(entries.filter(e => e.status === 'approved' && SOURCES[e.source] && !SOURCES[e.source].blocked))
  const sfSpec = approved.map(e => SOURCES[e.source]).find(s => s.provider === 'salesforce')
  const describe: CallDef[] = sfSpec ? [{
    id: SF_OBJECTS_CALL,
    provider: 'salesforce',
    title: '조직 sObject 목록 (describeGlobal, Salesforce 수집 API 목록 거르기)',
    credential: sfSpec.credential,
    unavailable: () => missingCredential(creds, sfSpec.credential) ?? (!config.salesforce ? 'config_missing:salesforce' : !host(sfSpec) ? `host_not_configured:${sfSpec.hostFrom?.credential}` : null),
    async run(api) {
      sfObjects = null
      const url = buildUrl(`${host(sfSpec)}/services/data/v${config.salesforce?.apiVersion ?? '61.0'}/sobjects`, {})
      if (!trustedHost('salesforce', new URL(url).hostname)) throw new Error(`허용하지 않은 호스트: ${new URL(url).hostname}`)
      const body = await api.get<ReturnType<typeof summarizeSObjects>>({ url, auth: authFor(sfSpec, approved.find(e => SOURCES[e.source] === sfSpec)!), classify: soften(httpClassifier, () => ({ ok: 0, auth: 0, gate: 0 })), transform: summarizeSObjects })
      if (body?.sobjects.length) sfObjects = new Map(body.sobjects.map(o => [o.name.toLowerCase(), o.queryable]))
      else api.partial('sobjects_empty')
    },
  }] : []

  return [...describe, ...approved.map(entry => {
    const spec = SOURCES[entry.source]
    const fanout = entry.params?.fanout
    const consts = Object.entries(entry.params?.resolutions ?? {}).filter(([, r]) => r.kind !== 'fanout')
    const isGetOne = entry.items === '' || entry.kind === 'read_one'
    let seen: CallSeen = { ok: 0, auth: 0, gate: 0 }
    const classify = soften(spec.provider === 'slack' ? slackClassifier : spec.provider === 'gws' ? gwsClassifier : httpClassifier, () => seen)

    const unavailable = (): string | null => {
      const missing = missingCredential(creds, entry.params?.token === 'slack_bot' ? 'CRED-SL-02' : spec.credential)
      if (missing) return missing
      if (strikesOf(spec.provider).n >= AUTH_STRIKE_LIMIT) return `auth_failures:${AUTH_STRIKE_LIMIT}`
      if (!host(spec)) return `host_not_configured:${spec.hostFrom?.credential ?? entry.source}`
      for (const [name, r] of [...consts, ...Object.entries(entry.params?.query ?? {})]) if (r.kind === 'const' && !configValue(ctx, r.config)) return `config_missing:${r.config} (${name})`
      if (spec.provider === 'okta' && entry.scopes.basis === 'inventory_document' && !creds.get('OKTA_API_TOKEN')) {
        const activeScopes = oktaGrantedScopes(ctx)
        const notGranted = entry.scopes.required.filter(s => !activeScopes.includes(s))
        // 문서가 대안 scope 여럿을 나열하는 경우가 있어 하나라도 있으면 시도한다
        if (notGranted.length === entry.scopes.required.length && notGranted.length) return `scope_not_granted:${notGranted.join(',')}`
      }
      if (spec.auth === 'gws') {
        const allowed = gwsAllowed(ctx)
        const missingScope = entry.scopes.required.filter(s => !allowed.has(s))
        if (missingScope.length) return `scope_not_granted:${missingScope.join(',')}`
      }
      if (spec.provider === 'salesforce' && !config.salesforce) return 'config_missing:salesforce'
      if (spec.provider === 'atlassian' && !config.atlassian) return 'config_missing:atlassian'
      const sfObject = spec.provider === 'salesforce' ? entry.request.soql_object : undefined
      if (sfObjects && typeof sfObject === 'string') {
        // SOQL 객체 이름은 대소문자를 가리지 않는다 (예: SiteIframeWhiteListUrl 과 SiteIframeWhitelistUrl)
        const queryable = sfObjects.get(sfObject.toLowerCase())
        if (queryable === undefined) return `object_not_in_org:${sfObject}`
        if (!queryable) return `object_not_queryable:${sfObject}`
      }
      return null
    }

    // 경로 밖 필수 인자 (params.ts QUERY_PARAMS). const 값은 unavailable 이 미리 확인했다
    const fixedQuery: Record<string, string> = Object.fromEntries(Object.entries(entry.params?.query ?? {}).map(([name, r]) => [name, r.kind === 'literal' ? r.value : r.kind === 'const' ? configValue(ctx, r.config) ?? '' : '']))

    const urlFor = (values: Record<string, string>): string => {
      const base = host(spec)!
      let url: string
      if (spec.provider === 'salesforce') {
        const version = config.salesforce?.apiVersion ?? '61.0'
        const where = entry.params?.soql_where ? ` WHERE ${entry.params.soql_where}` : ''
        url = buildUrl(`${base}/services/data/v${version}/query`, { q: `SELECT FIELDS(STANDARD) FROM ${entry.request.soql_object}${where}` })
      } else if (entry.surface === 'rpc') {
        url = buildUrl(`${base}/${entry.path_template}`, { ...(isGetOne ? {} : { limit: 200 }), ...fixedQuery })
      } else {
        const filled = entry.path_template.replace(/\{([^}]+)\}/g, (_, name: string) => {
          const v = values[name]
          if (v === undefined) throw new Error(`경로 변수 값 없음: ${name}`)
          return encodeURIComponent(v)
        })
        const query: Record<string, string | number> = { ...fixedQuery }
        if (!isGetOne) {
          if (spec.provider === 'github') query.per_page = 100
          if (spec.provider === 'okta') query.limit = 200
          if (spec.paginate.kind === 'offset') { query.startAt = 0; query.maxResults = spec.paginate.pageSize }
          if (spec.paginate.kind === 'confluence') query.limit = 250
        }
        url = buildUrl(base.replace(/\/$/, '') + filled, query)
      }
      if (!trustedHost(spec.provider, new URL(url).hostname)) throw new Error(`허용하지 않은 호스트: ${new URL(url).hostname}`)
      return url
    }

    const fetchOne = async (api: CallApi, values: Record<string, string>, extraParams: Record<string, unknown>) => {
      // Gmail, Calendar 은 그 사용자로 위임해야 읽힌다
      const subject = spec.auth === 'gws' && ['gws_gmail', 'gws_calendar'].includes(entry.source) ? values.userId ?? values.userKey ?? values.calendarId : undefined
      const opts = {
        url: urlFor(values),
        auth: authFor(spec, entry, subject),
        classify,
        params: { ...entry.request, ...(entry.surface === 'rpc' ? { method: entry.path_template } : {}), ...extraParams },
        operation: { id: entry.operation_id, path_template: entry.path_template, registry_id: entry.id },
      }
      if (isGetOne) await api.get(opts)
      else await api.list({ ...opts, paginate: spec.paginate, items: itemsOf(entry.items), maxPages: 50 })
    }

    const call: CallDef = {
      id: entry.id,
      provider: spec.provider,
      title: `${entry.operation_id.split(':').slice(2).join(':')} (수집 API 목록)`,
      credential: spec.credential,
      unavailable,
      async run(api) {
        seen = { ok: 0, auth: 0, gate: 0 }
        try {
          const values: Record<string, string> = {}
          for (const [name, r] of consts) values[name] = r.kind === 'literal' ? r.value : r.kind === 'const' ? configValue(ctx, r.config)! : ''
          if (!fanout) return await fetchOne(api, values, {})
          // 묶음 하나 = 이 경로의 fanout 변수 전부 (마지막은 부모 항목, 앞은 부모 요청 값)
          const parents = fanoutTuples(api.collected(spec.provider, fanout.from.call), fanout.from, fanout.param)
          if (!parents.length) { api.partial(`no_parent_values:${fanout.from.call}`); return }
          if (parents.length > FANOUT_LIMIT) api.partial(`fanout_limit:${FANOUT_LIMIT}`)
          for (const tuple of parents.slice(0, FANOUT_LIMIT)) {
            // 성공 없이 인증 오류만 이어지면 이 operation 이 게이트에 막힌 것이다. 남은 부모를 부르지 않는다
            if (!seen.ok && seen.auth + seen.gate >= AUTH_STRIKE_LIMIT) { api.partial(`auth_failures:${AUTH_STRIKE_LIMIT}`); return }
            // 요청 값에 묶음 전부를 남긴다. 이 호출을 부모로 쓰는 자식이 앞 변수를 여기서 이어받는다
            await fetchOne(api, { ...values, ...tuple }, tuple)
          }
        } finally {
          const strikes = strikesOf(spec.provider)
          if (seen.ok) strikes.n = 0
          else if (seen.auth) strikes.n++
        }
      },
    }
    return call
  })]
}
