import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapRow } from '../mapper.ts'
import { EntityResolver } from '../resolver.ts'
import { datasetRelations } from '../matchReport.ts'

export interface IdentityRef {
  key: string
  providerId: string
  name: string
}

export interface ChannelRef {
  key: string
  providerId: string
  name: string
  teamId: string
}

export interface FlowRef {
  key: string
  providerId: string
  name: string
  activeVersionId: string
  apiName: string
}

export interface PersonaRef {
  okta: IdentityRef
  salesforce: IdentityRef
  slack: IdentityRef
  gws: IdentityRef
}

export interface UcKeys {
  snapshotId: string
  uc1: {
    report: { key: string; providerId: string; name: string }
    opportunities: Array<{ key: string; providerId: string; name: string }>
    permissionSet: { key: string; providerId: string; name: string }
    flow: FlowRef
    flowSlackAction: { key: string; providerId: string; name: string }
    slackApp: { key: string; providerId: string; name: string }
    channel: ChannelRef
    leaver: PersonaRef
    flowOwner: PersonaRef
    salesTeam: PersonaRef[]
    personalGmail: { key: string; providerId: string; name: string }
    deliveries: string[]
  }
}

export interface DemoHecEvent {
  time: number
  index: 'aegi_demo'
  sourcetype: 'sfdc:setupaudittrail' | 'slack:audit' | 'okta:im2:log' | 'gws:reports:activity'
  source: 'aegi-demo:uc'
  host: 'aegi-demo'
  event: Record<string, unknown>
}

