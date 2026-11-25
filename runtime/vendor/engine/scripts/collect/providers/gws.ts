/**
 * Google Workspace 수집 (계획서 5.4절, GW-01 ~ GW-11. GW-12 ~ GW-14 는 SC-H 증거: 버전별 매니페스트·사용자별 실행·실행 시각 토큰 사용. GW-15 는 SC-G 증거: Gmail 자동 전달 설정).
 *
 * 자격증명: CRED-GW-01 수집 전용 서비스 계정 + DWD. 관리 API 는 collector-admin 을, Drive·Forms·Apps Script 는
 * 파일 소유자(사용자)를 가장한다. 세팅용 서비스 계정(aegi-setup-sa)은 쓰지 않는다 (수집·세팅 자격증명 분리).
 * 폼 응답(FormResponse)은 받지 않는다. Apps Script 코드는 지문과 링크 참조(웹훅은 host·지문)만 남는다.
 */
import { buildUrl, httpClassifier, type CallApi, type CallDef, type Classifier } from '../lib/runner'
import { googleDwdAuthFactory, oauthRefreshTokenAuth, type GoogleKey } from '../lib/auth'
import type { Auth } from '../lib/http'
import { missingCredential } from '../config'
import { maxIso, streamStart, type ProviderContext } from './common'
import { runProbes, type ProbeTarget } from './probes'
import { sha256Hex } from '../lib/sanitize'
import { definitionReferences } from '../lib/external-definition'

const S = (s: string) => `https://www.googleapis.com/auth/${s}`
export const GWS_COLLECT_SCOPES = {
  customer: S('admin.directory.customer.readonly'),
  domain: S('admin.directory.domain.readonly'),
  user: S('admin.directory.user.readonly'),
  group: S('admin.directory.group.readonly'),
  member: S('admin.directory.group.member.readonly'),
  role: S('admin.directory.rolemanagement.readonly'),
  security: S('admin.directory.user.security'),
  reports: S('admin.reports.audit.readonly'),
  drive: S('drive.metadata.readonly'),
  /** GW-19 drives.list 는 metadata.readonly 를 허용하지 않는다. 파일 본문도 읽을 수 있는 범위라 명시적으로 허용한 경우에만 쓴다.
   * https://developers.google.com/workspace/drive/api/reference/rest/v3/drives/list */
  sharedDrive: S('drive.readonly'),
  forms: S('forms.body.readonly'),
  script: S('script.projects.readonly'),
  processes: S('script.processes'),
  /** GW-11 만 쓴다. DWD 클라이언트에 따로 허용해야 해서 config.gws.grantedScopes 에 있을 때만 부른다 */
  deployments: S('script.deployments.readonly'),
  /** GW-15 만 쓴다 (SC-G). 읽기 전용 Gmail 설정 범위는 없다: 이 호출을 허용하는 범위는 gmail.settings.basic(설정 쓰기 가능), gmail.readonly(메일 본문 읽기) 등뿐이다. 설정 쓰기 쪽이 더 약하다고 보고 이것을 쓰며, 예외로 자격증명 대장에 적고 config.gws.grantedScopes 에 있을 때만 부른다 */
  gmailSettings: S('gmail.settings.basic'),
  inboundSso: S('cloud-identity.inboundsso.readonly'),
  orgUnit: S('admin.directory.orgunit.readonly'),
  /** GW-21 만 쓴다 (V2-P3 C02). Groups Settings API 에는 읽기 전용 범위가 없다(apps.groups.settings 하나뿐이고 설정 쓰기 가능). GW-15 와 같이 예외로 자격증명 대장에 적고 config.gws.grantedScopes 에 있을 때만 부른다 */
  groupSettings: S('apps.groups.settings'),
  calendarAcl: S('calendar.acls.readonly'),
  allowlistedDomains: S('cloud-identity.allowlisteddomains.readonly'),
  policies: S('cloud-identity.policies.readonly'),
  /** GW-25 만 쓴다. Enterprise License Manager 에는 읽기 전용 범위가 없다(apps.licensing 하나뿐이고 라이선스 배정·회수 가능).
   * GW-15 와 같이 예외로 자격증명 대장에 적고 config.gws.grantedScopes 에 있을 때만 부른다.
   * https://developers.google.com/workspace/admin/licensing/reference/rest/v1/licenseAssignments/listForProduct */
  licensing: S('apps.licensing'),
}

const DIR = 'https://admin.googleapis.com/admin/directory/v1'
const CI = 'https://cloudidentity.googleapis.com/v1'

