/**
 * Google Cloud 수집 (GCP-01 ~ GCP-06): Gemini Enterprise(Discovery Engine)와 그 접근을 정하는 신원·권한 객체.
 *
 * 범위는 Gemini Enterprise 객체에서 출발해 닿는 것까지다. Compute·Storage 같은 일반 자원은 받지 않는다.
 * 원본을 읽는 Profile 은 profile-binding/overlays/gcp/ 에 있고, 호출 ID 와 params(kind, parent, resource, project)는 그 Profile 과 맞춘 것이다.
 *
 * 자격증명: CRED-GCP-01. 사람이 동의한 OAuth 갱신 토큰(범위 cloud-platform)이다. IAM·Discovery Engine·Agent Identity 는
 * 읽기 전용 범위를 받지 않아 cloud-platform 을 쓴다. 읽기만 하도록 막는 것은 그 계정에 준 IAM 역할과 HTTP 계층의 GET 강제다.
 *
 * - 식별자는 설정이 아니라 응답에서 가져온다. 설정의 project 로 projects.get 을 부르고 그 뒤로는 응답의 name(projects/<번호>)을 쓴다.
 * - IAM 명단은 Cloud Asset effectiveIamPolicies 로 받는다(GET). 프로젝트 명단과 위에서 내려오는 폴더·조직 명단이 한 번에 온다.
 *   프로젝트·조직의 getIamPolicy 는 POST 라 쓰지 않는다. 앱(engine)의 getIamPolicy 는 GET 이다.
 * - 비밀값과 본문은 저장 전에 버린다(DROP). 대화·문서·기억 본문은 개수나 메타데이터만 남는다.
 * - 열거할 수 없는 것: A2A 작업 알림 설정(작업 목록 API 없음), 사람별 커넥터 동의(감사 로그 조회가 POST 뿐),
 *   남의 노트북(listRecentlyViewed 는 호출한 계정이 최근 본 것만 준다). 각 호출 notes 에 적는다.
 * - Discovery Engine 은 Discovery 문서에 호스트가 있는 위치(global, us)만 받는다. 다른 위치의 호스트 규칙은 확인하지 않았다.
 */
import { CallError, type CallApi, type CallDef, buildUrl } from '../lib/runner'
import { googleDwdAuthFactory, oauthRefreshTokenAuth, type GoogleKey } from '../lib/auth'
import type { Auth } from '../lib/http'
import { missingCredential } from '../config'
import type { ProviderContext } from './common'

const CRM = 'https://cloudresourcemanager.googleapis.com/v3'
const ASSET = 'https://cloudasset.googleapis.com/v1'
const IAM = 'https://iam.googleapis.com/v1'
const DE = 'https://discoveryengine.googleapis.com/v1alpha'
/** Discovery Engine 위치별 호스트. Discovery 문서(v1alpha, revision 20261111)의 rootUrl 과 endpoints 에 있는 위치만 둔다. 여기 없는 위치는 받지 않는다 */
const DE_BY_LOCATION: Record<string, string> = { global: DE, us: 'https://discoveryengine.us.rep.googleapis.com/v1alpha' }
const AR = 'https://agentregistry.googleapis.com/v1'
const AID = 'https://agentidentity.googleapis.com/v1'
/** Agent Platform 은 지역 호스트를 쓴다 (Discovery 문서 endpoints: https://<region>-aiplatform.googleapis.com/) */
const aiplatform = (region: string) => `https://${region}-aiplatform.googleapis.com/v1`
const CRM_FULL = '//cloudresourcemanager.googleapis.com/'

export const GCP_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
/** fan-out 부모 수 상한. 넘으면 앞에서 자르고 partial(fanout_limit) */
export const GCP_FANOUT_LIMIT = 200
/** 양이 많을 수 있는 목록(세션·문서·기억)의 페이지 상한. 넘으면 partial(max_pages) */
export const GCP_MAX_PAGES = 5
const LOGGING_URL = 'https://logging.googleapis.com/v2/entries:list'
const GCP_LOG_MAX_PAGES = 20
/** Cloud Logging 은 항목이 늦게 들어올 수 있다. 커서보다 이만큼 앞부터 다시 읽고, 겹친 항목은 전송 장부가 거른다 */
const GCP_LOG_LOOKBACK_MS = 15 * 60_000

export function geminiLogStart(lastEventAt: string | null | undefined, since: string): string {
  const ms = lastEventAt ? Date.parse(lastEventAt) : NaN
  return Number.isFinite(ms) ? new Date(ms - GCP_LOG_LOOKBACK_MS).toISOString() : since
}

