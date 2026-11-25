/**
 * 범용 관측 — 원본에서 실행, 요청, 전송, 설정 스냅샷을 만든다.
 *
 * 관측 규칙은 바인딩이 지목한 앱, 저장소, 스크립트, 규칙, 사용자 하나가 아니라 원본에 있는 것 전부에 적용한다.
 *
 * - 봇 요청 로그(SL-12): 모든 행 → slash_request. 성공한 요청만 requested_via 로 엔드포인트와 잇고, 거부는 결과와 사유를 남긴다
 *   (거부된 다른 채널의 요청이 곧 자동화의 호출 제한을 드러낸다)
 * - 요청이 남긴 커밋, Okta 이벤트: 결과 SHA, 대상 id, 시각으로 잇는다
 * - PAT 승인(GH-13): 그 승인의 저장소에서 주인 이름으로 남은 커밋 중 자동화 요청과 이어진 것 → credential_use
 * - Apps Script(GW-09/11/12/13/14): 프로젝트마다 매니페스트, 배포, 사용자별 실행, 실행 시각의 토큰 사용.
 *   코드에 웹훅 지문이 없으면 웹훅 앱 이름 = 스크립트 이름, 웹훅 설치자 = 작성자일 때 delivered_to 를 추정으로 잇는다
 * - 봇, 웹훅이 올린 메시지(SL-05): 웹훅 지문이 같은 스크립트 또는 같은 시각의 실행 → delivery
 * - Gmail 자동 전달(GW-15): 모든 사용자의 설정
 * - Okta 그룹 규칙(OK-11), 프로필 스키마(OK-14), 감사 이벤트(OK-12): 모든 규칙, 모든 사용자, 모든 관련 이벤트
 *
 * 엔진이 읽는 속성 이름은 예전 관측과 같다.
 */
import type { EvidenceObservation, FindingEvidenceLink } from '../../../src/model/evidence'
import type { DatasetV2 } from './dataset'
import { sqliteToIso, ghKey, gwsKey, oktaKey, slackKey } from './dataset'
import type { NormalizeContext } from './context'
import { itemsOf, type RawSet } from './raw'
import type { Envelope } from '../lib/store'
import { scanOktaLog, releaseOktaLogScan } from './oktaLogScan'

/** 여러 실행의 스트림 행을 id 로 한 번씩 */
export function streamRows(raw: RawSet, provider: 'worker' | 'okta' | 'github' | 'slack' | 'gws', callId: string, key: string, itemsKey?: string): any[] {
  const seen = new Map<string, any>()
  for (const env of raw.pages(provider, callId)) for (const row of itemsOf(env, itemsKey)) if (row?.[key] !== undefined && !seen.has(String(row[key]))) seen.set(String(row[key]), row)
  return [...seen.values()]
}

/** 실행과 메시지, 요청과 Okta 이벤트를 같은 일로 보는 시각 차 */
const SAME_RUN_MS = 120_000

type Obs = Omit<EvidenceObservation, 'provenance'> & { sourceRef: string }

/** Apps Script 실행 기록 제목. processes API 가 processType 을 주지 않는 실행이 있어 빈 값은 빼고 쓴다 */
export function runTitle(processType: unknown, user: unknown): string {
  const parts = [processType, user].filter(part => part !== undefined && part !== null && String(part).trim() !== '').map(String)
  return parts.length ? `실행 (${parts.join(', ')})` : '실행'
}