/**
 * GWS 는 호출마다 가장 대상·범위가 다른 토큰을 쓴다. 토큰 교환이 된 뒤의 401 은 자격증명이 죽은 것이 아니라
 * 그 호출의 관리자 권한 부족이다(09-27 GW-05 tokens 401). 그래서 403 처럼 그 호출만 실패시킨다.
 */
export const gwsClassifier: Classifier = res => (res.status === 401 ? { kind: 'forbidden', code: 'http_401' } : httpClassifier(res))
/**
 * Apps Script getContent 응답에 매니페스트 요약을 붙인다 (GW-09·GW-12, SC-H).
 * 코드 본문(files[].source)은 지금처럼 정리 단계에서 지문이 된다 — 여기서는 본문을 남기지 않는다.
 * 남기는 것: appsscript.json 의 실행 설정(webapp·executionApi), 요청 범위(oauthScopes), 켠 고급 서비스,
 * 그리고 켠 고급 서비스 중 서버 코드가 실제로 부르는 것의 이름(userSymbol) 목록. 비밀값이 들어가는 자리가 아니다.
 */
export function summarizeScriptContent(body: any): any {
  const files: any[] = Array.isArray(body?.files) ? body.files : []
  const manifestFile = files.find(f => f?.type === 'JSON' && f?.name === 'appsscript')
  if (!manifestFile || typeof manifestFile.source !== 'string') return body
  let m: any
  try { m = JSON.parse(manifestFile.source) } catch { return { ...body, manifest: { parse_error: true } } }
  const services: Array<{ userSymbol?: string; serviceId?: string; version?: string }> = (m?.dependencies?.enabledAdvancedServices ?? []).map((s: any) => ({ userSymbol: s?.userSymbol, serviceId: s?.serviceId, version: s?.version }))
  const code = files.filter(f => f?.type !== 'JSON' && typeof f?.source === 'string').map(f => f.source).join('\n')
  const called = services.map(s => s.userSymbol).filter((sym): sym is string => !!sym && new RegExp(`\\b${sym.replace(/[^A-Za-z0-9_$]/g, '')}\\.`).test(code))
  return {
    ...body,
    manifest: {
      webapp: m?.webapp ?? null,
      executionApi: m?.executionApi ?? null,
      oauthScopes: Array.isArray(m?.oauthScopes) ? m.oauthScopes : null,
      advancedServices: services,
      runtimeVersion: m?.runtimeVersion ?? null,
    },
    code_markers: { advanced_services_called: [...new Set(called)].sort(), external_references: { ...definitionReferences(code), reference_basis: 'definition_reference_only' } },
  }
}

const FILE_FIELDS = 'nextPageToken,files(id,name,mimeType,owners(emailAddress,permissionId),parents,driveId,shared,webViewLink,createdTime,modifiedTime)'
const PERM_FIELDS = 'nextPageToken,permissions(id,type,role,emailAddress,domain,allowFileDiscovery,deleted,displayName,pendingOwner)'
const DRIVE_PERM_CONCURRENCY = 8

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++
      await fn(items[idx]!)
    }
  })
  await Promise.all(workers)
}

function parseServiceAccountKey(raw: string): GoogleKey {
  try {
    return JSON.parse(raw) as GoogleKey
  } catch {
    let insideString = false
    let escaped = false
    let cleaned = ''
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]
      if (escaped) { cleaned += c; escaped = false; continue }
      if (c === '\\') {
        if (raw[i + 1] === 'n') {
          cleaned += insideString ? '\\n' : ' '
          i++
          continue
        }
        cleaned += c
        escaped = true
        continue
      }
      if (c === '"') insideString = !insideString
      cleaned += c
    }
    return JSON.parse(cleaned) as GoogleKey
  }
}