const GEMINI_LOG_FILTER =
  '(logName:("gemini_enterprise_user_activity" OR "connector_activity" OR "gen_ai.client.inference.operation.details") OR ' +
  '(logName:"cloudaudit.googleapis.com%2Factivity" AND protoPayload.serviceName="discoveryengine.googleapis.com") OR ' +
  '(logName:"cloudaudit.googleapis.com%2Fdata_access" AND protoPayload.serviceName="discoveryengine.googleapis.com" AND ' +
  '(protoPayload.methodName:".StreamAssist" OR protoPayload.methodName:".Search" OR protoPayload.methodName:".AcquireAccessToken" OR protoPayload.methodName:".AcquireAndStoreRefreshToken")))'

const isRec = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const pickKeys = (src: unknown, keys: string[]): Record<string, unknown> | undefined => {
  if (!isRec(src)) return undefined
  const out: Record<string, unknown> = {}
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k]
  return Object.keys(out).length ? out : undefined
}
const readDotted = (src: Record<string, any>, dotted: string): unknown => {
  if (src[dotted] !== undefined) return src[dotted]
  let cur: any = src
  for (const part of dotted.split('.')) {
    if (!isRec(cur)) return undefined
    cur = cur[part]
  }
  return cur
}
const setIf = (out: Record<string, unknown>, key: string, val: unknown) => {
  if (val !== undefined) out[key] = val
}

/** Cloud Logging 항목에서 허용 칸만 남긴다. 프롬프트·답변·검색어·문서 이름·인자·status.message 등은 버린다 */
export function sanitizeLoggingEntry(entry: unknown): Record<string, unknown> | unknown {
  if (!isRec(entry)) return entry
  const out: Record<string, unknown> = {}
  for (const k of ['insertId', 'timestamp', 'receiveTimestamp', 'logName', 'severity', 'trace']) {
    if (entry[k] !== undefined) out[k] = entry[k]
  }
  if (isRec(entry.resource)) {
    const res = pickKeys(entry.resource, ['type', 'labels'])
    if (res) out.resource = res
  }
  if (isRec(entry.labels)) {
    const evName = readDotted(entry.labels, 'event.name')
    if (evName !== undefined) out.labels = { 'event.name': evName }
  }
  if (isRec(entry.protoPayload)) {
    const pp = entry.protoPayload
    const pOut: Record<string, unknown> = {}
    for (const k of ['serviceName', 'methodName', 'resourceName']) setIf(pOut, k, pp[k])
    if (isRec(pp.status) && pp.status.code !== undefined) pOut.status = { code: pp.status.code }
    if (isRec(pp.authenticationInfo)) {
      const ai: Record<string, unknown> = {}
      setIf(ai, 'principalEmail', pp.authenticationInfo.principalEmail)
      const oauth = pickKeys(pp.authenticationInfo.oauthInfo, ['oauthClientId'])
      if (oauth) ai.oauthInfo = oauth
      if (Object.keys(ai).length) pOut.authenticationInfo = ai
    }
    setIf(pOut, 'requestMetadata', pickKeys(pp.requestMetadata, ['callerIp']))
    setIf(pOut, 'request', pickKeys(pp.request, ['@type', 'name', 'parent', 'resource']))
    setIf(pOut, 'response', pickKeys(pp.response, ['name']))
    if (Array.isArray(pp.authorizationInfo)) {
      pOut.authorizationInfo = pp.authorizationInfo.map((a: unknown) => pickKeys(a, ['permission', 'granted', 'resource']) ?? {})
    }
    if (isRec(pp.serviceData) && isRec(pp.serviceData.policyDelta) && Array.isArray(pp.serviceData.policyDelta.bindingDeltas)) {
      pOut.serviceData = {
        policyDelta: {
          bindingDeltas: pp.serviceData.policyDelta.bindingDeltas.map((d: unknown) => pickKeys(d, ['action', 'role', 'member']) ?? {}),
        },
      }
    }
    if (Object.keys(pOut).length) out.protoPayload = pOut
  }
  if (isRec(entry.jsonPayload)) {
    const jp = entry.jsonPayload
    const jOut: Record<string, unknown> = {}
    for (const k of ['assistToken', 'userIamPrincipal']) setIf(jOut, k, jp[k])
    setIf(jOut, 'logMetadata', pickKeys(jp.logMetadata, ['methodName', 'name', 'serviceName', 'timestamp']))
    if (isRec(jp.request)) {
      const rOut: Record<string, unknown> = {}
      setIf(rOut, 'name', jp.request.name)
      setIf(rOut, 'parent', jp.request.parent)
      if (isRec(jp.request.policy) && Array.isArray(jp.request.policy.bindings)) {
        rOut.policy = { bindings: jp.request.policy.bindings.map((b: unknown) => pickKeys(b, ['role', 'members']) ?? {}) }
      }
      setIf(rOut, 'actionExecutionParams', pickKeys(jp.request.actionExecutionParams, ['actionName', 'agentName']))
      if (Object.keys(rOut).length) jOut.request = rOut
    }
    setIf(jOut, 'dataConnectorInfo', pickKeys(jp.dataConnectorInfo, ['agent', 'connectorType', 'tool']))
    for (const dk of ['user.id', 'gen_ai.agent.name', 'gen_ai.conversation.id']) {
      setIf(jOut, dk, readDotted(jp, dk))
    }
    if (Object.keys(jOut).length) out.jsonPayload = jOut
  }
  return out
}

