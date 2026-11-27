import { buildUrl, CallError, httpClassifier, type CallApi, type CallDef, type Classifier } from '../lib/runner'
import { m365ClientCredentialsAuth, TokenError } from '../lib/auth'
import type { Auth } from '../lib/http'
import { missingCredential } from '../config'
import { maxIso, streamStart, type DnsResolver, type ProviderContext } from './common'

const GRAPH = 'https://graph.microsoft.com/v1.0'
// Node fetch 는 Accept-Language: * 를 보내는데, roleEligibilitySchedules 는 이를 400(CultureNotFoundException)으로 거절한다(2026-11-20 실측)
const GRAPH_HEADERS = { ConsistencyLevel: 'eventual', 'Accept-Language': 'en-US' }

const USER_SELECT_FIELDS = [
  'id',
  'userPrincipalName',
  'displayName',
  'givenName',
  'surname',
  'mail',
  'otherMails',
  'proxyAddresses',
  'accountEnabled',
  'userType',
  'department',
  'jobTitle',
  'officeLocation',
  'usageLocation',
  'createdDateTime',
  'onPremisesSyncEnabled',
  'assignedLicenses',
  'assignedPlans',
  'externalUserState',
  'creationType',
  'signInActivity',
]

const USER_CAP = 200
const SP_CAP = 200
const DRIVE_DEPTH_LIMIT = 3
const DEFAULT_MAX_DRIVE_ITEMS = 2000

interface M365CredentialJson {
  tenantId?: string
  clientId?: string
  clientSecret?: string
}

function parseM365Creds(raw: string): { tenantId?: string; clientId: string; clientSecret: string } {
  let parsed: M365CredentialJson
  try {
    parsed = JSON.parse(raw) as M365CredentialJson
  } catch {
    throw new TokenError('M365 자격증명 JSON 을 읽을 수 없다')
  }
  if (!parsed?.clientId || !parsed?.clientSecret) {
    throw new TokenError('M365 자격증명에 clientId 또는 clientSecret 이 없다')
  }
  return {
    tenantId: parsed.tenantId,
    clientId: parsed.clientId,
    clientSecret: parsed.clientSecret,
  }
}