export function gwsCalls(ctx: ProviderContext): CallDef[] {
  const { config, creds, transport } = ctx
  const g = config.gws
  const saKey = creds.get('GWS_COLLECTOR_SA_KEY')
  const refreshToken = creds.get('GWS_COLLECTOR_REFRESH_TOKEN')
  const clientId = creds.get('GWS_COLLECTOR_CLIENT_ID')
  const isOAuth = !saKey && Boolean(refreshToken && clientId)
  const hasScope = (short: string) => (g.grantedScopes ?? []).includes(short)
  let factory: ((subject: string, scopes: string[]) => Auth) | null = null
  const as = (subject: string, ...scopes: string[]): Auth => {
    if (!factory) {
      if (isOAuth) {
        const oauthAuth = oauthRefreshTokenAuth({
          ref: 'CRED-GW-01',
          tokenUrl: creds.get('AEGI_GWS_TOKEN_URL') || 'https://oauth2.googleapis.com/token',
          clientId: clientId!,
          clientSecret: creds.get('GWS_COLLECTOR_CLIENT_SECRET'),
          refreshToken: refreshToken!,
          transport,
        })
        factory = () => oauthAuth
      } else {
        factory = googleDwdAuthFactory({ ref: 'CRED-GW-01', key: parseServiceAccountKey(saKey!), transport })
      }
    }
    return factory(subject, scopes)
  }
  const admin = (...scopes: string[]) => as(g.adminSubject, ...scopes)
  const state = {
    /** GW-01 이 받은 고객 ID(C0…). 라이선스 API(GW-25)는 my_customer 가 아니라 이 값을 받는다 */
    customerId: null as string | null,
    users: [] as Array<{ id: string; primaryEmail: string; isAdmin?: boolean; suspended?: boolean; archived?: boolean }>,
    groups: [] as Array<{ id: string; email: string }>,
    groupsListed: false,
    /** GW-13 이 모은 실행 (GW-14 가 그 시각의 토큰 사용 기록을 찾는다) */
    executions: [] as Array<{ user: string; script: string; processType?: string; startTime?: string; duration?: string }>,
    executionsCollected: false,
    /** Drive 목록(GW-07)에서 찾은 Form, 독립 Apps Script 와 설정 힌트. 소유자를 가장해 상세를 받는다 */
    forms: new Map<string, string>((g.forms ?? []).map(f => [f.id, f.owner])),
    scripts: new Map<string, string>((g.scripts ?? []).map(s => [s.id, s.owner])),
    driveDone: false,
  }
  const forms = () => [...state.forms].map(([id, owner]) => ({ id, owner })).sort((a, b) => a.id.localeCompare(b.id))
  const scripts = () => [...state.scripts].map(([id, owner]) => ({ id, owner })).sort((a, b) => a.id.localeCompare(b.id))
  const activeUsers = () => state.users.filter(u => !u.suspended && !u.archived).map(u => u.primaryEmail).sort()

  const list = (api: CallApi, auth: Auth, url: string, items: (b: any) => any[], params: Record<string, unknown> = {}, extra: object = {}) =>
    api.list({ classify: gwsClassifier, ...extra, url, auth, paginate: { kind: 'google' }, items, params })

  const call = (id: string, title: string, run: (api: CallApi) => Promise<void>, depends?: () => string | null): CallDef => ({
    id,
    provider: 'gws',
    title,
    credential: 'CRED-GW-01',
    unavailable: () => missingCredential(creds, 'CRED-GW-01') ?? depends?.() ?? null,
    run,
  })

  return [
    call('GW-01', 'Customer', async api => {
      const body: any = await api.get({ classify: gwsClassifier, url: `${DIR}/customers/my_customer`, auth: admin(GWS_COLLECT_SCOPES.customer) })
      state.customerId = typeof body?.id === 'string' && /^[A-Za-z0-9]+$/.test(body.id) ? body.id : null
    }),
    call('GW-02', '도메인', async api => {
      await api.get({ classify: gwsClassifier, url: `${DIR}/customer/my_customer/domains`, auth: admin(GWS_COLLECT_SCOPES.domain) })
    }),
    call('GW-03', '사용자', async api => {
      state.users = await list(api, admin(GWS_COLLECT_SCOPES.user), buildUrl(`${DIR}/users`, { customer: 'my_customer', projection: 'full', maxResults: 500 }), b => b?.users ?? [])
    }),
    call('GW-04', '그룹·그룹 멤버', async api => {
      let inventorySeen = false
      let inventoryFailed = false
      state.groups = await list(api, admin(GWS_COLLECT_SCOPES.group), buildUrl(`${DIR}/groups`, { customer: 'my_customer', maxResults: 200 }), b => b?.groups ?? [], {}, {
        classify: (res: Parameters<Classifier>[0]) => {
          const verdict = gwsClassifier(res)
          if (verdict) inventoryFailed = true
          else inventorySeen = true
          return verdict
        },
      })
      state.groupsListed = inventorySeen && !inventoryFailed
      for (const grp of state.groups) {
        await list(api, admin(GWS_COLLECT_SCOPES.member), buildUrl(`${DIR}/groups/${grp.id}/members`, { maxResults: 200 }), b => b?.members ?? [], { group: grp.email })
      }
    }),
    call('GW-05', '사용자 승인 서드파티 앱 토큰', async api => {
      // 실제 권한은 테넌트/수집 주체마다 다르다. 관리자도 시도하고 사용자별 실패만 partial로 남긴다.
      for (const u of state.users) {
        await api.optional(`tokens:${u.primaryEmail}`, () => api.get({ classify: gwsClassifier, url: `${DIR}/users/${u.id}/tokens`, auth: admin(GWS_COLLECT_SCOPES.security), params: { user: u.primaryEmail } }))
      }
    }, () => (state.users.length ? null : 'depends_on:GW-03')),
    call('GW-06', '관리자 역할·배정', async api => {
      const auth = admin(GWS_COLLECT_SCOPES.role)
      await list(api, auth, buildUrl(`${DIR}/customer/my_customer/roles`, { maxResults: 100 }), b => b?.items ?? [], { kind: 'roles' })
      await list(api, auth, buildUrl(`${DIR}/customer/my_customer/roleassignments`, { maxResults: 200 }), b => b?.items ?? [], { kind: 'roleassignments' })
    }),
    // 디렉터리의 활성 사용자 전부(설정에 driveUsers 가 있으면 그것). Form 과 독립 Apps Script 를 여기서 찾는다
    call('GW-07', 'Drive 파일·권한 (모든 사용자)', async api => {
      for (const user of g.driveUsers?.length ? g.driveUsers : activeUsers()) {
        const auth = as(user, GWS_COLLECT_SCOPES.drive)
        const files = await list(api, auth, buildUrl('https://www.googleapis.com/drive/v3/files', { corpora: 'user', pageSize: 1000, q: 'trashed = false', fields: FILE_FIELDS, supportsAllDrives: true, includeItemsFromAllDrives: true }), b => b?.files ?? [], { user })
        for (const f of files) {
          const owner = (f.owners ?? [])[0]?.emailAddress ?? user
          if (f.mimeType === 'application/vnd.google-apps.form' && !state.forms.has(f.id)) state.forms.set(f.id, owner)
          if (f.mimeType === 'application/vnd.google-apps.script' && !state.scripts.has(f.id)) state.scripts.set(f.id, owner)
        }
        // 권한은 소유자 쪽에서 한 번만 받는다 (공유받은 파일은 소유자 가장 때 나온다)
        const ownedFiles = files.filter((x: any) => (x.owners ?? []).some((o: any) => o.emailAddress === user))
        await mapWithConcurrency(ownedFiles, DRIVE_PERM_CONCURRENCY, async f => {
          await list(api, auth, buildUrl(`https://www.googleapis.com/drive/v3/files/${f.id}/permissions`, { supportsAllDrives: true, fields: PERM_FIELDS }), b => b?.permissions ?? [], { user, file: f.id })
        })
      }
      state.driveDone = true
      // 문서에 묶인 스크립트는 어떤 목록 API 에도 안 나온다. 설정 힌트로만 본다
      api.note(`apps_script_container_bound_not_listable: 힌트 ${(g.scripts ?? []).length}개`)
    }, () => (g.driveUsers?.length || state.users.length ? null : 'depends_on:GW-03')),
    call('GW-08', 'Form (구조만, 응답 제외)', async api => {
      for (const f of forms()) await api.get({ classify: gwsClassifier, url: `https://forms.googleapis.com/v1/forms/${f.id}`, auth: as(f.owner, GWS_COLLECT_SCOPES.forms), params: { form: f.id, owner: f.owner } })
    }, () => (isOAuth && !hasScope('forms.body.readonly') ? 'scope_not_granted:forms.body.readonly' : state.forms.size ? null : state.driveDone ? 'not_found:Form 파일 없음' : 'depends_on:GW-07')),
    call('GW-09', 'Apps Script 프로젝트·코드 지문·실행 이력', async api => {
      for (const sc of scripts()) {
        const params = { script: sc.id, owner: sc.owner }
        await api.get({ classify: gwsClassifier, url: `https://script.googleapis.com/v1/projects/${sc.id}`, auth: as(sc.owner, GWS_COLLECT_SCOPES.script), params })
        await api.get({ classify: gwsClassifier, url: `https://script.googleapis.com/v1/projects/${sc.id}/content`, auth: as(sc.owner, GWS_COLLECT_SCOPES.script), params, rules: { contentKeys: ['source'] }, transform: summarizeScriptContent })
        await list(api, as(sc.owner, GWS_COLLECT_SCOPES.processes), buildUrl('https://script.googleapis.com/v1/processes', { 'userProcessFilter.scriptId': sc.id, pageSize: 200 }), b => b?.processes ?? [], params)
      }
    }, () => (isOAuth && !hasScope('script.projects.readonly') ? 'scope_not_granted:script.projects.readonly' : state.scripts.size ? null : state.driveDone ? 'not_found:Apps Script 없음' : 'depends_on:GW-07')),
    // 배포(웹앱·API 실행 파일)의 executeAs·access. 실행 신원(run_as_resolution)과 "누구나 부를 수 있는 입구"를 정한다
    call('GW-11', 'Apps Script 배포 (executeAs·access)', async api => {
      for (const sc of scripts()) {
        await list(api, as(sc.owner, GWS_COLLECT_SCOPES.deployments), buildUrl(`https://script.googleapis.com/v1/projects/${sc.id}/deployments`, { pageSize: 50 }), b => b?.deployments ?? [], { script: sc.id, owner: sc.owner })
      }
    }, () => (!state.scripts.size ? 'not_found:Apps Script 없음' : (g.grantedScopes ?? []).includes('script.deployments.readonly') ? null : 'scope_not_granted:script.deployments.readonly')),
    call('GW-10', 'Reports 감사 로그', async api => {
      // "앱" 또는 "앱:이벤트". token 은 authorize(앱 승인)만 받는다 — activity 는 세팅 스크립트의 API 사용 기록이
      // 대부분이라 25만 건이 넘는다(09-27 첫 수집, 원본 403MB)
      for (const entry of g.reportApplications) {
        const [app, eventName] = entry.split(':')
        const stream = `gws.reports.${entry}`
        const start = streamStart(api, stream, config.since)
        const rows = await list(
          api,
          admin(GWS_COLLECT_SCOPES.reports),
          buildUrl(`https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/${app}`, { startTime: start, endTime: api.period.until, maxResults: 1000, eventName }),
          b => b?.items ?? [],
          { application: app, ...(eventName ? { eventName } : {}), startTime: start },
        )
        const last = maxIso(rows.map((r: any) => r?.id?.time))
        api.setCursor(stream, { cursor: null, last_event_at: last ?? api.cursor(stream)?.last_event_at ?? null })
      }
    }),
    // ---- SC-H: 웹앱 실행 신원 전가. 기존 호출 뒤에 붙인다 (기존 호출의 순서·출력은 그대로) ----
    // 버전별 매니페스트. 배포(GW-11)는 지금 가리키는 버전의 설정만 준다 — 실행 시점의 executeAs 는 버전 이력으로 본다.
    // script.projects.readonly 만 쓴다 (GW-09 와 같은 범위)
    call('GW-12', 'Apps Script 버전·버전별 매니페스트', async api => {
      for (const sc of scripts()) {
        const auth = as(sc.owner, GWS_COLLECT_SCOPES.script)
        const versions = await list(api, auth, buildUrl(`https://script.googleapis.com/v1/projects/${sc.id}/versions`, { pageSize: 50 }), b => b?.versions ?? [], { script: sc.id, owner: sc.owner }, { maxPages: 4 })
        for (const v of versions) {
          if (v?.versionNumber === undefined) continue
          await api.get({ classify: gwsClassifier, url: buildUrl(`https://script.googleapis.com/v1/projects/${sc.id}/content`, { versionNumber: v.versionNumber }), auth, params: { script: sc.id, owner: sc.owner, versionNumber: v.versionNumber }, rules: { contentKeys: ['source'] }, transform: summarizeScriptContent })
        }
      }
    }, () => (isOAuth && !hasScope('script.projects.readonly') ? 'scope_not_granted:script.projects.readonly' : state.scripts.size ? null : 'not_found:Apps Script 없음')),
    // 사용자별 실행 이력. processes.list 는 "그 사용자가 했거나 그 사용자 대신 돈" 실행만 준다 — 주인 말고 누가 열었는지는
    // 사용자마다 가장해 불러야 나온다 (GW-09 는 주인 것만). 정지·보관 계정은 토큰 교환이 GWS 전체를 멈출 수 있어 뺀다
    call('GW-13', 'Apps Script 사용자별 실행 이력', async api => {
      const active = state.users.filter(u => !u.suspended && !u.archived)
      for (const sc of scripts()) {
        for (const u of active) {
          const rows = await api.optional(`processes:${u.primaryEmail}`, () =>
            list(api, as(u.primaryEmail, GWS_COLLECT_SCOPES.processes), buildUrl('https://script.googleapis.com/v1/processes', { 'userProcessFilter.scriptId': sc.id, pageSize: 200 }), b => b?.processes ?? [], { script: sc.id, owner: sc.owner, user: u.primaryEmail }, { maxPages: 10 }))
          for (const p of rows ?? []) state.executions.push({ user: u.primaryEmail, script: sc.id, processType: p?.processType, startTime: p?.startTime, duration: p?.duration })
        }
      }
      state.executionsCollected = true
    }, () => (isOAuth && !hasScope('script.processes') ? 'scope_not_granted:script.processes' : !state.scripts.size ? 'not_found:Apps Script 없음' : state.users.length ? null : 'depends_on:GW-03')),
    // 사용자별 전체 Apps Script 실행 이력 (스크립트 필터 없음). 문서에 묶인 스크립트는 어떤 목록 API 에도 안 나와,
    // 그 스크립트가 누구 이름으로 언제 돌았는지(프로젝트 이름, 함수, 트리거 종류)가 유일한 발견 경로다. 스크립트 id 는 주지 않는다
    call('GW-16', 'Apps Script 실행 이력 (사용자별 전체, 목록에 없는 스크립트 발견)', async api => {
      for (const user of activeUsers()) {
        await api.optional(`processes:${user}`, () =>
          list(api, as(user, GWS_COLLECT_SCOPES.processes), buildUrl('https://script.googleapis.com/v1/processes', { 'userProcessFilter.startTime': config.since, pageSize: 200 }), b => b?.processes ?? [], { user }, { maxPages: 10 }))
      }
    }, () => (isOAuth && !hasScope('script.processes') ? 'scope_not_granted:script.processes' : state.users.length ? null : 'depends_on:GW-03')),
    // 자동 전달 설정 (SC-G). 사용자마다 그 사용자를 가장해 읽는다. 메일 본문은 읽지 않는다
    call('GW-15', 'Gmail 자동 전달 설정, 전달 주소, 메일 위임', async api => {
      const active = state.users.filter(u => !u.suspended && !u.archived)
      for (const u of active) {
        const auth = as(u.primaryEmail, GWS_COLLECT_SCOPES.gmailSettings)
        await api.optional(`gmail:${u.primaryEmail}:auto`, () => api.get({ classify: gwsClassifier, url: 'https://gmail.googleapis.com/gmail/v1/users/me/settings/autoForwarding', auth, params: { user: u.primaryEmail, kind: 'autoForwarding' } }))
        await api.optional(`gmail:${u.primaryEmail}:addresses`, () => api.get({ classify: gwsClassifier, url: 'https://gmail.googleapis.com/gmail/v1/users/me/settings/forwardingAddresses', auth, params: { user: u.primaryEmail, kind: 'forwardingAddresses' } }))
        // 메일 위임 (V2-R1). 같은 gmail.settings.basic 범위로 읽는다(users.settings.delegates.list)
        await api.optional(`gmail:${u.primaryEmail}:delegates`, () => api.get({ classify: gwsClassifier, url: 'https://gmail.googleapis.com/gmail/v1/users/me/settings/delegates', auth, params: { user: u.primaryEmail, kind: 'delegates' } }))
      }
    }, () => (!state.users.length ? 'depends_on:GW-03' : (g.grantedScopes ?? []).includes('gmail.settings.basic') ? null : 'scope_not_granted:gmail.settings.basic')),
    // 웹앱 실행 시각의 토큰 사용 기록 (Reports token activity). 실행이 실제로 그 사용자의 토큰으로 API 를 불렀는지
    // (api_name·method_name·num_response_bytes) 를 본다. 전체 activity 는 너무 많아(09-27 25만 건) 실행 전후 구간만 받는다
    call('GW-14', '웹앱 실행 시각의 토큰 사용 기록 (Reports token activity)', async api => {
      for (const w of executionWindows(state.executions.filter(e => e.processType === 'WEBAPP'))) {
        await list(
          api,
          admin(GWS_COLLECT_SCOPES.reports),
          buildUrl(`https://admin.googleapis.com/admin/reports/v1/activity/users/${encodeURIComponent(w.user)}/applications/token`, { eventName: 'activity', startTime: w.start, endTime: w.end, maxResults: 1000 }),
          b => b?.items ?? [],
          { user: w.user, startTime: w.start, endTime: w.end, scripts: w.scripts },
          { maxPages: 10 },
        )
      }
    }, () => (!state.executionsCollected ? 'depends_on:GW-13' : state.executions.some(e => e.processType === 'WEBAPP') ? null : 'no_webapp_executions:GW-13')),
    // V2-P1 (판단표 3차 A10 ~ A13): 존재 확인(GW-90)에서 옮겨 와 객체로 수집한다
    call('GW-17', 'SSO 프로필, IdP 인증서, SSO 배정', async api => {
      const auth = admin(GWS_COLLECT_SCOPES.inboundSso)
      const samlProfiles = await list(api, auth, buildUrl(`${CI}/inboundSamlSsoProfiles`, { filter: 'customer=="customers/my_customer"' }), b => b?.inboundSamlSsoProfiles ?? [], { kind: 'saml' })
      const certMask = {
        transform: (b: any) => {
          const maskItem = ({ pemData, ...k }: any) => ({ ...k, cert_sha256: pemData ? sha256Hex(String(pemData)) : undefined })
          if (Array.isArray(b)) return b.map(maskItem)
          if (Array.isArray(b?.idpCredentials)) return { ...b, idpCredentials: b.idpCredentials.map(maskItem) }
          return b
        },
      }
      for (const p of samlProfiles) {
        if (!p?.name) continue
        await api.optional(`idp_credentials:${p.name}`, () => list(api, auth, `${CI}/${p.name}/idpCredentials`, b => b?.idpCredentials ?? [], { profile: p.name }, certMask))
      }
      await list(api, auth, buildUrl(`${CI}/inboundOidcSsoProfiles`, { filter: 'customer=="customers/my_customer"' }), b => b?.inboundOidcSsoProfiles ?? [], { kind: 'oidc' })
      await list(api, auth, buildUrl(`${CI}/inboundSsoAssignments`, { filter: 'customer=="customers/my_customer"' }), b => b?.inboundSsoAssignments ?? [], { kind: 'assignments' })
    }),
    call('GW-18', '사용자 앱 비밀번호 (Asp)', async api => {
      const auth = admin(GWS_COLLECT_SCOPES.security)
      for (const u of activeUsers()) {
        await api.optional(`asps:${u}`, () => list(api, auth, `${DIR}/users/${encodeURIComponent(u)}/asps`, b => b?.items ?? [], { user: u }))
      }
    }, () => (state.users.length ? null : 'depends_on:GW-03')),
    call('GW-19', '공유 드라이브 및 권한', async api => {
      // drives.list: drive.readonly 가 필요하다. 권한 목록은 기존 metadata.readonly 토큰으로 읽는다.
      const drives = await list(api, admin(GWS_COLLECT_SCOPES.sharedDrive), buildUrl('https://www.googleapis.com/drive/v3/drives', { pageSize: 100, useDomainAdminAccess: true }), b => b?.drives ?? [], { kind: 'drives' })
      const auth = admin(GWS_COLLECT_SCOPES.drive)
      for (const d of drives) {
        if (!d?.id) continue
        await api.optional(`drive_permissions:${d.id}`, () => list(api, auth, buildUrl(`https://www.googleapis.com/drive/v3/files/${d.id}/permissions`, { supportsAllDrives: true, useDomainAdminAccess: true, fields: PERM_FIELDS }), b => b?.permissions ?? [], { drive: d.id }))
      }
    }, () => ((g.grantedScopes ?? []).includes('drive.readonly') ? null : 'scope_not_granted:drive.readonly')),
    call('GW-20', '조직 단위 (OrgUnit)', async api => {
      const auth = admin(GWS_COLLECT_SCOPES.orgUnit)
      await list(api, auth, buildUrl(`${DIR}/customer/my_customer/orgunits`, { type: 'all' }), b => b?.organizationUnits ?? [])
    }),
    // 그룹 설정 (V2-P3, 판단표 3차 C02). 누가 가입, 열람, 게시할 수 있는지와 외부 멤버 허용을 그룹 속성으로 받는다. alt=json 이 없으면 Atom XML 로 온다
    call('GW-21', '그룹 설정 (Groups Settings)', async api => {
      const auth = admin(GWS_COLLECT_SCOPES.groupSettings)
      for (const grp of state.groups) {
        if (!grp?.email) continue
        await api.optional(`group_settings:${grp.email}`, () => api.get({ classify: gwsClassifier, url: buildUrl(`https://www.googleapis.com/groups/v1/groups/${encodeURIComponent(grp.email)}`, { alt: 'json' }), auth, params: { group: grp.email } }))
      }
    }, () => (!state.groups.length ? state.groupsListed ? 'not_found:Google 그룹 없음' : 'depends_on:GW-04' : (g.grantedScopes ?? []).includes('apps.groups.settings') ? null : 'scope_not_granted:apps.groups.settings')),
    // V2-P2 (판단표 3차 B21, B24, B25): 조건 없는 것. B23(구독, Forms watch)은 목록 API 가 호출한 프로젝트 것만 줘서 보류(V2-OPEN-27)
    // 캘린더 공유 규칙. 사용자마다 그 사용자를 가장해 기본 캘린더(primary)의 ACL 만 읽는다. 일정 내용은 읽지 않는다
    call('GW-22', '캘린더 공유 규칙 (기본 캘린더 ACL)', async api => {
      for (const u of activeUsers()) {
        await api.optional(`calendar_acl:${u}`, () => list(api, as(u, GWS_COLLECT_SCOPES.calendarAcl), buildUrl('https://www.googleapis.com/calendar/v3/calendars/primary/acl', { maxResults: 250 }), b => b?.items ?? [], { user: u }))
      }
    }, () => (isOAuth && !hasScope('calendar.acls.readonly') ? 'scope_not_granted:calendar.acls.readonly' : state.users.length ? null : 'depends_on:GW-03')),
    call('GW-23', '외부 공유 허용 도메인 (Cloud Identity)', async api => {
      await list(api, admin(GWS_COLLECT_SCOPES.allowlistedDomains), `${CI}/allowlistedDomains`, b => b?.allowlistedDomains ?? [])
    }),
    call('GW-24', '관리 정책 (Cloud Identity policies)', async api => {
      await list(api, admin(GWS_COLLECT_SCOPES.policies), `${CI}/policies`, b => b?.policies ?? [])
    }),
    // 라이선스 배정 (2026-11-15 수집 빈 곳). 제품마다 누가 어떤 SKU 를 받았는지. 라이선스가 없으면 그 제품(Drive, Gmail …)을 못 쓴다.
    // 제품 ID 는 config.gws.licenseProducts (기본 Google-Apps = Google Workspace). 이 회차에 없는 제품은 404 라 그 제품만 partial 로 남긴다
    call('GW-25', '라이선스 배정 (Enterprise License Manager)', async api => {
      const auth = admin(GWS_COLLECT_SCOPES.licensing)
      for (const product of g.licenseProducts?.length ? g.licenseProducts : ['Google-Apps']) {
        await api.optional(`licenses:${product}`, () => list(api, auth, buildUrl(`https://licensing.googleapis.com/apps/licensing/v1/product/${encodeURIComponent(product)}/users`, { customerId: state.customerId!, maxResults: 1000 }), b => b?.items ?? [], { product }))
      }
    }, () => (!state.customerId ? 'depends_on:GW-01' : (g.grantedScopes ?? []).includes('apps.licensing') ? null : 'scope_not_granted:apps.licensing')),
    // 존재 확인: 수집하지 않는 종류. 범위가 DWD 에 허용되지 않았으면 토큰 교환이 실패하고 그 결과만 남는다
    call('GW-90', '존재 확인 (수집하지 않는 종류)', async api => {
      const probe = (catalogName: string, scope: string, url: (() => string[]) | string, key: string): ProbeTarget => ({
        catalogName, needs: S(scope),
        fetch: async a => {
          const all: unknown[] = []
          for (const u of typeof url === 'string' ? [url] : url()) all.push(...await list(a, admin(S(scope)), u, b => b?.[key] ?? [], { probe: catalogName }, { maxPages: 3 }))
          return all
        },
      })
      await runProbes(api, [
        probe('ChromeOsDevice', 'admin.directory.device.chromeos.readonly', buildUrl(`${DIR}/customer/my_customer/devices/chromeos`, { maxResults: 200 }), 'chromeosdevices'),
        probe('MobileDevice', 'admin.directory.device.mobile.readonly', buildUrl(`${DIR}/customer/my_customer/devices/mobile`, { maxResults: 100 }), 'mobiledevices'),
      ])
    }, () => (state.users.length ? null : 'depends_on:GW-03')),
  ]
}