export function sanitizeLoggingResponse(body: any): any {
  if (!isRec(body) || !Array.isArray(body.entries)) return body
  return { ...body, entries: body.entries.map(sanitizeLoggingEntry) }
}

/** 저장 전에 버리는 키: 비밀값, 키 자료, 본문 */
export const GCP_DROP_KEYS = [
  'clientSecret', 'client_secret', 'securityToken', 'privateKeyData', 'publicKeyData', 'auth_key', 'private_key', 'password',
  'refresh_token', 'access_token', 'api_key', 'idpMetadataXml', 'downloadUri', 'lockToken', 'connectionInfo', 'authProviderTypeParams',
  'archiveUploadSource', 'archiveContent', 'icon', 'sessionState', 'structData', 'jsonData', 'derivedStructData', 'extractedMemories',
  'structuredData', 'fact', 'annotationContents', 'dataUrls',
]

/** 본문 배열은 개수만 남긴다 (Profile 이 개수를 센다) */
const emptied = (v: unknown) => (Array.isArray(v) ? v.map(() => ({})) : v)
const keepCounts = (listKey: string, bodyKey: string) => (body: any) =>
  body && Array.isArray(body[listKey]) ? { ...body, [listKey]: body[listKey].map((x: any) => (x && bodyKey in x ? { ...x, [bodyKey]: emptied(x[bodyKey]) } : x)) } : body

/** ReasoningEngine.spec 은 실행 신원 칸만 남긴다 (배포 설정에 환경 변수가 들 수 있다) */
export function reasoningEngineSpec(body: any): any {
  if (!body || !Array.isArray(body.reasoningEngines)) return body
  return {
    ...body,
    reasoningEngines: body.reasoningEngines.map((r: any) => (r?.spec && typeof r.spec === 'object'
      ? { ...r, spec: { identityType: r.spec.identityType, serviceAccount: r.spec.serviceAccount, effectiveIdentity: r.spec.effectiveIdentity, agentFramework: r.spec.agentFramework } }
      : r)),
  }
}

/**
 * effectiveIamPolicies 응답을 바인딩 목록으로 편다. 층마다 어느 자원에 붙은 명단인지(attached_resource)와
 * 위에서 내려온 것인지(inherited)를 바인딩에 단다. 프로젝트의 조상은 폴더·조직뿐이라 projects/ 가 아니면 내려온 것이다.
 */
export function flattenEffectivePolicies(body: any, project: string): any {
  const bindings: any[] = []
  for (const result of body?.policyResults ?? []) {
    for (const info of result?.policies ?? []) {
      const attached = String(info?.attachedResource ?? '').replace(CRM_FULL, '')
      for (const b of info?.policy?.bindings ?? []) bindings.push({ ...b, attached_resource: attached, inherited: !attached.startsWith('projects/') })
    }
  }
  return { project, bindings }
}

/**
 * 에이전트 정의 본문(지시문·흐름·아이콘)은 남기지 않는다. 정의가 있었다는 것과 workflow 의 owner 만 남긴다.
 * workflowAgentDefinition·lowCodeAgentDefinition 은 v1alpha Discovery 문서에 없고 실제 응답에만 있었다(2026-11-19).
 */
export function agentDefinitions(body: any): any {
  if (!body || !Array.isArray(body.agents)) return body
  return { ...body, agents: body.agents.map((a: any) => {
    if (!a || typeof a !== 'object') return a
    const out = { ...a }
    for (const k of ['managedAgentDefinition', 'lowCodeAgentDefinition']) if (k in out) out[k] = { omitted: true }
    if ('workflowAgentDefinition' in out) out.workflowAgentDefinition = { omitted: true, owner: a.workflowAgentDefinition?.owner }
    return out
  }) }
}

interface Project { name: string; projectId: string; parent?: string }
interface Sub { kind: string; path: string; items: string; drop?: string[]; maxPages?: number; transform?: (body: any) => any; query?: Record<string, string>; /** 기능이 꺼진 저장소·앱은 400 으로 거절한다. 그 400 은 부분 실패로 세지 않고 기록만 남긴다 */ featureGated?: boolean }

/**
 * CRED-GCP-01 인증. 서비스 계정 키(GCP_COLLECTOR_SA_KEY)가 있으면 그 계정 자신으로 JWT 를 교환한다.
 * 없으면 사람이 동의한 갱신 토큰을 쓴다. 갱신 토큰은 조직의 Google Cloud 재인증 정책에 걸리면 invalid_rapt 로 거절된다(2026-11-26)
 */
