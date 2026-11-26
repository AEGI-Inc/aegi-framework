import { buildUrl, CallError, type CallApi, type CallDef } from '../lib/runner'
import { m365ClientCredentialsAuth, TokenError } from '../lib/auth'
import type { Auth } from '../lib/http'
import { missingCredential } from '../config'
import { maxIso, streamStart, type ProviderContext } from './common'

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

  const getAuth = (): Auth => {
    if (cachedAuth) return cachedAuth
    const parsed = parseM365Creds(creds.require('m365/collector-app.json'))
    const tenantId = parsed.tenantId || config.microsoft?.tenantId || ''
    if (!tenantId) throw new TokenError('M365 tenantId 가 없다')
    cachedAuth = m365ClientCredentialsAuth({
      ref: 'CRED-M365-01',
      tenantId,
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      transport,
    })
    return cachedAuth
  }

  const state = {
    users: [] as Array<{ id: string }>,
    usersDone: false,
    siteDriveIds: [] as string[],
  }

  const unavailable = () =>
    missingCredential(creds, 'CRED-M365-01') ??
    (!config.microsoft ? 'config_missing:microsoft' : !config.microsoft.tenantId ? 'config_missing:microsoft.tenantId' : null)

  const url = (path: string) => (path.startsWith('http') ? path : `${GRAPH}${path}`)

  const get = (api: CallApi, path: string, params: Record<string, unknown> = {}, extra: object = {}) =>
    api.get({ ...extra, url: url(path), auth: getAuth(), headers: GRAPH_HEADERS, params })

  const list = (api: CallApi, path: string, params: Record<string, unknown> = {}, extra: object = {}) =>
    api.list({ ...extra, url: url(path), auth: getAuth(), headers: GRAPH_HEADERS, paginate: { kind: 'graph' }, items: b => b?.value ?? [], params })

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

    call('M365-05', 'Applications (owners)', async api => {
      const apps = await list(api, '/applications?$top=999', { kind: 'applications' })
      for (const a of apps) {
        if (!a?.id) continue
        const aid = encodeURIComponent(a.id)
        await api.optional(`app_owners:${a.id}`, () => list(api, `/applications/${aid}/owners?$select=id`, { app: a.id, kind: 'owners' }))
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
      await list(api, '/domains', { kind: 'domains' })
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
      for (const t of teams) {
        if (!t?.id) continue
        const tid = encodeURIComponent(t.id)
        await api.optional(`team:${t.id}`, () => get(api, `/teams/${tid}`, { team: t.id, kind: 'team' }))
        await api.optional(`team_channels:${t.id}`, () => list(api, `/teams/${tid}/channels`, { team: t.id, kind: 'channels' }))
        await api.optional(`team_members:${t.id}`, () => list(api, `/teams/${tid}/members`, { team: t.id, kind: 'members' }))
      }
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
  ]
}