export function createRng(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0
  }
  let s = (h ^ 0xdeadbeef) >>> 0
  return function next(): number {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function assertSafePath(targetPath: string, repoRoot: string, allowExampleKeys = false): void {
  const abs = path.resolve(targetPath)
  const rel = path.relative(repoRoot, abs)
  const isInsideRepo = !rel.startsWith('..') && !path.isAbsolute(rel)
  if (isInsideRepo) {
    const isCollected = rel === 'collected' || rel.startsWith('collected' + path.sep) || rel.startsWith('collected/')
    const isExample = allowExampleKeys && abs === path.resolve(repoRoot, 'scripts/stream/splunk/demo/uc.keys.example.json')
    if (!isCollected && !isExample) {
      throw new Error(`Path ${targetPath} inside repo is forbidden outside collected/`)
    }
  }
}

function formatSfDate(timeMs: number): string {
  return new Date(timeMs).toISOString().replace('Z', '+0000')
}

export function generateDemoEvents(keys: UcKeys, baseIso: string, seed = 'uc1'): DemoHecEvent[] {
  const rng = createRng(seed)
  const baseMs = Date.parse(baseIso)
  if (!Number.isFinite(baseMs)) throw new Error(`Invalid base timestamp: ${baseIso}`)

  const randInt = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min
  const randHex = (len: number) => {
    let out = ''
    while (out.length < len) out += Math.floor(rng() * 16).toString(16)
    return out.slice(0, len)
  }
  const randDigits = (len: number) => {
    let out = ''
    while (out.length < len) out += Math.floor(rng() * 10).toString(10)
    return out.slice(0, len)
  }

  // Working-hours clock (KST 09:00-19:00 -> UTC 00:00-10:00)
  function calcTime(daysAgo: number, kstHour: number, minute: number, second: number): number {
    const target = new Date(baseMs - daysAgo * 86_400_000)
    const y = target.getUTCFullYear()
    const m = target.getUTCMonth()
    const d = target.getUTCDate()
    const utcHour = kstHour - 9
    return Date.UTC(y, m, d, utcHour, minute, second)
  }

  const events: DemoHecEvent[] = []

  // Derived identities and constants
  const salesOps = keys.uc1.flowOwner
  const leaver = keys.uc1.leaver
  const primarySeller = keys.uc1.salesTeam[0] ?? keys.uc1.flowOwner
  const slackTeam = keys.uc1.channel.teamId
  const slackDomain = 'aegidemo'
  const gwsCustomerId = 'C0aegidemo'
  const permSetLabel = keys.uc1.permissionSet.name
  const permSetLicenseLabel = 'Salesforce'
  const endDateAttribute = 'employmentEndDate'
  const reportFileName = `${keys.uc1.report.name}.xlsx`
  const reportSlackFileId = `F0DEMO${randHex(8).toUpperCase()}`
  const reportGwsDocId = `1DEMOUPLOAD${randHex(10)}`
  const noiseChannel = { id: `C0DEMO${randHex(6).toUpperCase()}`, name: 'general' }

  // 1. Exactly base - 42 days: Salesforce Flow created by salesOps (flowOwner)
  const flowCreateTime = baseMs - 42 * 86_400_000
  const flowId1 = randHex(15)
  events.push({
    time: flowCreateTime / 1000,
    index: 'aegi_demo',
    sourcetype: 'sfdc:setupaudittrail',
    source: 'aegi-demo:uc',
    host: 'aegi-demo',
    event: {
      Id: `0Ym${flowId1}`,
      Action: 'createdinteractiondefinition',
      Section: 'Flows',
      Display: `플로 정의 저장됨. 고유 이름이 "${keys.uc1.flow.apiName}"`,
      CreatedDate: formatSfDate(flowCreateTime),
      CreatedById: salesOps.salesforce.providerId,
      CreatedBy: { Username: salesOps.salesforce.name },
      DelegateUser: null,
      attributes: { type: 'SetupAuditTrail', url: `/services/data/v60.0/sobjects/SetupAuditTrail/0Ym${flowId1}` },
    },
  })

  // 2. Exactly base - 42 days: Slack app_installed by salesOps
  // In array order, createdinteractiondefinition precedes app_installed for identical timestamps
  const appInstallTime = baseMs - 42 * 86_400_000
  events.push({
    time: appInstallTime / 1000,
    index: 'aegi_demo',
    sourcetype: 'slack:audit',
    source: 'aegi-demo:uc',
    host: 'aegi-demo',
    event: {
      id: `sl-${randHex(12)}`,
      date_create: Math.floor(appInstallTime / 1000),
      action: 'app_installed',
      actor: {
        type: 'user',
        user: { id: salesOps.slack.providerId, name: salesOps.slack.name, email: salesOps.slack.name, team: slackTeam },
      },
      entity: {
        type: 'app',
        app: { id: keys.uc1.slackApp.providerId, name: keys.uc1.slackApp.name },
      },
      context: {
        location: { type: 'workspace', id: slackTeam, name: slackDomain, domain: slackDomain },
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        ip_address: `203.0.113.${randInt(10, 50)}`,
        session_id: randInt(10000, 99999),
      },
      details: { scopes: ['incoming-webhook'] },
    },
  })

  // 3. Flow activated: createdinteractiondefinition + 5m + (10~40s, seed rng)
  const flowActivateTime = flowCreateTime + (5 * 60 + randInt(10, 40)) * 1000
  const flowId2 = randHex(15)
  events.push({
    time: flowActivateTime / 1000,
    index: 'aegi_demo',
    sourcetype: 'sfdc:setupaudittrail',
    source: 'aegi-demo:uc',
    host: 'aegi-demo',
    event: {
      Id: `0Ym${flowId2}`,
      Action: 'activatedinteractiondefversion',
      Section: 'Flows',
      Display: `플로 버전 1이 활성화되었습니다. 고유 이름 "${keys.uc1.flow.apiName}"`,
      CreatedDate: formatSfDate(flowActivateTime),
      CreatedById: salesOps.salesforce.providerId,
      CreatedBy: { Username: salesOps.salesforce.name },
      DelegateUser: null,
      attributes: { type: 'SetupAuditTrail', url: `/services/data/v60.0/sobjects/SetupAuditTrail/0Ym${flowId2}` },
    },
  })

  // 4. 3 weeks ago (21 days): Okta user.account.update_profile on leaver
  const profileUpdateTime = calcTime(21, 11, randInt(20, 40), randInt(0, 59))
  events.push({
    time: profileUpdateTime / 1000,
    index: 'aegi_demo',
    sourcetype: 'okta:im2:log',
    source: 'aegi-demo:uc',
    host: 'aegi-demo',
    event: {
      uuid: `okta-${randHex(16)}`,
      published: new Date(profileUpdateTime).toISOString(),
      eventType: 'user.account.update_profile',
      displayMessage: 'Update user profile',
      actor: { id: salesOps.okta.providerId, type: 'User', alternateId: salesOps.okta.name, displayName: salesOps.okta.name },
      target: [{ id: leaver.okta.providerId, type: 'User', alternateId: leaver.okta.name, displayName: leaver.okta.name }],
      client: { ipAddress: `203.0.113.${randInt(10, 50)}`, userAgent: { rawUserAgent: 'Mozilla/5.0' } },
      outcome: { result: 'SUCCESS' },
      authenticationContext: { rootSessionId: `sess-${randHex(10)}` },
      transaction: { id: `tx-${randHex(10)}` },
      debugContext: { debugData: { changedAttributes: endDateAttribute } },
    },
  })

  // 5. Exactly base - 14 days: Salesforce PermSetUnassign and PermSetLicenseUnassign (+2m + 5~30s)
  const permSetTime = baseMs - 14 * 86_400_000
  const sfId3 = randHex(15)
  events.push({
    time: permSetTime / 1000,
    index: 'aegi_demo',
    sourcetype: 'sfdc:setupaudittrail',
    source: 'aegi-demo:uc',
    host: 'aegi-demo',
    event: {
      Id: `0Ym${sfId3}`,
      Action: 'PermSetUnassign',
      Section: 'Manage Users',
      Display: `권한 집합 ${permSetLabel}: 사용자 ${leaver.salesforce.providerId}에서 할당 해제됨`,
      CreatedDate: formatSfDate(permSetTime),
      CreatedById: salesOps.salesforce.providerId,
      CreatedBy: { Username: salesOps.salesforce.name },
      DelegateUser: null,
      attributes: { type: 'SetupAuditTrail', url: `/services/data/v60.0/sobjects/SetupAuditTrail/0Ym${sfId3}` },
    },
  })

  const permLicenseTime = permSetTime + (2 * 60 + randInt(5, 30)) * 1000
  const sfId4 = randHex(15)
  events.push({
    time: permLicenseTime / 1000,
    index: 'aegi_demo',
    sourcetype: 'sfdc:setupaudittrail',
    source: 'aegi-demo:uc',
    host: 'aegi-demo',
    event: {
      Id: `0Ym${sfId4}`,
      Action: 'PermSetLicenseUnassign',
      Section: 'Manage Users',
      Display: `권한 집합 라이선스 ${permSetLicenseLabel}: 사용자 ${leaver.salesforce.providerId}에서 할당 해제됨`,
      CreatedDate: formatSfDate(permLicenseTime),
      CreatedById: salesOps.salesforce.providerId,
      CreatedBy: { Username: salesOps.salesforce.name },
      DelegateUser: null,
      attributes: { type: 'SetupAuditTrail', url: `/services/data/v60.0/sobjects/SetupAuditTrail/0Ym${sfId4}` },
    },
  })

  // 6. 2 weeks .. 2 days ago: Slack user_login by leaver, 6 times
  const loginDays = [12, 10, 8, 6, 4, 3]
  for (const day of loginDays) {
    const loginTime = calcTime(day, randInt(10, 16), randInt(0, 59), randInt(0, 59))
    events.push({
      time: loginTime / 1000,
      index: 'aegi_demo',
      sourcetype: 'slack:audit',
      source: 'aegi-demo:uc',
      host: 'aegi-demo',
      event: {
        id: `sl-${randHex(12)}`,
        date_create: Math.floor(loginTime / 1000),
        action: 'user_login',
        actor: {
          type: 'user',
          user: { id: leaver.slack.providerId, name: leaver.slack.name, email: leaver.slack.name, team: slackTeam },
        },
        entity: {
          type: 'user',
          user: { id: leaver.slack.providerId, name: leaver.slack.name, email: leaver.slack.name },
        },
        context: {
          location: { type: 'workspace', id: slackTeam, name: slackDomain, domain: slackDomain },
          ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          ip_address: `198.51.100.${randInt(10, 80)}`,
          session_id: randInt(10000, 99999),
        },
        details: {},
      },
    })
  }

  // 7. 2 days ago: Slack file_downloaded by leaver (reportFile + 2 other files)
  const downloadBaseTime = calcTime(2, 15, randInt(10, 20), randInt(0, 59))
  const filesToDownload = [
    { id: reportSlackFileId, name: reportFileName },
    { id: `F0DEMO${randHex(6).toUpperCase()}`, name: 'deal-notes-1.csv' },
    { id: `F0DEMO${randHex(6).toUpperCase()}`, name: 'deal-notes-2.csv' },
  ]
  for (let idx = 0; idx < filesToDownload.length; idx++) {
    const f = filesToDownload[idx]!
    const fileTime = downloadBaseTime + (idx * 180 + randInt(10, 40)) * 1000
    events.push({
      time: fileTime / 1000,
      index: 'aegi_demo',
      sourcetype: 'slack:audit',
      source: 'aegi-demo:uc',
      host: 'aegi-demo',
      event: {
        id: `sl-${randHex(12)}`,
        date_create: Math.floor(fileTime / 1000),
        action: 'file_downloaded',
        actor: {
          type: 'user',
          user: { id: leaver.slack.providerId, name: leaver.slack.name, email: leaver.slack.name, team: slackTeam },
        },
        entity: {
          type: 'file',
          file: { id: f.id, name: f.name, filetype: f.name.endsWith('.xlsx') ? 'xlsx' : 'csv', title: f.name },
        },
        context: {
          location: { type: 'workspace', id: slackTeam, name: slackDomain, domain: slackDomain },
          ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          ip_address: `198.51.100.${randInt(10, 80)}`,
          session_id: randInt(10000, 99999),
        },
        details: {},
      },
    })
  }

  // 8. 1 day ago: GWS drive upload by leaver, then within 10 min change_user_access
  const uploadTime = calcTime(1, 16, randInt(5, 15), randInt(0, 59))
  events.push({
    time: uploadTime / 1000,
    index: 'aegi_demo',
    sourcetype: 'gws:reports:activity',
    source: 'aegi-demo:uc',
    host: 'aegi-demo',
    event: {
      kind: 'admin#reports#activity',
      id: {
        time: new Date(uploadTime).toISOString(),
        uniqueQualifier: randDigits(10),
        applicationName: 'drive',
        customerId: gwsCustomerId,
      },
      actor: { callerType: 'USER', email: leaver.gws.name, profileId: leaver.gws.providerId },
      ipAddress: `198.51.100.${randInt(10, 80)}`,
      events: [
        {
          type: 'drive',
          name: 'upload',
          parameters: [
            { name: 'doc_id', value: reportGwsDocId },
            { name: 'doc_title', value: reportFileName },
            { name: 'doc_type', value: 'spreadsheet' },
            { name: 'owner', value: leaver.gws.name },
          ],
        },
      ],
    },
  })

  const accessChangeTime = uploadTime + (6 * 60 + randInt(10, 45)) * 1000
  events.push({
    time: accessChangeTime / 1000,
    index: 'aegi_demo',
    sourcetype: 'gws:reports:activity',
    source: 'aegi-demo:uc',
    host: 'aegi-demo',
    event: {
      kind: 'admin#reports#activity',
      id: {
        time: new Date(accessChangeTime).toISOString(),
        uniqueQualifier: randDigits(10),
        applicationName: 'drive',
        customerId: gwsCustomerId,
      },
      actor: { callerType: 'USER', email: leaver.gws.name, profileId: leaver.gws.providerId },
      ipAddress: `198.51.100.${randInt(10, 80)}`,
      events: [
        {
          type: 'drive',
          name: 'change_user_access',
          parameters: [
            { name: 'doc_id', value: reportGwsDocId },
            { name: 'doc_title', value: reportFileName },
            { name: 'doc_type', value: 'spreadsheet' },
            { name: 'target_user', value: keys.uc1.personalGmail.providerId },
            { name: 'old_value', multiValue: ['none'] },
            { name: 'new_value', multiValue: ['can_edit'] },
            { name: 'visibility', value: 'shared_externally' },
          ],
        },
      ],
    },
  })

  // 9. Noise: ~5x scenario events spread over 41..1 days ago
  for (let day = 41; day >= 1; day--) {
    // Okta session start for seller
    if (day % 2 === 0) {
      const oktaTime = calcTime(day, 9, randInt(10, 50), randInt(0, 59))
      events.push({
        time: oktaTime / 1000,
        index: 'aegi_demo',
        sourcetype: 'okta:im2:log',
        source: 'aegi-demo:uc',
        host: 'aegi-demo',
        event: {
          uuid: `okta-${randHex(16)}`,
          published: new Date(oktaTime).toISOString(),
          eventType: 'user.session.start',
          displayMessage: 'User login to Okta',
          actor: { id: primarySeller.okta.providerId, type: 'User', alternateId: primarySeller.okta.name, displayName: primarySeller.okta.name },
          target: [{ id: primarySeller.okta.providerId, type: 'User', alternateId: primarySeller.okta.name, displayName: primarySeller.okta.name }],
          client: { ipAddress: `203.0.113.${randInt(10, 80)}`, userAgent: { rawUserAgent: 'Mozilla/5.0' } },
          outcome: { result: 'SUCCESS' },
          authenticationContext: { rootSessionId: `sess-${randHex(10)}` },
          transaction: { id: 'unknown' },
          debugContext: { debugData: {} },
        },
      })
    }

    // Slack login for seller
    if (day % 2 === 1) {
      const slackTime = calcTime(day, 9, randInt(15, 55), randInt(0, 59))
      events.push({
        time: slackTime / 1000,
        index: 'aegi_demo',
        sourcetype: 'slack:audit',
        source: 'aegi-demo:uc',
        host: 'aegi-demo',
        event: {
          id: `sl-${randHex(12)}`,
          date_create: Math.floor(slackTime / 1000),
          action: 'user_login',
          actor: { type: 'user', user: { id: primarySeller.slack.providerId, name: primarySeller.slack.name, email: primarySeller.slack.name, team: slackTeam } },
          entity: { type: 'user', user: { id: primarySeller.slack.providerId, name: primarySeller.slack.name, email: primarySeller.slack.name } },
          context: {
            location: { type: 'workspace', id: slackTeam, name: slackDomain, domain: slackDomain },
            ua: 'Mozilla/5.0',
            ip_address: `203.0.113.${randInt(10, 80)}`,
            session_id: randInt(10000, 99999),
          },
          details: {},
        },
      })
    }

    // GWS login success
    const gwsLoginTime = calcTime(day, 10, randInt(5, 30), randInt(0, 59))
    events.push({
      time: gwsLoginTime / 1000,
      index: 'aegi_demo',
      sourcetype: 'gws:reports:activity',
      source: 'aegi-demo:uc',
      host: 'aegi-demo',
      event: {
        kind: 'admin#reports#activity',
        id: {
          time: new Date(gwsLoginTime).toISOString(),
          uniqueQualifier: randDigits(10),
          applicationName: 'login',
          customerId: gwsCustomerId,
        },
        actor: { callerType: 'USER', email: primarySeller.gws.name, profileId: primarySeller.gws.providerId },
        ipAddress: `203.0.113.${randInt(10, 80)}`,
        events: [{ type: 'login', name: 'login_success', parameters: [] }],
      },
    })

    // Occasional Slack channel join into noiseChannel
    if (day === 35 || day === 20) {
      const joinTime = calcTime(day, 14, randInt(10, 30), randInt(0, 59))
      events.push({
        time: joinTime / 1000,
        index: 'aegi_demo',
        sourcetype: 'slack:audit',
        source: 'aegi-demo:uc',
        host: 'aegi-demo',
        event: {
          id: `sl-${randHex(12)}`,
          date_create: Math.floor(joinTime / 1000),
          action: 'user_channel_join',
          actor: { type: 'user', user: { id: primarySeller.slack.providerId, name: primarySeller.slack.name, email: primarySeller.slack.name, team: slackTeam } },
          entity: { type: 'channel', channel: { id: noiseChannel.id, name: noiseChannel.name } },
          context: {
            location: { type: 'workspace', id: slackTeam, name: slackDomain, domain: slackDomain },
            ua: 'Mozilla/5.0',
            ip_address: `203.0.113.${randInt(10, 80)}`,
            session_id: randInt(10000, 99999),
          },
          details: {},
        },
      })
    }

    // Occasional Salesforce setup change by salesOps
    if (day === 30 || day === 18 || day === 7) {
      const sfTime = calcTime(day, 15, randInt(10, 40), randInt(0, 59))
      const noiseSfId = randHex(15)
      events.push({
        time: sfTime / 1000,
        index: 'aegi_demo',
        sourcetype: 'sfdc:setupaudittrail',
        source: 'aegi-demo:uc',
        host: 'aegi-demo',
        event: {
          Id: `0Ym${noiseSfId}`,
          Action: 'PasswordReset',
          Section: 'Security Controls',
          Display: `사용자 ${primarySeller.salesforce.providerId} 비밀번호 재설정됨`,
          CreatedDate: formatSfDate(sfTime),
          CreatedById: salesOps.salesforce.providerId,
          CreatedBy: { Username: salesOps.salesforce.name },
          DelegateUser: null,
          attributes: { type: 'SetupAuditTrail', url: `/services/data/v60.0/sobjects/SetupAuditTrail/0Ym${noiseSfId}` },
        },
      })
    }
  }

  // Sort strictly by time ascending (stable sort preserves insertion order for identical times)
  events.sort((a, b) => a.time - b.time)
  return events
}

export interface TimeCheck {
  name: string
  expected: string | null
  actual: string | null
  ok: boolean
}

export interface SummaryOutput {
  events: number
  bySourcetype: Record<string, number>
  byAction: Record<string, number>
  range: { from: string; to: string }
  mappingErrors: number
  resolved?: Record<string, number>
  timeChecks?: TimeCheck[]
}

export function summarizeEvents(
  events: DemoHecEvent[],
  datasetDir?: string,
  keys?: UcKeys,
): SummaryOutput {
  const bySourcetype: Record<string, number> = {}
  const byAction: Record<string, number> = {}

  for (const e of events) {
    bySourcetype[e.sourcetype] = (bySourcetype[e.sourcetype] ?? 0) + 1
    const raw = e.event
    let action = 'unknown'
    if (e.sourcetype === 'slack:audit') action = String(raw.action ?? 'unknown')
    else if (e.sourcetype === 'okta:im2:log') action = String(raw.eventType ?? 'unknown')
    else if (e.sourcetype === 'sfdc:setupaudittrail') action = String(raw.Action ?? 'unknown')
    else if (e.sourcetype === 'gws:reports:activity') {
      const app = (raw.id as any)?.applicationName ?? 'unknown'
      const child = ((raw.events as any[]) ?? [])[0]?.name ?? 'unknown'
      action = `${app}:${child}`
    }
    byAction[action] = (byAction[action] ?? 0) + 1
  }

  let resolver: EntityResolver | null = null
  let roleKeys: Record<string, Set<string>> | null = null
  let datasetObjects: any[] = []

  if (datasetDir && fs.existsSync(datasetDir) && keys) {
    const objectsPath = path.join(datasetDir, 'objects.json')
    const relPath = path.join(datasetDir, 'relations.json')
    if (fs.existsSync(objectsPath)) {
      datasetObjects = JSON.parse(fs.readFileSync(objectsPath, 'utf8'))
      const relations = fs.existsSync(relPath) ? datasetRelations(datasetDir) : []
      resolver = new EntityResolver(datasetObjects, [], { relations })

      roleKeys = {
        'uc1.leaver': new Set([
          keys.uc1.leaver.slack.key,
          keys.uc1.leaver.salesforce.key,
          keys.uc1.leaver.okta.key,
          keys.uc1.leaver.gws.key,
        ]),
        'uc1.flow': new Set([keys.uc1.flow.key]),
        'uc1.channel': new Set([keys.uc1.channel.key]),
        'uc1.permissionSet': new Set([keys.uc1.permissionSet.key]),
        'uc1.slackApp': new Set([keys.uc1.slackApp.key]),
        'uc1.salesOps': new Set([
          keys.uc1.flowOwner.slack.key,
          keys.uc1.flowOwner.salesforce.key,
          keys.uc1.flowOwner.okta.key,
          keys.uc1.flowOwner.gws.key,
        ]),
      }
    }
  }

  const dummyResolver = resolver ?? new EntityResolver([])
  let mappingErrors = 0
  const resolvedCounts: Record<string, number> = roleKeys
    ? Object.fromEntries(Object.keys(roleKeys).map(k => [k, 0]))
    : {}

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    const row = { _raw: JSON.stringify(e.event) }
    const meta = { index: e.index, sourcetype: e.sourcetype, sid: 'demo', offset: i, tenant: 'aegi_demo', receivedAt: '' }
    const mapped = mapRow(row, meta, dummyResolver)
    if (mapped.error) mappingErrors++

    if (roleKeys) {
      for (const ne of mapped.events) {
        const allKeys = new Set<string>()
        if (ne.actor?.object_key) allKeys.add(ne.actor.object_key)
        for (const t of ne.targets) if (t.object_key) allKeys.add(t.object_key)

        for (const [role, keySet] of Object.entries(roleKeys)) {
          for (const k of allKeys) {
            if (keySet.has(k)) {
              resolvedCounts[role] = (resolvedCounts[role] ?? 0) + 1
              break
            }
          }
        }
      }
    }
  }

  const times = events.map(e => e.time)
  const minTime = times.length ? Math.min(...times) : 0
  const maxTime = times.length ? Math.max(...times) : 0

  const summary: SummaryOutput = {
    events: events.length,
    bySourcetype,
    byAction,
    range: {
      from: new Date(minTime * 1000).toISOString(),
      to: new Date(maxTime * 1000).toISOString(),
    },
    mappingErrors,
  }

  if (roleKeys) {
    summary.resolved = resolvedCounts
  }

  if (datasetDir) {
    if (datasetObjects.length === 0 && fs.existsSync(path.join(datasetDir, 'objects.json'))) {
      try {
        datasetObjects = JSON.parse(fs.readFileSync(path.join(datasetDir, 'objects.json'), 'utf8'))
      } catch {
        datasetObjects = []
      }
    }

    const obsPath = path.join(datasetDir, 'observations.json')
    let datasetObservations: any[] = []
    if (fs.existsSync(obsPath)) {
      try {
        datasetObservations = JSON.parse(fs.readFileSync(obsPath, 'utf8'))
      } catch {
        datasetObservations = []
      }
    }

    function extractProp(obj: any, propName: string): string | null {
      if (!obj) return null
      const raw = obj.canonical?.properties?.[propName] ?? obj.properties?.[propName]
      if (raw == null) return null
      if (typeof raw === 'object' && 'value' in raw) {
        return raw.value != null ? String(raw.value) : null
      }
      return String(raw)
    }

    function findObject(key?: string): any {
      if (!key || !Array.isArray(datasetObjects)) return undefined
      return datasetObjects.find((o: any) => o.fixture_key === key || o.key === key)
    }

    const flowCreateEvent = events.find(
      e => e.sourcetype === 'sfdc:setupaudittrail' && e.event?.Action === 'createdinteractiondefinition'
    )
    const appInstallEvent = events.find(
      e => e.sourcetype === 'slack:audit' && e.event?.action === 'app_installed'
    )
    const permSetEvent = events.find(
      e => e.sourcetype === 'sfdc:setupaudittrail' && e.event?.Action === 'PermSetUnassign'
    )

    // 1. flow_created
    const flowObj = findObject(keys?.uc1.flow.key)
    const expectedFlowCreated = extractProp(flowObj, 'CreatedDate')
    const actualFlowCreated = flowCreateEvent ? new Date(flowCreateEvent.time * 1000).toISOString() : null
    const okFlowCreated = expectedFlowCreated != null && actualFlowCreated != null &&
      Date.parse(expectedFlowCreated) === Date.parse(actualFlowCreated)

    // 2. app_installed
    const slackAppObj = findObject(keys?.uc1.slackApp.key)
    const expectedAppInstalled = extractProp(slackAppObj, 'installed_at')
    const actualAppInstalled = appInstallEvent ? new Date(appInstallEvent.time * 1000).toISOString() : null
    const okAppInstalled = expectedAppInstalled != null && actualAppInstalled != null &&
      Date.parse(expectedAppInstalled) === Date.parse(actualAppInstalled)

    // 3. leaver_deactivated
    const leaverSfObj = findObject(keys?.uc1.leaver.salesforce.key)
    const expectedLeaverDeactivated = extractProp(leaverSfObj, 'DeactivatedDate')
    const actualLeaverDeactivated = permSetEvent ? new Date(permSetEvent.time * 1000).toISOString() : null
    const okLeaverDeactivated = expectedLeaverDeactivated != null && actualLeaverDeactivated != null &&
      Date.parse(expectedLeaverDeactivated) === Date.parse(actualLeaverDeactivated)

    // 4. flow_before_first_delivery
    let earliestDelivery: string | null = null
    let earliestDeliveryMs = Infinity
    if (keys && Array.isArray(datasetObservations)) {
      for (const obs of datasetObservations) {
        if (obs?.kind === 'delivery' && Array.isArray(obs.objectKeys) && obs.objectKeys.includes(keys.uc1.flow.key)) {
          const rawAt = obs.occurredAt
          const atStr = rawAt != null && typeof rawAt === 'object' && 'value' in rawAt ? String(rawAt.value) : (rawAt != null ? String(rawAt) : null)
          if (atStr) {
            const ms = Date.parse(atStr)
            if (Number.isFinite(ms) && ms < earliestDeliveryMs) {
              earliestDeliveryMs = ms
              earliestDelivery = atStr
            }
          }
        }
      }
    }
    const expectedDelivery = earliestDelivery
    const actualDelivery = actualFlowCreated
    const okDelivery = expectedDelivery != null && actualDelivery != null &&
      Date.parse(actualDelivery) < Date.parse(expectedDelivery)

    summary.timeChecks = [
      { name: 'flow_created', expected: expectedFlowCreated, actual: actualFlowCreated, ok: okFlowCreated },
      { name: 'app_installed', expected: expectedAppInstalled, actual: actualAppInstalled, ok: okAppInstalled },
      { name: 'leaver_deactivated', expected: expectedLeaverDeactivated, actual: actualLeaverDeactivated, ok: okLeaverDeactivated },
      { name: 'flow_before_first_delivery', expected: expectedDelivery, actual: actualDelivery, ok: okDelivery },
    ]
  }

  return summary
}