export function gcpAuthFor(ctx: ProviderContext): Auth {
  const { creds, transport } = ctx
  const sa = creds.get('GCP_COLLECTOR_SA_KEY')
  if (sa) {
    const key = JSON.parse(sa) as GoogleKey
    return googleDwdAuthFactory({ ref: 'CRED-GCP-01', key, transport })(key.client_email, [GCP_SCOPE])
  }
  return oauthRefreshTokenAuth({
    ref: 'CRED-GCP-01',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: creds.require('GCP_COLLECTOR_CLIENT_ID'),
    clientSecret: creds.get('GCP_COLLECTOR_CLIENT_SECRET'),
    refreshToken: creds.require('GCP_COLLECTOR_REFRESH_TOKEN'),
    transport,
    onRotate: ({ refreshToken }) => creds.set('GCP_COLLECTOR_REFRESH_TOKEN', refreshToken),
  })
}

export function gcpCalls(ctx: ProviderContext): CallDef[] {
  const { config, creds } = ctx
  const g = config.gcp
  let cached: Auth | null = null
  const auth = (): Auth => (cached ??= gcpAuthFor(ctx))

  const state = {
    projects: [] as Project[],
    projectsDone: false,
    organizations: new Set<string>(),
    roles: new Set<string>(),
    reasoningEngines: new Set<string>(),
  }
  const rules = (extra: string[] = []) => ({ dropKeys: [...GCP_DROP_KEYS, ...extra] })
  const limited = <T,>(api: CallApi, label: string, list: T[]): T[] => {
    if (list.length <= GCP_FANOUT_LIMIT) return list
    api.partial(`fanout_limit:${label}`)
    return list.slice(0, GCP_FANOUT_LIMIT)
  }
  const noteRoles = (bindings: any[] | undefined) => { for (const b of bindings ?? []) if (typeof b?.role === 'string') state.roles.add(b.role) }

  /** parent 아래 목록 하나. 403·API 오류는 그 목록만 partial 로 남긴다 */
  const sub = async (api: CallApi, base: string, parent: string, s: Sub): Promise<any[]> =>
    (await api.optional(s.kind, () => (s.featureGated ? gated(api, s.kind) : (p: Promise<any[]>) => p)(api.list({
      url: buildUrl(`${base}/${parent}/${s.path}`, s.query),
      auth: auth(),
      params: { kind: s.kind, parent },
      paginate: { kind: 'google' },
      items: body => body?.[s.items] ?? [],
      rules: rules(s.drop),
      maxPages: s.maxPages,
      transform: s.transform,
    })))) ?? []
  /** 400 이면 "이 대상에는 없는 기능"으로 보고 빈 목록을 돌려준다 */
  const gated = (api: CallApi, kind: string) => (p: Promise<any[]>): Promise<any[]> => p.catch(err => {
    if (!(err instanceof CallError) || err.code !== 'http_400') throw err
    api.note(`${kind} 없음(400): ${err.message}`)
    return []
  })
  /** 이름으로 하나. 없으면(404) null */
  const one = (api: CallApi, base: string, name: string, kind: string, extra: { drop?: string[]; transform?: (body: any) => any; params?: Record<string, unknown>; query?: Record<string, string> } = {}) =>
    api.optional(kind, () => api.get({ url: buildUrl(`${base}/${name}`, extra.query), auth: auth(), params: { kind, ...(extra.params ?? {}) }, rules: rules(extra.drop), transform: extra.transform }))

  const call = (id: string, title: string, run: (api: CallApi) => Promise<void>): CallDef => ({
    id,
    provider: 'gcp',
    title,
    credential: 'CRED-GCP-01',
    unavailable: () =>
      missingCredential(creds, 'CRED-GCP-01') ??
      (id === 'GCP-07'
        ? (g?.projects?.length ? null : 'config_missing:gcp.projects')
        : ((g?.projects?.length || g?.discoverProjects ? null : 'config_missing:gcp.projects') ?? (id !== 'GCP-01' && !state.projectsDone ? 'dependency:GCP-01' : null))),
    run,
  })

  /** 프로젝트의 조상을 따라 올라가 조직을 찾는다 (폴더는 folders.get 으로 부모를 본다) */
  async function organizationOf(api: CallApi, project: Project): Promise<string | null> {
    let parent = project.parent
    for (let depth = 0; parent && depth < 10; depth++) {
      if (parent.startsWith('organizations/')) return parent
      if (!parent.startsWith('folders/')) return null
      const folder: any = await one(api, CRM, parent, 'folder')
      parent = folder?.parent
    }
    return null
  }

  return [
    call('GCP-01', '프로젝트와 IAM 명단', async api => {
      let ids = g!.projects ?? []
      if (!ids.length) {
        // 설정에 프로젝트를 적지 않고 discoverProjects 를 켰으면, 호출 계정이 볼 수 있는 활성 프로젝트를 찾는다 (projects.search, GET)
        const found: any[] = await api.list({ url: `${CRM}/projects:search`, auth: auth(), params: { kind: 'projects_search' }, paginate: { kind: 'google' }, items: body => body?.projects ?? [] })
        ids = limited(api, 'projects', found.filter(p => p?.state === 'ACTIVE' && typeof p?.projectId === 'string').map(p => p.projectId).sort())
        if (!ids.length) api.note('호출 계정이 볼 수 있는 활성 프로젝트가 없다')
      }
      for (const id of ids) {
        const body: any = await api.get({ url: `${CRM}/projects/${encodeURIComponent(id)}`, auth: auth(), params: { kind: 'project' } })
        if (!body?.name) continue
        const project: Project = { name: body.name, projectId: body.projectId, parent: body.parent }
        state.projects.push(project)
        const org = await organizationOf(api, project)
        if (org) state.organizations.add(org)
        else api.note(`조직을 찾지 못했다: ${project.name} 의 IAM 명단은 프로젝트 범위로만 받는다`)
        // 범위가 조직이어야 조직·폴더에서 내려오는 명단까지 온다. 조직이 없으면 프로젝트 범위로 받는다
        const effectiveAt = (scope: string): Promise<any> => api.optional('effective_iam', () => api.get({
          // names 는 프로젝트 ID 로 적는다. 프로젝트 번호로 적으면 404 다(2026-11-19 실제 호출로 확인)
          url: buildUrl(`${ASSET}/${scope}/effectiveIamPolicies:batchGet`, { names: `${CRM_FULL}projects/${project.projectId}` }),
          auth: auth(),
          params: { kind: 'effective_iam', project: project.name, scope },
          transform: b => flattenEffectivePolicies(b, project.name),
        }))
        let effective: any = await effectiveAt(org ?? project.name)
        // 조직 범위를 읽을 권한이 없는 계정이면 프로젝트 범위로 다시 받는다. 조직·폴더에서 내려오는 명단은 빠지므로 partial 은 그대로 남는다
        if (!effective && org) {
          api.note(`조직 범위 IAM 명단을 받지 못해 프로젝트 범위로 받는다: ${project.name}`)
          effective = await effectiveAt(project.name)
        }
        // 404 는 오류로 올라오지 않는다. 명단이 없으면 IAM 관계가 통째로 빠지므로 부분 실패로 남긴다
        if (!effective) api.partial(`effective_iam:missing:${project.projectId}`)
        noteRoles(effective?.bindings)
      }
      state.projectsDone = state.projects.length > 0
    }),

    call('GCP-03', 'Gemini Enterprise (Discovery Engine)', async api => {
      const locations = g!.discoveryLocations ?? ['global']
      for (const l of locations.filter(l => !DE_BY_LOCATION[l])) api.note(`위치 ${l} 는 받지 않는다: Discovery 문서에 그 위치의 호스트가 없다`)
      api.note('A2A 작업 알림 설정은 받지 않는다: 작업을 나열하는 API 가 없다')
      api.note('사람별 커넥터 동의는 받지 않는다: 감사 로그 조회(entries.list)가 POST 뿐이다')
      api.note('노트북은 호출한 계정이 최근 본 것만 온다(listRecentlyViewed)')
      for (const project of state.projects) for (const location of locations.filter(l => DE_BY_LOCATION[l])) {
        // 이 위치의 호스트. 아래 호출은 모두 이 호스트로 간다
        const DE = DE_BY_LOCATION[location]
        const loc = `${project.name}/locations/${location}`
        // 위치 바로 아래
        await one(api, DE, `${loc}/aclConfig`, 'acl_config')
        const store: any = await one(api, DE, `${loc}/userStores/default_user_store`, 'user_store')
        if (store?.name) await sub(api, DE, store.name, { kind: 'user_licenses', path: 'userLicenses', items: 'userLicenses' })
        const licenses = await sub(api, DE, loc, { kind: 'license_configs', path: 'licenseConfigs', items: 'licenseConfigs' })
        for (const name of limited(api, 'billing_account_license_configs', [...new Set(licenses.map(l => l?.billingAccountLicenseConfig).filter(Boolean))] as string[])) {
          await one(api, DE, name, 'billing_account_license_configs', { transform: b => ({ billingAccountLicenseConfigs: [b] }) })
        }
        await sub(api, DE, loc, { kind: 'authorizations', path: 'authorizations', items: 'authorizations' })
        await sub(api, DE, loc, { kind: 'identity_mapping_stores', path: 'identityMappingStores', items: 'identityMappingStores' })
        await sub(api, DE, loc, { kind: 'cmek_configs', path: 'cmekConfigs', items: 'cmekConfigs' })
        for (const set of limited(api, 'sample_query_sets', await sub(api, DE, loc, { kind: 'sample_query_sets', path: 'sampleQuerySets', items: 'sampleQuerySets' }))) {
          await sub(api, DE, set.name, { kind: 'sample_queries', path: 'sampleQueries', items: 'sampleQueries', maxPages: GCP_MAX_PAGES })
        }
        for (const nb of limited(api, 'notebooks', await sub(api, DE, loc, { kind: 'notebooks', path: 'notebooks:listRecentlyViewed', items: 'notebooks' }))) {
          await one(api, DE, nb.name, 'notebook_sources')
        }

        // 컬렉션은 객체로 두지 않는다. 그 아래의 커넥터·앱·저장소만 받는다
        const collections = await sub(api, DE, loc, { kind: 'collections', path: 'collections', items: 'collections' })
        const names = [...new Set([`${loc}/collections/default_collection`, ...collections.map(c => c?.name).filter(Boolean)])] as string[]
        for (const collection of limited(api, 'collections', names)) {
          await one(api, DE, `${collection}/dataConnector`, 'data_connector')
          const sessionSubs = async (parent: string) => {
            const sessions = await sub(api, DE, parent, // 세션 표시 이름은 실제 응답에서 띄어쓰기가 있는 문장이었다(2026-11-19). 대화 내용으로 보고 남기지 않는다
            { kind: 'sessions', path: 'sessions', items: 'sessions', maxPages: GCP_MAX_PAGES, transform: keepCounts('sessions', 'turns'), drop: ['displayName'] })
            await sub(api, DE, parent, { kind: 'conversations', path: 'conversations', items: 'conversations', maxPages: GCP_MAX_PAGES, transform: keepCounts('conversations', 'messages'), featureGated: true })
            return sessions
          }
          const shared = async (parent: string) => {
            await sub(api, DE, parent, { kind: 'controls', path: 'controls', items: 'controls' })
            await sub(api, DE, parent, { kind: 'serving_configs', path: 'servingConfigs', items: 'servingConfigs' })
            await one(api, DE, `${parent}/widgetConfigs/default_search_widget_config`, 'widget_config')
          }

          for (const engine of limited(api, 'engines', await sub(api, DE, collection, { kind: 'engines', path: 'engines', items: 'engines' }))) {
            const policy: any = await one(api, DE, `${engine.name}:getIamPolicy`, 'engine_iam', { params: { resource: engine.name }, query: { 'options.requestedPolicyVersion': '3' } })
            noteRoles(policy?.bindings)
            await shared(engine.name)
            for (const assistant of limited(api, 'assistants', await sub(api, DE, engine.name, { kind: 'assistants', path: 'assistants', items: 'assistants' }))) {
              const agents = await sub(api, DE, assistant.name, { kind: 'agents', path: 'agents', items: 'agents', transform: agentDefinitions })
              for (const a of agents) {
                const re = a?.adkAgentDefinition?.provisionedReasoningEngine?.reasoningEngine
                if (typeof re === 'string') state.reasoningEngines.add(re)
                // 공유 대상은 에이전트 IAM 에 있다(GET, 앱 getIamPolicy 와 같은 꼴). RESTRICTED 는 agentUser 로 준 사람 · 그룹, PRIVATE 는 agentOwner 하나다.
                // ALL_USERS 는 앱 사용자 누구나라 부르지 않는다. 3회차 실측 원본에는 이 호출이 없다(11-19 시험 정책 파일 모양만 봤다)
                const scope = a?.sharingConfig?.scope
                if (typeof a?.name === 'string' && (scope === 'RESTRICTED' || scope === 'PRIVATE')) {
                  const agentPolicy: any = await one(api, DE, `${a.name}:getIamPolicy`, 'agent_iam', { params: { resource: a.name }, query: { 'options.requestedPolicyVersion': '3' } })
                  noteRoles(agentPolicy?.bindings)
                }
              }
              await sub(api, DE, assistant.name, { kind: 'canned_queries', path: 'cannedQueries', items: 'cannedQueries' })
            }
            for (const session of limited(api, 'sessions', await sessionSubs(engine.name))) {
              await sub(api, DE, session.name, { kind: 'session_files', path: 'files', items: 'files' })
              for (const exp of limited(api, 'alpha_evolve_experiments', await sub(api, DE, session.name, { kind: 'alpha_evolve_experiments', path: 'alphaEvolveExperiments', items: 'alphaEvolveExperiments' }))) {
                await sub(api, DE, exp.name, { kind: 'alpha_evolve_programs', path: 'alphaEvolvePrograms', items: 'alphaEvolvePrograms', drop: ['content'], maxPages: GCP_MAX_PAGES })
              }
            }
          }

          for (const ds of limited(api, 'data_stores', await sub(api, DE, collection, { kind: 'data_stores', path: 'dataStores', items: 'dataStores' }))) {
            await shared(ds.name)
            await sessionSubs(ds.name)
            await sub(api, DE, ds.name, { kind: 'schemas', path: 'schemas', items: 'schemas' })
            await sub(api, DE, ds.name, { kind: 'custom_models', path: 'customModels', items: 'models' })
            await sub(api, DE, ds.name, { kind: 'target_sites', path: 'siteSearchEngine/targetSites', items: 'targetSites', maxPages: GCP_MAX_PAGES, featureGated: true })
            for (const branch of limited(api, 'branches', await sub(api, DE, ds.name, { kind: 'branches', path: 'branches', items: 'branches' }))) {
              // 문서 목록은 기본 브랜치(0)에서만 된다. 접근 제어가 걸린 저장소는 400 으로 거절한다. 본문은 버리고, 조각(chunk)은 받지 않는다
              if (!String(branch?.name).endsWith('/branches/0')) continue
              await sub(api, DE, branch.name, { kind: 'documents', path: 'documents', items: 'documents', drop: ['content'], maxPages: GCP_MAX_PAGES, featureGated: true })
            }
          }
        }
      }
      api.note('문서 조각(chunk)은 받지 않는다: 문서마다 호출이 하나씩 늘어난다')
    }),

    call('GCP-04', 'Agent Registry', async api => {
      // agentregistry.googleapis.com /skills 엔드포인트가 리전마다 응답 정체(~250s)되어 일단 수집에서 제외한다
      api.note('skills 건너뜀: agentregistry.googleapis.com /skills 응답 정체로 수집 제외')
      for (const project of state.projects) {
        for (const loc of limited(api, 'locations', await sub(api, AR, project.name, { kind: 'locations', path: 'locations', items: 'locations' }))) {
          for (const s of [
            { kind: 'ai_applications', path: 'aiApplications', items: 'aiApplications' },
            { kind: 'agents', path: 'agents', items: 'agents' },
            { kind: 'mcp_servers', path: 'mcpServers', items: 'mcpServers' },
            { kind: 'services', path: 'services', items: 'services' },
            { kind: 'endpoints', path: 'endpoints', items: 'endpoints' },
            { kind: 'bindings', path: 'bindings', items: 'bindings' },
          ]) await sub(api, AR, loc.name, s)
        }
      }
    }),

    call('GCP-05', 'Agent Identity', async api => {
      for (const project of state.projects) {
        for (const loc of limited(api, 'locations', await sub(api, AID, project.name, { kind: 'locations', path: 'locations', items: 'locations' }))) {
          for (const provider of limited(api, 'auth_providers', await sub(api, AID, loc.name, { kind: 'auth_providers', path: 'authProviders', items: 'authProviders' }))) {
            await sub(api, AID, provider.name, { kind: 'authorizations', path: 'authorizations', items: 'authorizations', maxPages: GCP_MAX_PAGES })
          }
        }
      }
    }),

    call('GCP-06', 'Agent Platform reasoningEngines', async api => {
      for (const project of state.projects) {
        // 지역: 설정에 적은 것과, Gemini Enterprise 에이전트가 가리키는 ReasoningEngine 의 지역
        const regions = new Set<string>(g!.regions ?? [])
        for (const name of state.reasoningEngines) {
          const m = /^projects\/[^/]+\/locations\/([^/]+)\/reasoningEngines\//.exec(name)
          if (m) regions.add(m[1])
        }
        if (!regions.size) api.note('받을 지역이 없다: 설정 gcp.regions 가 비었고 ReasoningEngine 을 가리키는 에이전트도 없다')
        for (const region of [...regions].sort()) {
          const base = aiplatform(region)
          const parent = `${project.name}/locations/${region}`
          for (const re of limited(api, 'reasoning_engines', await sub(api, base, parent, { kind: 'reasoning_engines', path: 'reasoningEngines', items: 'reasoningEngines', transform: reasoningEngineSpec }))) {
            for (const memory of limited(api, 'memories', await sub(api, base, re.name, { kind: 'memories', path: 'memories', items: 'memories', maxPages: GCP_MAX_PAGES }))) {
              await sub(api, base, memory.name, { kind: 'memory_revisions', path: 'revisions', items: 'memoryRevisions', maxPages: 1 })
            }
            await sub(api, base, re.name, { kind: 'sessions', path: 'sessions', items: 'sessions', maxPages: GCP_MAX_PAGES })
            await sub(api, base, re.name, { kind: 'sandbox_environments', path: 'sandboxEnvironments', items: 'sandboxEnvironments', drop: ['spec'] })
            await sub(api, base, re.name, { kind: 'sandbox_environment_snapshots', path: 'sandboxEnvironmentSnapshots', items: 'sandboxEnvironmentSnapshots' })
            await sub(api, base, re.name, { kind: 'sandbox_environment_templates', path: 'sandboxEnvironmentTemplates', items: 'sandboxEnvironmentTemplates' })
          }
        }
      }
    }),

    // IAM 은 마지막에 돈다. 앞 호출의 IAM 명단에 나온 역할만 골라 받기 위해서다(사전 정의 역할 전체는 받지 않는다)
    call('GCP-02', 'IAM: 역할, 서비스 계정, 풀, OAuth 클라이언트', async api => {
      // 사전 정의 역할은 프로젝트와 무관하다. 프로젝트가 여럿이어도 한 번만 받는다
      const have = new Set<string>()
      for (const project of state.projects) {
        const p = `projects/${project.projectId}`
        const custom = await sub(api, IAM, p, { kind: 'roles', path: 'roles', items: 'roles', query: { view: 'FULL' } })
        for (const r of custom) if (typeof r?.name === 'string') have.add(r.name)
        for (const role of limited(api, 'roles', [...state.roles].filter(r => !have.has(r)).sort())) {
          await one(api, IAM, role, 'roles', { transform: b => ({ roles: [b] }) })
          have.add(role)
        }
        for (const sa of limited(api, 'service_accounts', await sub(api, IAM, p, { kind: 'service_accounts', path: 'serviceAccounts', items: 'accounts' }))) {
          // 사용자 관리 키의 메타데이터만. 키 자료는 저장 전에 버린다
          await sub(api, IAM, sa.name, { kind: 'service_account_keys', path: 'keys', items: 'keys', query: { keyTypes: 'USER_MANAGED' } })
        }
        for (const client of limited(api, 'oauth_clients', await sub(api, IAM, `${p}/locations/global`, { kind: 'oauth_clients', path: 'oauthClients', items: 'oauthClients' }))) {
          await sub(api, IAM, client.name, { kind: 'oauth_client_credentials', path: 'credentials', items: 'oauthClientCredentials' })
        }
        for (const pool of limited(api, 'workload_identity_pools', await sub(api, IAM, `${p}/locations/global`, { kind: 'workload_identity_pools', path: 'workloadIdentityPools', items: 'workloadIdentityPools' }))) {
          await sub(api, IAM, pool.name, { kind: 'workload_identity_pool_providers', path: 'providers', items: 'workloadIdentityPoolProviders' })
        }
      }
      // Workforce 풀은 조직 아래에 있다
      for (const org of [...state.organizations].sort()) {
        for (const pool of limited(api, 'workforce_pools', await sub(api, IAM, 'locations/global', { kind: 'workforce_pools', path: 'workforcePools', items: 'workforcePools', query: { parent: org } }))) {
          for (const provider of limited(api, 'workforce_pool_providers', await sub(api, IAM, pool.name, { kind: 'workforce_pool_providers', path: 'providers', items: 'workforcePoolProviders' }))) {
            for (const tenant of limited(api, 'scim_tenants', await sub(api, IAM, provider.name, { kind: 'scim_tenants', path: 'scimTenants', items: 'workforcePoolProviderScimTenants' }))) {
              await sub(api, IAM, tenant.name, { kind: 'scim_tokens', path: 'tokens', items: 'workforcePoolProviderScimTokens' })
            }
          }
        }
      }
    }),

    call('GCP-07', 'Gemini Enterprise 감사 로그 (Cloud Logging)', async api => {
      const resourceNames = (g?.projects ?? []).map(p => (p.startsWith('projects/') ? p : `projects/${p}`))
      const stream = 'gcp:logging:gemini'
      const since = geminiLogStart(api.cursor(stream)?.last_event_at, api.period.since)
      const until = api.period.until
      const filter = `timestamp >= "${since}" AND timestamp < "${until}" AND ${GEMINI_LOG_FILTER}`
      let pageToken: string | undefined
      let pages = 0
      let maxTs: string | null = null
      let maxMs = -Infinity
      for (;;) {
        pages++
        const body: any = await api.get({
          url: LOGGING_URL,
          auth: auth(),
          method: 'POST',
          readOnlyPost: 'gcp-log',
          body: JSON.stringify({
            resourceNames,
            filter,
            orderBy: 'timestamp asc',
            pageSize: 1000,
            ...(pageToken ? { pageToken } : {}),
          }),
          params: { kind: 'logging_entries', page: pages },
          transform: sanitizeLoggingResponse,
        })
        if (!body) break
        for (const e of body.entries ?? []) {
          const ts = e?.timestamp
          if (typeof ts === 'string') {
            const ms = Date.parse(ts)
            if (Number.isFinite(ms) && ms > maxMs) { maxMs = ms; maxTs = ts }
          }
        }
        pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : undefined
        if (!pageToken) break
        if (pages >= GCP_LOG_MAX_PAGES) {
          api.partial(`max_pages:${GCP_LOG_MAX_PAGES}`)
          break
        }
      }
      if (maxTs) api.setCursor(stream, { cursor: null, last_event_at: maxTs })
    }),
  ]
}