export function microsoftCalls(ctx: ProviderContext): CallDef[] {
  const { config, creds, transport } = ctx
  let cachedAuth: Auth | null = null
  let cachedMgmtAuth: Auth | null = null

  const resolveCreds = () => {
    const parsed = parseM365Creds(creds.require('m365/collector-app.json'))
    const tenantId = parsed.tenantId || config.microsoft?.tenantId || ''
    if (!tenantId) throw new TokenError('M365 tenantId 가 없다')
    return { ...parsed, tenantId }
  }

  const getAuth = (): Auth => {
    if (cachedAuth) return cachedAuth
    const { tenantId, clientId, clientSecret } = resolveCreds()
    cachedAuth = m365ClientCredentialsAuth({
      ref: 'CRED-M365-01',
      tenantId,
      clientId,
      clientSecret,
      transport,
    })
    return cachedAuth
  }

  const getMgmtAuth = (): Auth => {
    if (cachedMgmtAuth) return cachedMgmtAuth
    const { tenantId, clientId, clientSecret } = resolveCreds()
    cachedMgmtAuth = m365ClientCredentialsAuth({
      ref: 'CRED-M365-01',
      tenantId,
      clientId,
      clientSecret,
      scope: 'https://manage.office.com/.default',
      transport,
    })
    return cachedMgmtAuth
  }

  const state = {
    users: [] as Array<{ id: string }>,
    usersDone: false,
    siteDriveIds: [] as string[],
    domains: [] as Array<{ id: string; isVerified?: boolean }>,
    domainsDone: false,
    teamIds: [] as string[],
    teamsDone: false,
  }

  const unavailable = () =>
    missingCredential(creds, 'CRED-M365-01') ??
    (!config.microsoft ? 'config_missing:microsoft' : !config.microsoft.tenantId ? 'config_missing:microsoft.tenantId' : null)

  const url = (path: string) => (path.startsWith('http') ? path : `${GRAPH}${path}`)

  const get = (api: CallApi, path: string, params: Record<string, unknown> = {}, extra: { headers?: Record<string, string>; [k: string]: unknown } = {}) =>
    api.get({ ...extra, url: url(path), auth: getAuth(), headers: extra.headers ? { ...GRAPH_HEADERS, ...extra.headers } : GRAPH_HEADERS, params })

  const list = (api: CallApi, path: string, params: Record<string, unknown> = {}, extra: { headers?: Record<string, string>; [k: string]: unknown } = {}) =>
    api.list({ ...extra, url: url(path), auth: getAuth(), headers: extra.headers ? { ...GRAPH_HEADERS, ...extra.headers } : GRAPH_HEADERS, paginate: { kind: 'graph' }, items: b => b?.value ?? [], params })

  const call = (id: string, title: string, run: (api: CallApi) => Promise<void>, depends?: () => string | null): CallDef => ({
    id,
    provider: 'microsoft',
    title,
    credential: 'CRED-M365-01',
    unavailable: () => unavailable() ?? depends?.() ?? null,
    run,
  })

  return [
    call('M365-01', 'Organization', async api => {
      await get(api, '/organization', {}, {
        verify: (body: any) => {
          const orgId = body?.value?.[0]?.id
          if (config.microsoft?.tenantId && orgId && orgId !== config.microsoft.tenantId) {
            return `microsoft organization ${orgId} != 설정 ${config.microsoft.tenantId}`
          }
          return null
        },
      })
    }),

    call('M365-02', 'Users', async api => {
      const withSignIn = `/users?$top=999&$select=${USER_SELECT_FIELDS.join(',')}`
      try {
        state.users = await list(api, withSignIn)
      } catch (err) {
        if (err instanceof CallError && err.status === 403) {
          api.partial('users_signInActivity:http_403')
          const withoutSignIn = `/users?$top=999&$select=${USER_SELECT_FIELDS.filter(f => f !== 'signInActivity').join(',')}`
          state.users = await list(api, withoutSignIn)
        } else {
          throw err
        }
      }
      state.usersDone = true
    }),

    call('M365-03', 'User details (licenseDetails, manager, authentication methods)', async api => {
      const targets = state.users.slice(0, USER_CAP)
      if (state.users.length > USER_CAP) api.partial(`users_capped:${USER_CAP}`)
      for (const u of targets) {
        if (!u?.id) continue
        const uid = encodeURIComponent(u.id)
        await api.optional(`licenseDetails:${u.id}`, () => list(api, `/users/${uid}/licenseDetails`, { user: u.id, kind: 'licenseDetails' }))
        await api.optional(`manager:${u.id}`, () => get(api, `/users/${uid}/manager?$select=id`, { user: u.id, kind: 'manager' }))
        await api.optional(`authMethods:${u.id}`, () => list(api, `/users/${uid}/authentication/methods`, { user: u.id, kind: 'authentication_methods' }))
      }
    }, () => (state.usersDone ? null : 'depends_on:M365-02')),

    call('M365-04', 'Groups (members, owners)', async api => {
      const groups = await list(api, '/groups?$top=999', { kind: 'groups' })
      for (const g of groups) {
        if (!g?.id) continue
        const gid = encodeURIComponent(g.id)
        await api.optional(`group_members:${g.id}`, () => list(api, `/groups/${gid}/members?$select=id,displayName,userPrincipalName`, { group: g.id, kind: 'members' }))
        await api.optional(`group_owners:${g.id}`, () => list(api, `/groups/${gid}/owners?$select=id`, { group: g.id, kind: 'owners' }))
      }
    }),

    call('M365-05', 'Applications (owners, federatedIdentityCredentials)', async api => {
      const apps = await list(api, '/applications?$top=999', { kind: 'applications' })
      for (const a of apps) {
        if (!a?.id) continue
        const aid = encodeURIComponent(a.id)
        await api.optional(`app_owners:${a.id}`, () => list(api, `/applications/${aid}/owners?$select=id`, { app: a.id, kind: 'owners' }))
        await api.optional(`app_federatedIdentityCredentials:${a.id}`, () => list(api, `/applications/${aid}/federatedIdentityCredentials`, { app: a.id, kind: 'federatedIdentityCredentials' }))
      }
    }),

    call('M365-06', 'ServicePrincipals (appRoleAssignedTo, appRoleAssignments)', async api => {
      const sps = await list(api, '/servicePrincipals?$top=999', { kind: 'servicePrincipals' })
      const tenantId = config.microsoft?.tenantId
      const prioritized = [...sps]
        .sort((a, b) => {
          const aOwn = a?.appOwnerOrganizationId === tenantId ? 0 : 1
          const bOwn = b?.appOwnerOrganizationId === tenantId ? 0 : 1
          if (aOwn !== bOwn) return aOwn - bOwn
          const aHas = Array.isArray(a?.appRoleAssignedTo) && a.appRoleAssignedTo.length > 0 ? 0 : 1
          const bHas = Array.isArray(b?.appRoleAssignedTo) && b.appRoleAssignedTo.length > 0 ? 0 : 1
          return aHas - bHas
        })
        .slice(0, SP_CAP)
      if (sps.length > SP_CAP) api.note(`servicePrincipals_capped:${SP_CAP}/${sps.length}`)
      for (const sp of prioritized) {
        if (!sp?.id) continue
        const spid = encodeURIComponent(sp.id)
        await api.optional(`sp_appRoleAssignedTo:${sp.id}`, () => list(api, `/servicePrincipals/${spid}/appRoleAssignedTo`, { sp: sp.id, kind: 'appRoleAssignedTo' }))
        await api.optional(`sp_appRoleAssignments:${sp.id}`, () => list(api, `/servicePrincipals/${spid}/appRoleAssignments`, { sp: sp.id, kind: 'appRoleAssignments' }))
      }
    }),

    call('M365-07', 'OAuth2PermissionGrants', async api => {
      await list(api, '/oauth2PermissionGrants')
    }),

    call('M365-08', 'Directory Roles and Assignments', async api => {
      await list(api, '/roleManagement/directory/roleDefinitions', { kind: 'roleDefinitions' })
      await list(api, '/roleManagement/directory/roleAssignments', { kind: 'roleAssignments' })
      await list(api, '/directoryRoles', { kind: 'directoryRoles' })
      await api.optional('roleEligibilitySchedules', () => list(api, '/roleManagement/directory/roleEligibilitySchedules', { kind: 'roleEligibilitySchedules' }))
    }),

    call('M365-09', 'AdministrativeUnits (members)', async api => {
      const units = await list(api, '/directory/administrativeUnits', { kind: 'administrativeUnits' })
      for (const au of units) {
        if (!au?.id) continue
        await api.optional(`au_members:${au.id}`, () => list(api, `/directory/administrativeUnits/${encodeURIComponent(au.id)}/members?$select=id`, { administrativeUnit: au.id, kind: 'members' }))
      }
    }),

    call('M365-10', 'Licenses and Domains', async api => {
      await list(api, '/subscribedSkus', { kind: 'subscribedSkus' })
      state.domains = await list(api, '/domains', { kind: 'domains' })
      state.domainsDone = true
    }),

    call('M365-11', 'ConditionalAccess (policies, namedLocations)', async api => {
      await list(api, '/identity/conditionalAccess/policies', { kind: 'policies' })
      await list(api, '/identity/conditionalAccess/namedLocations', { kind: 'namedLocations' })
    }),

    call('M365-12', 'Devices', async api => {
      await list(api, '/devices?$top=999')
    }),

    call('M365-13', 'SharePoint sites and drives', async api => {
      const sites = await list(api, '/sites/getAllSites?$top=999', { kind: 'sites' })
      const driveIds: string[] = []
      for (const s of sites) {
        if (!s?.id) continue
        const drives = await api.optional(`site_drives:${s.id}`, () => list(api, `/sites/${encodeURIComponent(s.id)}/drives`, { site: s.id, kind: 'drives' }))
        for (const d of drives ?? []) {
          if (d?.id) driveIds.push(d.id)
        }
      }
      state.siteDriveIds = driveIds
    }),

    call('M365-14', 'Teams (details, channels, members)', async api => {
      const teams = await list(api, `/groups?${new URLSearchParams({ $filter: "resourceProvisioningOptions/Any(x:x eq 'Team')", $select: 'id,displayName' })}`, { kind: 'team_groups' })
      const teamIds: string[] = []
      for (const t of teams) {
        if (!t?.id) continue
        teamIds.push(t.id)
        const tid = encodeURIComponent(t.id)
        await api.optional(`team:${t.id}`, () => get(api, `/teams/${tid}`, { team: t.id, kind: 'team' }))
        await api.optional(`team_channels:${t.id}`, () => list(api, `/teams/${tid}/channels`, { team: t.id, kind: 'channels' }))
        await api.optional(`team_members:${t.id}`, () => list(api, `/teams/${tid}/members`, { team: t.id, kind: 'members' }))
      }
      state.teamIds = teamIds
      state.teamsDone = true
    }),

    call('M365-15', 'Drive items and sharing permissions', async api => {
      const maxItems = config.microsoft?.maxDriveItems ?? DEFAULT_MAX_DRIVE_ITEMS
      const driveIds = new Set<string>(state.siteDriveIds)

      for (const u of state.users) {
        if (!u?.id) continue
        const drive = await api.optional(`user_drive:${u.id}`, () => get(api, `/users/${encodeURIComponent(u.id)}/drive`, { user: u.id, kind: 'user_drive' }))
        if (drive?.id) driveIds.add(drive.id)
      }

      let totalItems = 0
      let limitHit = false

      const walk = async (driveId: string, childrenPath: string, depth: number): Promise<void> => {
        if (limitHit) return
        const items = await api.optional(`drive_children:${driveId}:${depth}`, () => list(api, childrenPath, { drive: driveId, depth, kind: 'children' }))
        if (!items) return
        for (const item of items) {
          if (totalItems >= maxItems) {
            limitHit = true
            api.partial('drive_item_limit')
            return
          }
          totalItems++
          if (!item?.id) continue
          await api.optional(`item_permissions:${driveId}:${item.id}`, () =>
            list(api, `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(item.id)}/permissions`, { drive: driveId, item: item.id, kind: 'permissions' }),
          )
          if (item.folder && depth < DRIVE_DEPTH_LIMIT) {
            await walk(driveId, `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(item.id)}/children`, depth + 1)
            if (limitHit) return
          }
        }
      }

      for (const driveId of driveIds) {
        if (limitHit) break
        await walk(driveId, `/drives/${encodeURIComponent(driveId)}/root/children`, 1)
      }
    }),

    call('M365-16', 'SignIn logs', async api => {
      const stream = 'microsoft.signIns'
      const start = streamStart(api, stream, config.since)
      const rows = await list(
        api,
        buildUrl(`${GRAPH}/auditLogs/signIns`, { $filter: `createdDateTime ge ${start} and createdDateTime le ${api.period.until}` }),
        { start, until: api.period.until },
      )
      const last = maxIso(rows.map((r: any) => r?.createdDateTime))
      api.setCursor(stream, { cursor: null, last_event_at: last ?? api.cursor(stream)?.last_event_at ?? null })
    }),

    call('M365-17', 'Directory audit logs', async api => {
      const stream = 'microsoft.directoryAudits'
      const start = streamStart(api, stream, config.since)
      const rows = await list(
        api,
        buildUrl(`${GRAPH}/auditLogs/directoryAudits`, { $filter: `activityDateTime ge ${start} and activityDateTime le ${api.period.until}` }),
        { start, until: api.period.until },
      )
      const last = maxIso(rows.map((r: any) => r?.activityDateTime))
      api.setCursor(stream, { cursor: null, last_event_at: last ?? api.cursor(stream)?.last_event_at ?? null })
    }),

    call('M365-18', 'Security alerts and incidents', async api => {
      await api.optional('security_alerts_v2', () => list(api, '/security/alerts_v2', { kind: 'alerts_v2' }))
      await api.optional('security_incidents', () => list(api, '/security/incidents', { kind: 'incidents' }))
    }),

    call('M365-19', 'Cross-tenant access policy', async api => {
      await api.optional('crossTenantAccessPolicy', () => get(api, '/policies/crossTenantAccessPolicy', { kind: 'crossTenantAccessPolicy' }))
      await api.optional('crossTenantAccessPolicy_default', () => get(api, '/policies/crossTenantAccessPolicy/default', { kind: 'default' }))
      const partners = await api.optional('crossTenantAccessPolicy_partners', () => list(api, '/policies/crossTenantAccessPolicy/partners', { kind: 'partners' }))
      for (const p of partners ?? []) {
        if (!p?.tenantId) continue
        await api.optional(`crossTenantPartner_identitySync:${p.tenantId}`, () =>
          get(api, `/policies/crossTenantAccessPolicy/partners/${encodeURIComponent(p.tenantId)}/identitySynchronization`, { partner: p.tenantId, kind: 'identitySynchronization' }),
        )
      }
    }),

    call('M365-20', 'Delegated admin relationships', async api => {
      await api.optional('delegatedAdminRelationships', () => list(api, '/tenantRelationships/delegatedAdminRelationships', { kind: 'delegatedAdminRelationships' }))
    }),

    call('M365-21', 'Directory synchronization', async api => {
      await api.optional('onPremisesSynchronization', () => list(api, '/directory/onPremisesSynchronization', { kind: 'onPremisesSynchronization' }))
    }),

    call('M365-22', 'Role management policies', async api => {
      const filter = "scopeId eq '/' and scopeType eq 'DirectoryRole'"
      await api.optional('roleManagementPolicies', () =>
        list(api, buildUrl(`${GRAPH}/policies/roleManagementPolicies`, { $filter: filter, $expand: 'rules' }), { kind: 'roleManagementPolicies' }),
      )
      await api.optional('roleManagementPolicyAssignments', () =>
        list(api, buildUrl(`${GRAPH}/policies/roleManagementPolicyAssignments`, { $filter: filter }), { kind: 'roleManagementPolicyAssignments' }),
      )
    }),

    call('M365-23', 'Tenant authorization and authentication policies', async api => {
      await api.optional('authorizationPolicy', () => get(api, '/policies/authorizationPolicy', { kind: 'authorizationPolicy' }))
      await api.optional('authenticationMethodsPolicy', () => get(api, '/policies/authenticationMethodsPolicy', { kind: 'authenticationMethodsPolicy' }))
      await api.optional('securityDefaults', () => get(api, '/policies/identitySecurityDefaultsEnforcementPolicy', { kind: 'securityDefaults' }))
      const pgPolicies = await api.optional('permissionGrantPolicies', () => list(api, '/policies/permissionGrantPolicies', { kind: 'permissionGrantPolicies' }))
      for (const p of pgPolicies ?? []) {
        if (!p?.id) continue
        const pid = encodeURIComponent(p.id)
        await api.optional(`permissionGrantPolicy_includes:${p.id}`, () => list(api, `/policies/permissionGrantPolicies/${pid}/includes`, { policy: p.id, kind: 'includes' }))
        await api.optional(`permissionGrantPolicy_excludes:${p.id}`, () => list(api, `/policies/permissionGrantPolicies/${pid}/excludes`, { policy: p.id, kind: 'excludes' }))
      }
      await api.optional('adminConsentRequestPolicy', () => get(api, '/policies/adminConsentRequestPolicy', { kind: 'adminConsentRequestPolicy' }))
    }),

    call('M365-24', 'Application token and sign-in policies', async api => {
      const policyKinds = [
        'tokenLifetimePolicies',
        'tokenIssuancePolicies',
        'claimsMappingPolicies',
        'homeRealmDiscoveryPolicies',
        'activityBasedTimeoutPolicies',
      ]
      for (const policyKind of policyKinds) {
        const policies = await api.optional(policyKind, () => list(api, `/policies/${policyKind}`, { kind: policyKind }))
        for (const p of policies ?? []) {
          if (!p?.id) continue
          await api.optional(`${policyKind}_appliesTo:${p.id}`, () =>
            list(api, `/policies/${policyKind}/${encodeURIComponent(p.id)}/appliesTo`, { policy: p.id, policy_kind: policyKind, kind: 'appliesTo' }),
          )
        }
      }
    }),

    call('M365-25', 'Domain federation and certificate-based auth', async api => {
      for (const d of state.domains) {
        if (!d?.id) continue
        await api.optional(`domain_federationConfiguration:${d.id}`, () =>
          list(api, `/domains/${encodeURIComponent(d.id)}/federationConfiguration`, { domain: d.id, kind: 'federationConfiguration' }),
        )
      }
      const { tenantId } = resolveCreds()
      await api.optional('certificateBasedAuthConfiguration', () =>
        list(api, `/organization/${encodeURIComponent(tenantId)}/certificateBasedAuthConfiguration`, { kind: 'certificateBasedAuthConfiguration' }),
      )
    }, () => (state.domainsDone ? null : 'depends_on:M365-10')),

    call('M365-26', 'Teams apps and resource-specific consent', async api => {
      for (const teamId of state.teamIds) {
        const tid = encodeURIComponent(teamId)
        await api.optional(`team_installedApps:${teamId}`, () =>
          list(api, `/teams/${tid}/installedApps?$expand=teamsAppDefinition,teamsApp`, { team: teamId, kind: 'installedApps' }),
        )
        await api.optional(`team_permissionGrants:${teamId}`, () =>
          list(api, `/teams/${tid}/permissionGrants`, { team: teamId, kind: 'permissionGrants' }),
        )
      }
    }, () => (state.teamsDone ? null : 'depends_on:M365-14')),

    call('M365-27', 'Graph connectors', async api => {
      await api.optional('connections', () => list(api, '/external/connections', { kind: 'connections' }))
    }),

    call('M365-28', 'SharePoint tenant settings', async api => {
      await api.optional('sharepointSettings', () => get(api, '/admin/sharepoint/settings', { kind: 'sharepointSettings' }))
    }),

    call('M365-29', 'Mailbox rules and settings', async api => {
      const mailboxClassify: Classifier = res => {
        const code = (res.body as any)?.error?.code
        if (code === 'MailboxNotEnabledForRESTAPI' || res.status === 404) {
          return { kind: 'not_found', code: code ?? 'http_404' }
        }
        return httpClassifier(res)
      }
      const targets = state.users.slice(0, USER_CAP)
      if (state.users.length > USER_CAP) api.partial(`users_capped:${USER_CAP}`)
      for (const u of targets) {
        if (!u?.id) continue
        const uid = encodeURIComponent(u.id)
        await api.optional(`messageRules:${u.id}`, () =>
          list(api, `/users/${uid}/mailFolders/inbox/messageRules`, { user: u.id, kind: 'messageRules' }, { classify: mailboxClassify }),
        )
        await api.optional(`mailboxSettings:${u.id}`, () =>
          get(api, `/users/${uid}/mailboxSettings`, { user: u.id, kind: 'mailboxSettings' }, { classify: mailboxClassify }),
        )
      }
    }, () => (state.usersDone ? null : 'depends_on:M365-02')),

    call('M365-30', 'Directory group settings', async api => {
      await api.optional('groupSettings', () => list(api, '/groupSettings', { kind: 'groupSettings' }))
    }),

    call('M365-31', 'BitLocker and LAPS metadata', async api => {
      await api.optional('bitlockerRecoveryKeys', () =>
        list(
          api,
          '/informationProtection/bitlocker/recoveryKeys',
          { kind: 'bitlockerRecoveryKeys' },
          { headers: { ...GRAPH_HEADERS, 'ocp-client-name': 'AEGI Collector', 'ocp-client-version': '1.0' } },
        ),
      )
      await api.optional('deviceLocalCredentials', () =>
        list(api, '/directory/deviceLocalCredentials', { kind: 'deviceLocalCredentials' }),
      )
    }),

    call('M365-32', 'Authentication method registration details', async api => {
      await api.optional('userRegistrationDetails', () =>
        list(api, '/reports/authenticationMethods/userRegistrationDetails', { kind: 'userRegistrationDetails' }),
      )
    }),

    call('M365-33', 'Unified audit log (Management Activity API)', async api => {
      const { tenantId } = resolveCreds()
      const auth = getMgmtAuth()
      const contentTypes = ['Audit.AzureActiveDirectory', 'Audit.Exchange', 'Audit.SharePoint', 'Audit.General']
      const DAY_MS = 24 * 60 * 60 * 1000
      const untilMs = Date.parse(api.period.until)
      const sevenDaysAgoMs = untilMs - 7 * DAY_MS
      const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19)

      for (const ct of contentTypes) {
        const stream = `microsoft.unifiedAudit.${ct}`
        const prevCursor = api.cursor(stream)?.last_event_at ?? null
        const rawStartMs = Date.parse(streamStart(api, stream, config.since))
        let startMs = Math.max(Number.isFinite(rawStartMs) ? rawStartMs : sevenDaysAgoMs, sevenDaysAgoMs)
        const creationTimes: string[] = []
        let firstFailedStartMs: number | null = null
        const mgmtClassify: Classifier = res => {
          const code = (res.body as any)?.error?.code
          if (typeof code === 'string' && /^AF2002[23]$/.test(code)) {
            return { kind: 'partial', code: `subscription_disabled:${ct}` }
          }
          return httpClassifier(res)
        }

        while (startMs < untilMs) {
          const endMs = Math.min(startMs + DAY_MS, untilMs)
          const feedUrl = buildUrl(
            `https://manage.office.com/api/v1.0/${encodeURIComponent(tenantId)}/activity/feed/subscriptions/content`,
            {
              contentType: ct,
              startTime: fmt(startMs),
              endTime: fmt(endMs),
              PublisherIdentifier: tenantId,
            },
          )
          const blobs = await api.optional(`audit_feed:${ct}:${fmt(startMs)}`, () =>
            api.list({
              url: feedUrl,
              auth,
              paginate: { kind: 'o365-mgmt' },
              items: b => (Array.isArray(b) ? b : []),
              params: { contentType: ct, kind: 'feed', startTime: fmt(startMs), endTime: fmt(endMs) },
              classify: mgmtClassify,
            }),
          )
          if (blobs === null) {
            if (firstFailedStartMs === null) firstFailedStartMs = startMs
          } else {
            for (const blob of blobs) {
              const contentUri = blob?.contentUri
              if (typeof contentUri !== 'string' || !contentUri.startsWith('https://manage.office.com/')) continue
              const events = await api.optional(`audit_content:${ct}:${blob.contentId ?? ''}`, () =>
                api.get({
                  url: contentUri,
                  auth,
                  params: { contentType: ct, kind: 'content' },
                }),
              )
              if (events === null) {
                if (firstFailedStartMs === null) firstFailedStartMs = startMs
              } else if (Array.isArray(events)) {
                for (const ev of events) {
                  if (typeof ev?.CreationTime === 'string') creationTimes.push(ev.CreationTime)
                }
              }
            }
          }
          startMs = endMs
        }

        const last = maxIso(creationTimes)
        let nextLast: string | null
        if (firstFailedStartMs === null) {
          nextLast = last ?? prevCursor
        } else {
          const prevMs = prevCursor ? Date.parse(prevCursor) : Number.NaN
          const candidateMs = last ? Math.min(Date.parse(last), firstFailedStartMs) : prevMs
          if (Number.isFinite(candidateMs)) {
            const flooredMs = Number.isFinite(prevMs) ? Math.max(candidateMs, prevMs) : candidateMs
            nextLast = new Date(flooredMs).toISOString()
          } else {
            nextLast = prevCursor
          }
        }
        api.setCursor(stream, { cursor: null, last_event_at: nextLast })
      }
    }),

    call('M365-34', 'Domain DNS mail authentication', async api => {
      let resolver: DnsResolver
      if (ctx.dnsResolver) {
        resolver = ctx.dnsResolver
      } else {
        try {
          resolver = await import('node:dns/promises')
        } catch {
          api.partial('dns_unavailable')
          return
        }
      }

      const queryDns = async <T>(record: string, fn: () => Promise<T>, fallback: T): Promise<{ ok: true; value: T } | { ok: false }> => {
        try {
          return { ok: true, value: await fn() }
        } catch (err: any) {
          if (err?.code === 'ENODATA' || err?.code === 'ENOTFOUND') return { ok: true, value: fallback }
          const code = typeof err?.code === 'string' && err.code ? err.code : 'unknown'
          api.partial(`dns_error:${record}:${code}`)
          return { ok: false }
        }
      }

      for (const d of state.domains) {
        if (!d?.id || !d?.isVerified) continue
        const domain = d.id
        const txtRes = await queryDns('spf', () => resolver.resolveTxt(domain), [])
        if (txtRes.ok) {
          const txtRecords = txtRes.value.map(parts => parts.join(''))
          api.record({
            endpoint: `dns TXT ${domain}`,
            params: { domain, kind: 'dns', record: 'spf' },
            body: { domain, records: txtRecords, spf: txtRecords.filter(r => r.startsWith('v=spf1')) },
          })
        }

        const dmarcRes = await queryDns('dmarc', () => resolver.resolveTxt(`_dmarc.${domain}`), [])
        if (dmarcRes.ok) {
          const dmarcRecords = dmarcRes.value.map(parts => parts.join(''))
          api.record({
            endpoint: `dns TXT _dmarc.${domain}`,
            params: { domain, kind: 'dns', record: 'dmarc' },
            body: { domain, records: dmarcRecords },
          })
        }

        const sel1Res = await queryDns('dkim_selector1', () => resolver.resolveCname(`selector1._domainkey.${domain}`), [])
        if (sel1Res.ok) {
          api.record({
            endpoint: `dns CNAME selector1._domainkey.${domain}`,
            params: { domain, kind: 'dns', record: 'dkim_selector1' },
            body: { domain, targets: sel1Res.value },
          })
        }

        const sel2Res = await queryDns('dkim_selector2', () => resolver.resolveCname(`selector2._domainkey.${domain}`), [])
        if (sel2Res.ok) {
          api.record({
            endpoint: `dns CNAME selector2._domainkey.${domain}`,
            params: { domain, kind: 'dns', record: 'dkim_selector2' },
            body: { domain, targets: sel2Res.value },
          })
        }

        const mxRes = await queryDns('mx', () => resolver.resolveMx(domain), [])
        if (mxRes.ok) {
          api.record({
            endpoint: `dns MX ${domain}`,
            params: { domain, kind: 'dns', record: 'mx' },
            body: { domain, records: mxRes.value },
          })
        }
      }
    }, () => (state.domainsDone ? null : 'depends_on:M365-10')),
  ]
}