export interface DemoEventsCliArgs {
  keysPath: string
  outPath: string
  baseIso: string
  seed: string
  datasetDir?: string
}

export function parseCliArgs(argv: string[]): DemoEventsCliArgs {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--now') {
      throw new Error('--now 는 없어졌습니다. --base <스냅샷 base created_at> 를 쓰세요')
    }
  }

  let keysPath = ''
  let outPath = ''
  let baseIso: string | undefined
  let seed = 'uc1'
  let datasetDir: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--keys' && argv[i + 1]) {
      keysPath = argv[++i]!
    } else if (arg === '--out' && argv[i + 1]) {
      outPath = argv[++i]!
    } else if (arg === '--base' && argv[i + 1]) {
      baseIso = argv[++i]!
    } else if (arg === '--seed' && argv[i + 1]) {
      seed = argv[++i]!
    } else if (arg === '--dataset' && argv[i + 1]) {
      datasetDir = argv[++i]!
    }
  }

  if (!keysPath || !outPath || (!baseIso && !datasetDir)) {
    throw new Error('Usage: splunk:demo-events --keys <keys.json> --out <file.jsonl> [--base <ISO>] [--dataset <folder>] [--seed <text>]')
  }

  if (datasetDir) {
    const manifestPath = path.join(datasetDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Dataset manifest not found: ${manifestPath}`)
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const manifestCreatedAt = manifest.created_at
    if (!manifestCreatedAt) {
      throw new Error(`Dataset manifest missing created_at: ${manifestPath}`)
    }

    if (!baseIso) {
      baseIso = manifestCreatedAt
    } else if (baseIso !== manifestCreatedAt && Date.parse(baseIso) !== Date.parse(manifestCreatedAt)) {
      throw new Error(`--base (${baseIso}) 와 --dataset manifest.created_at (${manifestCreatedAt}) 이 다릅니다`)
    }
  }

  return { keysPath, outPath, baseIso: baseIso!, seed, datasetDir }
}

export function runCli(argv = process.argv.slice(2)): void {
  let parsed: DemoEventsCliArgs
  try {
    parsed = parseCliArgs(argv)
  } catch (err: any) {
    console.error(err.message)
    process.exit(1)
  }

  const { keysPath, outPath, baseIso, seed, datasetDir } = parsed
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
  assertSafePath(keysPath, repoRoot, true)
  assertSafePath(outPath, repoRoot)
  if (datasetDir) assertSafePath(datasetDir, repoRoot)

  const keys: UcKeys = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
  const events = generateDemoEvents(keys, baseIso, seed)

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
  const content = events.map(e => JSON.stringify(e)).join('\n') + '\n'
  fs.writeFileSync(outPath, content, 'utf8')

  const summary = summarizeEvents(events, datasetDir, keys)
  console.log(JSON.stringify(summary, null, 2))

  if (summary.timeChecks && summary.timeChecks.some(tc => !tc.ok)) {
    process.exit(1)
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  runCli()
}