/** 실행 시작 −60초 ~ 시작+실행 시간+120초. 같은 사용자의 겹치는 구간은 하나로 합친다 (GW-14) */
export function executionWindows(executions: Array<{ user: string; script: string; startTime?: string; duration?: string }>): Array<{ user: string; start: string; end: string; scripts: string[] }> {
  const byUser = new Map<string, Array<{ start: number; end: number; scripts: Set<string> }>>()
  for (const e of executions) {
    const t = Date.parse(e.startTime ?? '')
    if (!Number.isFinite(t)) continue
    const dur = Number.parseFloat(String(e.duration ?? '0').replace(/s$/, '')) || 0
    const list = byUser.get(e.user) ?? []
    list.push({ start: t - 60_000, end: t + Math.ceil(dur * 1000) + 120_000, scripts: new Set([e.script]) })
    byUser.set(e.user, list)
  }
  const out: Array<{ user: string; start: string; end: string; scripts: string[] }> = []
  for (const [user, list] of [...byUser].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => a.start - b.start)
    const merged: typeof list = []
    for (const w of list) {
      const last = merged[merged.length - 1]
      if (last && w.start <= last.end) {
        last.end = Math.max(last.end, w.end)
        for (const s of w.scripts) last.scripts.add(s)
      } else merged.push({ ...w, scripts: new Set(w.scripts) })
    }
    for (const w of merged) out.push({ user, start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString(), scripts: [...w.scripts].sort() })
  }
  return out
}