export function buildObservations(raw: RawSet, ds: DatasetV2, ctx: NormalizeContext): void {
  const has = (k: string | undefined): k is string => !!k && ds.has(k)
  const existing = (keys: Array<string | undefined>) => [...new Set(keys.filter(has))]
  const seen = new Set<string>()
  const obs = (o: Obs): string | undefined => {
    if (seen.has(o.id)) return undefined
    seen.add(o.id)
    const { sourceRef, ...rest } = o
    ds.observations.push({ ...(rest as any), provenance: { record: 'measured', sourceRef } })
    return o.id
  }
  const link = (from: FindingEvidenceLink['from'], to: FindingEvidenceLink['to'], evidenceType: FindingEvidenceLink['evidenceType'], label: string, attributes?: Record<string, unknown>) => {
    const exists = (e: FindingEvidenceLink['from']) => (e.kind === 'object' ? ds.has(e.id) : seen.has(e.id))
    if (!exists(from) || !exists(to)) return
    ds.evidenceLinks.push({ id: `EVL-${String(ds.evidenceLinks.length + 1).padStart(4, '0')}`, from, to, evidenceType, label, ...(attributes ? { attributes } : {}) } as FindingEvidenceLink)
  }
  const ref = (env: Envelope) => `${env.provider}:${env.call_id}#${env.payload_sha256 || env.page}`
  const userOf = (email: unknown) => (typeof email === 'string' ? ctx.gws?.userByEmail.get(email.toLowerCase()) : undefined)
  // 이 함수 안에서는 객체를 더하거나 지우지 않는다. 종류별 목록을 한 번만 만든다(Project 마다 전체를 훑어 규모 제곱으로 느렸다)
  const byType = new Map<string, any[]>()
  for (const o of ds.objects.values()) { const t = o.canonical.object_type; if (!byType.has(t)) byType.set(t, []); byType.get(t)!.push(o) }
  const objectsOf = (type: string) => [...(byType.get(type) ?? [])]

  /* ------------------------------------------------ 봇 요청 로그 */
  const slashRows = streamRows(raw, 'worker', 'SL-12', 'id', 'results').sort((a, b) => a.id - b.id)
  const oktaLogs = scanOktaLog(raw).slashTargetRows
  const requestCommits = new Map<string, string>() // 커밋 키 → 관측 id
  for (const row of slashRows) {
    const requester = slackKey.user(row.user_id)
    const endpoint = row.api_app_id && row.command ? slackKey.endpoint(row.api_app_id, row.command) : undefined
    const channel = slackKey.channel(row.channel_id)
    const at = sqliteToIso(row.created_at)
    const sha = row.result_data?.commit_sha as string | undefined
    const commit = sha ? ghKey.commit(sha) : undefined
    const targetId = (row.result_data?.target_id ?? row.result_data?.okta_target_id) as string | undefined
    const target = targetId ? oktaKey.user(targetId) : undefined
    // 요청을 처리하며 다른 SaaS 에 남은 기록: 같은 대상, 2분 안의 Okta 이벤트.
    // 같은 대상에 사람이 남긴 이벤트(인증 수단 등록 등)도 섞이므로, 사람이 아닌 행위자(서비스 앱)의 이벤트를 먼저, 그다음 가까운 시각 순으로 고른다
    const near = targetId && at ? oktaLogs.filter(l => l.target?.some((t: any) => t.id === targetId) && Math.abs(Date.parse(l.published) - Date.parse(at)) < SAME_RUN_MS) : []
    const gap = (l: any) => Math.abs(Date.parse(l.published) - Date.parse(at!))
    const okta = near.sort((a, b) => Number(a.actor?.type === 'User') - Number(b.actor?.type === 'User') || gap(a) - gap(b))[0] as any
    const actorClient = okta?.actor?.id && okta.actor.type !== 'User' ? oktaKey.client(okta.actor.id) : undefined
    const success = row.result_status === 'success'
    const id = obs({
      id: `OBS-REQ-${row.id}`, kind: 'slash_request', title: `${row.command} 요청 (${row.user_id}, ${row.result_status})`, occurredAt: at,
      objectKeys: existing([requester, endpoint, channel, target, actorClient, commit]),
      attributes: {
        command: row.command, api_app_id: row.api_app_id, action: row.result_data?.action,
        request_channel: has(channel) ? channel : undefined, request_channel_id: row.channel_id, request_channel_name: row.channel_name,
        requester_slack_user: has(requester) ? requester : undefined, requester_slack_user_id: row.user_id,
        result: row.result_status, deny_reason: row.result_data?.reason,
        target_object: success && has(target) ? target : undefined,
        correlated_commit: has(commit) ? commit : undefined, correlated_commit_sha: sha,
        okta_event_uuid: okta?.uuid, okta_event_type: okta?.eventType, okta_actor: has(actorClient) ? actorClient : undefined,
        text: row.text, record: 'measured',
      },
      sourceRef: `worker:SL-12#${row.id}${okta ? `+okta:OK-12#${okta.uuid}` : ''}`,
    })
    if (!id) continue
    if (success && has(endpoint)) link({ kind: 'object', id: endpoint }, { kind: 'observation', id }, 'requested_via', '슬래시 명령 엔드포인트로 들어온 요청')
    if (success && has(commit)) {
      requestCommits.set(commit, id)
      link({ kind: 'observation', id }, { kind: 'object', id: commit }, 'correlates_by', '요청 결과의 커밋 SHA')
    }
    if (success && okta && has(target)) link({ kind: 'observation', id }, { kind: 'object', id: target }, 'produced', `Okta ${okta.eventType}`)
  }

  /* ------------------------------------------------ PAT 사용 */
  for (const grant of objectsOf('Organization Programmatic Access Grant')) {
    const p = grant.canonical.properties
    const ownerLogin = String(p.owner_login ?? '')
    const owner = ctx.github?.byLogin.get(ownerLogin)
    const repos = ((p.repositories as string[]) ?? []).map(String)
    const repoKeys = repos.map(r => ctx.github?.repoByName.get(r.split('/').pop() ?? '')).filter(has)
    // 자동화 요청이 만든 커밋 중 이 승인의 주인 이름으로 남은 것
    const all = [...requestCommits.keys()].filter(k => ds.get(k)?.canonical.properties.author_login === ownerLogin)
    if (!all.length) continue
    const id = obs({
      id: `OBS-CRED-${grant.fixture_key.replace(/^GH-GRANT-/, '')}`, kind: 'credential_use', title: `개인 PAT 로 한 커밋 (${ownerLogin})`,
      occurredAt: all.map(k => String(ds.get(k)!.canonical.properties.authored_at ?? '')).sort().at(-1),
      objectKeys: existing([grant.fixture_key, owner, ...repoKeys, ...all]),
      attributes: {
        credential_kind: 'github_fine_grained_pat', credential_fingerprint: `token_id:${p.token_id}`, credential_owner_object: owner, grant_object: grant.fixture_key,
        native_github_actor: owner, commits: all, requester_trace_source: 'bot_local_log_only',
        credential_link_basis: 'commit.author = grant.owner ∧ commit.sha ∈ 자동화 요청 결과', record: 'measured',
      },
      sourceRef: 'github:GH-13+GH-11+worker:SL-12',
    })
    if (id && owner) for (const k of all) link({ kind: 'object', id: k }, { kind: 'object', id: owner }, 'attributed_as', 'GitHub 에는 PAT 주인 이름으로만 남는다')
  }

  /* ------------------------------------------------ Apps Script */
  const projects = objectsOf('Project')
  const hooks = objectsOf('incoming-webhook')
  for (const project of projects) {
    const p = project.canonical.properties
    const scriptId = String((project.canonical.identifiers.id as any)?.value ?? '')
    const parentFile = p.parentId ? gwsKey.file(String(p.parentId)) : undefined
    if (has(parentFile)) link({ kind: 'object', id: parentFile }, { kind: 'object', id: project.fixture_key }, 'context_used_by', 'Apps Script 가 이 파일에 묶여 있다 (parentId)')
    const fps = ((p.webhook_url_sha256 as string[]) ?? []).map(String)
    const byFingerprint = hooks.filter(h => fps.includes(String(h.canonical.properties.webhook_url_sha256)))
    for (const hook of byFingerprint) {
      link({ kind: 'object', id: project.fixture_key }, { kind: 'object', id: hook.fixture_key }, 'delivered_to', '스크립트 코드의 웹훅 주소 지문 = 웹훅 설치의 지문')
    }
    // 웹훅 주소를 스크립트 속성에 두면 API 로 읽을 수 없어 지문이 없다. 웹훅 앱 이름이 스크립트 이름과 같고
    // 웹훅을 설치한 Slack 사용자의 이메일이 스크립트 작성자와 같으면 그 웹훅으로 보낸다고 추정한다
    if (!byFingerprint.length && p.title && p.creator) {
      const creator = String(p.creator).toLowerCase()
      for (const hook of hooks) {
        const hp = hook.canonical.properties
        const installer = hp.installed_by ? ds.get(slackKey.user(String(hp.installed_by))) : undefined
        if (String(hp.app_name ?? '') !== String(p.title) || String(installer?.canonical.properties.email ?? '').toLowerCase() !== creator) continue
        link({ kind: 'object', id: project.fixture_key }, { kind: 'object', id: hook.fixture_key }, 'delivered_to', '웹훅 앱 이름 = 스크립트 이름, 웹훅 설치자 = 스크립트 작성자로 추정', { basis: 'inferred', rule: 'same_name_same_owner' })
      }
    }
    for (const env of raw.pages('gws', 'GW-09').filter(e => e.request_params.script === scriptId && (e.payload as any)?.manifest)) {
      p.manifest = (env.payload as any).manifest
      p.code_markers = (env.payload as any).code_markers
    }
    for (const env of raw.pages('gws', 'GW-12').filter(e => e.request_params.script === scriptId && (e.payload as any)?.manifest)) {
      const versions = ((p.version_manifests as any[]) ?? []).filter(v => v.versionNumber !== env.request_params.versionNumber)
      versions.push({ versionNumber: env.request_params.versionNumber, manifest: (env.payload as any).manifest, code_markers: (env.payload as any).code_markers })
      p.version_manifests = versions.sort((a, b) => Number(a.versionNumber) - Number(b.versionNumber))
    }
    const creator = userOf(p.creator)
    for (const env of raw.pages('gws', 'GW-11').filter(e => e.request_params.script === scriptId)) {
      for (const d of itemsOf(env, 'deployments')) for (const entry of d.entryPoints ?? []) {
        if (!entry.webApp && !entry.executionApi) continue
        const config = entry.webApp?.entryPointConfig ?? entry.executionApi?.entryPointConfig ?? {}
        const deployments = ((p.deployments as any[]) ?? []).filter(x => x.deploymentId !== d.deploymentId)
        deployments.push({ deploymentId: d.deploymentId, entryPointType: entry.entryPointType, versionNumber: d.deploymentConfig?.versionNumber ?? null, updateTime: d.updateTime, ...config })
        p.deployments = deployments
        if (entry.entryPointType === 'WEB_APP' && config.executeAs) p.run_as_resolution = config.executeAs === 'USER_ACCESSING' ? 'caller' : 'static_principal'
        obs({
          id: `OBS-DEPLOY-${d.deploymentId}`, kind: 'access_snapshot', title: `배포 설정 (${entry.entryPointType})`, occurredAt: d.updateTime,
          objectKeys: existing([project.fixture_key, creator]),
          attributes: { automation: project.fixture_key, author: creator, deploymentId: d.deploymentId, entryPointType: entry.entryPointType, versionNumber: d.deploymentConfig?.versionNumber, ...config },
          sourceRef: ref(env),
        })
      }
    }
    for (const env of raw.pages('gws', 'GW-13').filter(e => e.request_params.script === scriptId)) {
      const caller = userOf(env.request_params.user)
      for (const run of itemsOf(env, 'processes')) {
        const id = obs({
          id: `OBS-RUN-${scriptId}-${env.request_params.user}-${run.startTime}`, kind: 'agent_run', title: runTitle(run.processType, env.request_params.user), occurredAt: run.startTime,
          objectKeys: existing([project.fixture_key, caller, creator]),
          attributes: { automation: project.fixture_key, author: creator, caller, functionName: run.functionName, processType: run.processType, status: run.processStatus, userAccessLevel: run.userAccessLevel, duration: run.duration },
          sourceRef: ref(env),
        })
        if (id && has(caller)) link({ kind: 'object', id: caller }, { kind: 'observation', id }, 'observed_as', '사용자별 실행 기록')
      }
    }
  }
  // 목록에 없는 스크립트의 실행 (GW-16). 사용자가 가진 Form 이 하나뿐이고 실행이 폼 제출 트리거면 그 응답 시트를 입력으로 추정한다
  for (const project of projects.filter(p => p.canonical.properties.unlisted)) {
    const p = project.canonical.properties
    const user = userOf(p.run_as_user)
    const runs = (p.executions as any[]) ?? []
    for (const run of runs) {
      obs({
        id: `OBS-RUN-${project.fixture_key.replace(/^GWS-PROJECT-/, '')}-${run.startTime}`, kind: 'agent_run', title: runTitle(run.processType, run.user), occurredAt: run.startTime,
        objectKeys: existing([project.fixture_key, user]),
        attributes: { automation: project.fixture_key, caller: user, functionName: run.functionName, processType: run.processType, status: run.processStatus, userAccessLevel: run.userAccessLevel, duration: run.duration },
        sourceRef: 'gws:GW-16',
      })
    }
    const formTriggered = runs.some(r => r.functionName === 'onFormSubmit')
    const ownForms = objectsOf('Form').filter(f => String(f.canonical.properties.owner ?? '').toLowerCase() === String(p.run_as_user ?? '').toLowerCase() && f.canonical.properties.linkedSheetId)
    if (formTriggered && ownForms.length === 1) {
      const sheet = gwsKey.file(String(ownForms[0].canonical.properties.linkedSheetId))
      if (has(sheet)) {
        p.inferred_parent_file = sheet
        p.inferred_form = ownForms[0].fixture_key
        link({ kind: 'object', id: sheet }, { kind: 'object', id: project.fixture_key }, 'context_used_by', '폼 제출 트리거로 돌고, 실행한 사용자가 가진 폼이 하나뿐이라 그 응답 시트를 입력으로 추정', { basis: 'inferred', rule: 'form_submit_trigger_single_form' })
      }
    } else if (formTriggered) ds.notes.push(`목록에 없는 스크립트 ${project.fixture_key}: 폼 제출 트리거지만 ${p.run_as_user} 의 폼이 ${ownForms.length}개라 입력 시트를 정하지 못했다`)
  }
  // 실행 시각의 토큰 사용 (GW-14). 요청 변수의 scripts 가 그 구간에 실행된 스크립트다
  for (const env of raw.pages('gws', 'GW-14')) for (const item of itemsOf(env, 'items')) {
    const caller = userOf(item.actor?.email)
    const scripts = ((env.request_params.scripts as string[]) ?? []).map(id => gwsKey.project(id)).filter(has)
    for (const [index, event] of (item.events ?? []).entries()) {
      const values = Object.fromEntries((event.parameters ?? []).map((x: any) => [x.name, x.value ?? x.intValue ?? x.multiValue]))
      obs({
        id: `OBS-TOKEN-${item.id?.uniqueQualifier ?? item.id?.time}-${index}`, kind: 'credential_use', title: '실행 시각의 토큰 사용', occurredAt: item.id?.time,
        objectKeys: existing([...scripts, caller]),
        attributes: { automation: scripts.length === 1 ? scripts[0] : undefined, candidate_automations: scripts, caller, event_name: event.name, ...values },
        sourceRef: ref(env),
      })
    }
  }

  /* ------------------------------------------------ 봇, 웹훅이 올린 메시지 */
  const runs = ds.observations.filter(o => o.kind === 'agent_run')
  const hookByAppChannel = new Map(hooks.map(h => [`${h.canonical.properties.app_id}|${h.canonical.properties.channel_id}`, h]))
  const botApp = new Map(objectsOf('bot').map(b => [String((b.canonical.identifiers.id as any)?.value), String(b.canonical.properties.app_id ?? '')]))
  for (const m of objectsOf('Message')) {
    const mp = m.canonical.properties
    const appId = String(mp.app_id ?? botApp.get(String(mp.bot_id)) ?? '')
    if (!appId) continue
    const channelId = String(mp.channel_id)
    const hook = hookByAppChannel.get(`${appId}|${channelId}`)
    const ts = Number(mp.ts) * 1000
    // 이 웹훅에 지문으로 이어진 스크립트, 없으면 같은 시각에 돈 실행
    const byFingerprint = hook ? projects.filter(pr => ((pr.canonical.properties.webhook_url_sha256 as string[]) ?? []).includes(String(hook.canonical.properties.webhook_url_sha256))) : []
    const near = runs.filter(r => Math.abs(Date.parse(r.occurredAt ?? '') - ts) < SAME_RUN_MS && r.attributes.status !== 'FAILED')
    const run = near.find(r => byFingerprint.some(pr => pr.fixture_key === r.attributes.automation)) ?? (byFingerprint.length ? undefined : near.length === 1 ? near[0] : undefined)
    const automation = byFingerprint[0]?.fixture_key ?? (run?.attributes.automation as string | undefined)
    if (!automation && !hook) continue
    const proj = automation ? ds.get(automation) : undefined
    const sourceFile = proj?.canonical.properties.parentId ? gwsKey.file(String(proj.canonical.properties.parentId)) : (proj?.canonical.properties.inferred_parent_file as string | undefined)
    const form = sourceFile ? objectsOf('Form').find(f => gwsKey.file(String(f.canonical.properties.linkedSheetId ?? '')) === sourceFile) : undefined
    const id = obs({
      id: `OBS-DELIVERY-${channelId}-${String(mp.ts).replace('.', '')}`, kind: 'delivery', title: `자동화가 올린 메시지 (${mp.ts})`, occurredAt: new Date(ts).toISOString(),
      objectKeys: existing([sourceFile, form?.fixture_key, automation, hook?.fixture_key, m.fixture_key, run ? (run.attributes.caller as string) : undefined]),
      attributes: {
        automation, source_file: has(sourceFile) ? sourceFile : undefined, source_form: form?.fixture_key, destination_endpoint: hook?.fixture_key, destination_message: m.fixture_key,
        destination_channel: slackKey.channel(channelId), caller: run?.attributes.caller,
        trigger: run?.attributes.processType === 'TRIGGER' || run?.attributes.functionName === 'onFormSubmit' ? 'form_submit' : run?.attributes.processType === 'WEBAPP' ? 'web_app' : undefined,
        matched_execution: run?.occurredAt, webhook_fingerprint_match: byFingerprint.length > 0,
        contains_source_data: byFingerprint.length > 0 || !!run, contains_source_data_basis: byFingerprint.length ? '웹훅 지문 일치' : run ? '실행과 메시지 시각 대조' : 'unknown',
        matching: byFingerprint.length ? 'webhook_fingerprint' : run ? 'execution_message_time' : 'webhook_only', record: 'measured',
      },
      sourceRef: `slack:SL-05#${mp.ts}${run ? '+gws:GW-13' : ''}`,
    })
    if (!id) continue
    if (hook) link({ kind: 'object', id: hook.fixture_key }, { kind: 'observation', id }, 'produced', 'Incoming Webhook 이 채널에 게시')
    if (run) link({ kind: 'observation', id: run.id }, { kind: 'observation', id }, 'correlates_by', '실행과 메시지의 시각 대조', { basis: byFingerprint.length ? 'confirmed' : 'inferred' })
  }

  /* ------------------------------------------------ Gmail 자동 전달 */
  const gw15 = raw.pages('gws', 'GW-15')
  for (const env of gw15.filter(e => e.request_params.kind === 'autoForwarding')) {
    const email = String(env.request_params.user ?? '').toLowerCase()
    const user = userOf(email)
    const setting = env.payload as any
    if (!user || !setting || typeof setting.enabled !== 'boolean') continue
    const addresses = gw15.filter(e => String(e.request_params.user ?? '').toLowerCase() === email && e.request_params.kind === 'forwardingAddresses').flatMap(e => itemsOf(e, 'forwardingAddresses'))
    const address = addresses.find(a => a.forwardingEmail?.toLowerCase() === setting.emailAddress?.toLowerCase())
    const attributes = { enabled: setting.enabled, emailAddress: setting.emailAddress, disposition: setting.disposition, verificationStatus: address?.verificationStatus }
    ds.get(user)!.canonical.properties.gmail_forwarding = attributes
    const fwId = obs({ id: `OBS-FORWARD-${user}`, kind: 'access_snapshot', title: 'Gmail 자동 전달 설정', occurredAt: env.collected_at, objectKeys: [user], attributes, sourceRef: ref(env) })
    if (fwId) link({ kind: 'object', id: user }, { kind: 'observation', id: fwId }, 'observed_as', '계정의 자동 전달 설정')
  }

  /* ------------------------------------------------ Okta 프로필 스키마, 그룹 규칙, 감사 이벤트 */
  const schemas = raw.pages('okta', 'OK-14').map(env => ({ env, schema: env.payload as any })).filter(x => x.schema?.definitions)
  for (const env of raw.pages('okta', 'OK-02')) for (const user of itemsOf(env)) {
    const o = ds.get(oktaKey.user(user.id))
    if (!o) continue
    const href = user._links?.schema?.href
    const found = schemas.find(s => (href && (s.schema.id === href || s.schema._links?.self?.href === href)) || (user.type?.id && s.schema._links?.type?.href?.endsWith(`/meta/types/user/${user.type.id}`)))
    o.canonical.properties.profile_schema = found?.schema.id ?? href
    if (found) {
      const props = { ...found.schema.definitions.base?.properties, ...found.schema.definitions.custom?.properties }
      o.canonical.properties.profile_attribute_permissions = Object.fromEntries(Object.entries(props).map(([name, x]) => [name, { permissions: (x as any).permissions, master: (x as any).master }]))
    }
  }
  if (raw.pages('okta', 'OK-02').length && !schemas.length) ds.notes.push('프로필 스키마(OK-14)를 못 받아 본인 편집 속성을 알 수 없다')
  for (const env of raw.pages('okta', 'OK-11')) for (const rule of itemsOf(env)) {
    const o = ds.get(oktaKey.groupRule(rule.id))
    if (!o) continue
    o.canonical.properties.expression = rule.conditions?.expression
    o.canonical.properties.excluded_users = rule.conditions?.people?.users?.exclude ?? []
    const ruleObs = obs({ id: `OBS-RULE-${rule.id}`, kind: 'access_snapshot', title: '프로필 조건에 따른 그룹 배정 설정', occurredAt: env.collected_at, objectKeys: [o.fixture_key, ...((rule.actions?.assignUserToGroups?.groupIds ?? []) as string[]).map(id => oktaKey.group(id)).filter(has)], attributes: { expression: rule.conditions?.expression, status: rule.status, assign_groups: rule.actions?.assignUserToGroups?.groupIds ?? [] }, sourceRef: ref(env) })
    if (ruleObs) {
      link({ kind: 'object', id: o.fixture_key }, { kind: 'observation', id: ruleObs }, 'observed_as', '켜져 있는 그룹 규칙의 조건')
      for (const g of (rule.actions?.assignUserToGroups?.groupIds ?? []) as string[]) if (has(oktaKey.group(g))) link({ kind: 'observation', id: ruleObs }, { kind: 'object', id: oktaKey.group(g) }, 'produced', '규칙이 이 그룹에 사람을 넣는다')
    }
  }
  const scan = scanOktaLog(raw)
  const keyOfTarget = (t: any) => (t.type === 'AppInstance' ? oktaKey.app(t.id) : t.type === 'UserGroup' ? oktaKey.group(t.id) : t.type === 'User' ? oktaKey.user(t.id) : undefined)
  for (const { env, event } of scan.auditEvents) {
    const actor = event.actor?.type === 'User' ? oktaKey.user(event.actor.id) : event.actor?.id ? oktaKey.client(event.actor.id) : undefined
    obs({
      id: `OBS-EVENT-${event.uuid}`, kind: 'audit_event', title: event.eventType, occurredAt: event.published,
      objectKeys: existing([actor, ...(event.target ?? []).map(keyOfTarget)]),
      attributes: { event_type: event.eventType, actor_id: event.actor?.id, actor_type: event.actor?.type, actor_object: has(actor) ? actor : undefined, result: event.outcome?.result, target_ids: (event.target ?? []).map((t: any) => t.id), changed_attributes: event.debugContext?.debugData?.changedAttributes },
      sourceRef: ref(env),
    })
  }

  /* ------------------------------------------------ 권한 설정 스냅샷 (피해범위 증적) */
  // 피해범위는 설정만으로 성립한다. 판정에 쓴 설정(토큰 scope, 관리자 역할, 앱 배정)을 수집 기록으로 남겨 증적으로 보인다
  const oktaOrg = objectsOf('org').find(o => o.canonical.provider === 'okta')?.fixture_key
  for (const env of raw.pages('okta', 'OK-09').filter(e => e.request_params.client)) {
    const user = oktaKey.user(String(env.request_params.user))
    for (const t of itemsOf(env)) {
      const token = oktaKey.refreshToken(t.id)
      if (!has(token)) continue
      const clientId = String(t.clientId ?? env.request_params.client)
      obs({
        id: `OBS-OKTA-TOKEN-${t.id}`, kind: 'access_snapshot', title: 'Okta 앱 토큰 발급 설정', occurredAt: t.created ?? env.collected_at,
        objectKeys: existing([token, user, oktaKey.app(clientId)]),
        attributes: { token_id: t.id, client_id: clientId, user: env.request_params.user, status: t.status, scopes: t.scopes, created: t.created, expiresAt: t.expiresAt },
        sourceRef: ref(env),
      })
    }
  }
  for (const env of raw.pages('okta', 'OK-06')) {
    const p = env.request_params
    const holder = p.user ? oktaKey.user(String(p.user)) : p.group ? oktaKey.group(String(p.group)) : undefined
    if (!has(holder) || /\/targets\//.test(env.endpoint)) continue
    for (const r of itemsOf(env)) {
      if (!r?.type) continue
      obs({
        id: `OBS-OKTA-ROLE-${r.id ?? `${holder}-${r.type}`}`, kind: 'access_snapshot', title: 'Okta 관리자 역할 배정', occurredAt: r.created ?? env.collected_at,
        objectKeys: existing([holder, oktaOrg]),
        attributes: { role: r.type === 'CUSTOM' ? r.label ?? r.role : r.type, assignment_type: r.assignmentType, status: r.status, holder: p.user ?? p.group },
        sourceRef: ref(env),
      })
    }
  }
  for (const env of raw.pages('okta', 'OK-07').filter(e => e.request_params.app && !/\/groups(\?|$)/.test(e.endpoint))) {
    const appId = String(env.request_params.app)
    for (const x of itemsOf(env)) {
      obs({
        id: `OBS-OKTA-APPUSER-${appId}-${x.id}`, kind: 'access_snapshot', title: 'Okta 앱 배정', occurredAt: x.created ?? env.collected_at,
        objectKeys: existing([oktaKey.user(x.id), oktaKey.app(appId), oktaKey.appUser(appId, x.id)]),
        attributes: { app: appId, user: x.id, userName: x.credentials?.userName, scope: x.scope, status: x.status, externalId: x.externalId ?? null },
        sourceRef: ref(env),
      })
    }
  }
  const gwsCustomer = objectsOf('Customer').find(o => o.canonical.provider === 'gws')?.fixture_key
  const gwsUserById = new Map(objectsOf('User').filter(o => o.canonical.provider === 'gws').map(o => [String((o.canonical.identifiers.id as any)?.value), o.fixture_key]))
  for (const env of raw.pages('gws', 'GW-06').filter(e => e.request_params.kind === 'roleassignments')) {
    for (const a of itemsOf(env, 'items')) {
      const user = gwsUserById.get(String(a.assignedTo))
      if (!user) continue
      obs({
        id: `OBS-GWS-ROLE-${a.roleAssignmentId}`, kind: 'access_snapshot', title: 'Google Workspace 관리자 역할 배정', occurredAt: env.collected_at,
        objectKeys: existing([user, gwsCustomer]),
        attributes: { roleId: a.roleId, assignedTo: a.assignedTo, scopeType: a.scopeType, orgUnitId: a.orgUnitId },
        sourceRef: ref(env),
      })
    }
  }
  // 역할 배정 목록을 못 읽은 수집에서는 사용자 목록의 관리자 표시가 근거다 (gws.ts 의 _SEED_ADMIN_ROLE 대체와 같은 근거)
  if (!raw.pages('gws', 'GW-06').some(e => e.request_params.kind === 'roleassignments')) {
    for (const env of raw.pages('gws', 'GW-03')) for (const u of itemsOf(env, 'users')) {
      const user = gwsKey.user(u.id)
      if (!has(user) || (!u.isAdmin && !u.isDelegatedAdmin)) continue
      obs({
        id: `OBS-GWS-ADMIN-${u.id}`, kind: 'access_snapshot', title: 'Google Workspace 관리자 표시', occurredAt: env.collected_at,
        objectKeys: existing([user, gwsCustomer]),
        attributes: { primaryEmail: u.primaryEmail, isAdmin: u.isAdmin, isDelegatedAdmin: u.isDelegatedAdmin },
        sourceRef: ref(env),
      })
    }
  }
  // 토큰 발급, 사용, 폐기 이벤트 (OK-12): 수집한 리프레시 토큰을 대상으로 한 것만. 액세스 토큰 id 끝에 리프레시 토큰 id 가 붙는다
  const tokenOf = (t: any): string | undefined => {
    const id = String(t?.id ?? '')
    if (t?.type === 'refresh_token') return oktaKey.refreshToken(id)
    if (t?.type === 'access_token') return oktaKey.refreshToken(id.split('.').pop() ?? '')
    return undefined
  }
  for (const { env, event } of scan.tokenEvents) {
    const tokens = existing((event.target ?? []).map(tokenOf))
    if (!tokens.length) continue
    const user = (event.target ?? []).find((t: any) => t.type === 'User')
    const title = event.eventType.includes('revoke') ? '토큰 폐기' : event.eventType.endsWith('refresh_token') ? '리프레시 토큰 발급' : '토큰 사용 (액세스 토큰 발급)'
    obs({
      id: `OBS-EVENT-${event.uuid}`, kind: 'audit_event', title, occurredAt: event.published,
      objectKeys: existing([...tokens, user ? oktaKey.user(user.id) : undefined]),
      attributes: { event_type: event.eventType, actor_id: event.actor?.id, actor_type: event.actor?.type, result: event.outcome?.result, target_ids: (event.target ?? []).map((t: any) => t.id), granted_scopes: event.debugContext?.debugData?.grantedScopes, ip: event.client?.ipAddress },
      sourceRef: ref(env),
    })
  }
  // OK-12 를 쓰는 마지막 자리다. 모아 둔 행을 놓는다
  releaseOktaLogScan(raw)
}
