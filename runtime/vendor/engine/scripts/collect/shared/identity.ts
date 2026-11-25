/**
 * Identity Link v2 (Link_Schema_v3 기준).
 *
 * 저장 모양은 옛 v1 정규화와 같다 — 사람 하나 = 집합 하나(`set`). 다른 점은 셋이다.
 * - 간선마다 level·rule·matched_on 을 `meta.edges` 에 남긴다. 집합의 `level` 은 가장 약한 간선의 level 이다
 *   (v1 은 집합에 level 하나만 있어 Slack 이메일 하나 때문에 GWS 외래키 연결까지 candidate 로 내려갔다)
 * - level 어휘는 Link_Schema_v3 다섯 단계: disclosed_relation · resolved · possibly_same · possibly_related · different
 * - 허브(Okta)를 거쳐서만 잇는다. Slack ↔ GitHub 을 직접 잇지 않는다
 *
 * 같은 사람(M1 · M2 · M3)과 같은 자동화(M4) Link, SaaS 를 넘는 관계는 개념 사전 crosswalk.yaml 의 키 종류와 칸 표시대로 crosswalk.ts 가
 * 만든다. 간선의 rule 은 키 종류 이름이다 (vendor_foreign_key · federated_subject · natural_key · log_correlation).
 * 여기서 직접 만드는 것은 그룹 Link 뿐이다 — v1 규칙 그대로 (Okta Group Push). crosswalk.yaml open.group_push 가 미결이라
 * meta.schema_level_open 을 표시한다.
 *
 * 그룹 (D-22, 2026-09-28): Okta Group Push 로 Okta 그룹이 Slack IdP 그룹으로 복제된 것을 한 링크로 묶는다
 * (meta.kind = 'group'). '같은 사람' 이 아니라 '같은 그룹' 이다. 관계는 새로 만들지 않는다(D-13).
 *   resolved   OK-13 매핑 id → OK-12 group_push 이벤트의 AppGroup → 그 AppGroup 의 alternateId = Slack 그룹 id
 *              (매핑 API 의 targetGroupId 는 Okta APP_GROUP 이라 Slack id 가 없다 — V-15)
 *   resolved   OK-12 Slack → Okta 그룹 가져오기 이벤트에 Okta 그룹과 AppGroup(alternateId = Slack id) 이 함께 있을 때
 *   candidate  매핑은 있는데 로그에 Slack id 가 없을 때(System Log 는 90일 보존): Okta 그룹 이름 = Slack 그룹 이름(하나뿐일 때)
 */
import type { IdentityLink } from '../../../src/model/link'
import type { NormalizeContext } from './context'
import type { RawSet } from './raw'
import { itemsOf } from './raw'
import type { Dataset, DatasetV2 } from './dataset'
import { oktaKey, slackKey } from './dataset'
import { scanOktaLog } from './oktaLogScan'
import { buildCrosswalkLinks } from './crosswalk'

type Level = IdentityLink['level']
export interface LinkEdge {
  a: string
  b: string
  level: Level
  rule: string
  /** 근거 세기 — crosswalk.yaml 키 종류의 tier (범례 groundtruth/connection-rules/legend.yaml) */
  tier?: string
  matched_on: string[]
  /** 공용으로 보이는 주소(admin@ 같은 것, 한 SaaS 안 여러 계정)로 이었다. 판정은 그대로다 (crosswalk.yaml email_match, 2026-11-03) */
  shared_mailbox_suspected?: boolean
  /** 주소 허브가 이었다 — 디렉터리(IdP · 메일 디렉터리) 확인 없이 같은 주소라서 (crosswalk.yaml hubs role address, 2026-11-14) */
  hub?: 'address'
  valid_from?: string
  note?: string
}

/** Okta 그룹 ↔ Slack IdP 그룹 (Group Push). 위 머리 주석의 '그룹' 참조 */
export function buildGroupLinks(ds: Dataset, raw: RawSet): void {
  // Okta 의 Slack 앱(앱 이름 'slack'). 이벤트·매핑의 앱 id 를 객체 키로 바꿔 대조한다
  const slackAppKeys = new Set([...ds.objects.values()]
    .filter(o => o.canonical.provider === 'okta' && o.canonical.object_type === 'Application' && o.canonical.properties.name === 'slack')
    .map(o => o.fixture_key))
  const isSlackApp = (appId: unknown) => slackAppKeys.has(oktaKey.app(String(appId)))
  const targetsOf = (e: any, type: string): any[] => (e?.target ?? []).filter((t: any) => t?.type === type)

  // System Log: AppGroup → Slack 그룹 id, 매핑 → AppGroup, 가져오기(Okta 그룹 ↔ AppGroup)
  const slackIdOf = new Map<string, { id: string; eventId: string }>()
  const appGroupOf = new Map<string, { id: string; eventId: string }>()
  const imports: Array<{ oktaGroup: string; appGroup: string; eventId: string }> = []
  for (const e of [...scanOktaLog(raw).appGroupRows].sort((a, b) => String(a.published).localeCompare(String(b.published)))) {
    if (!targetsOf(e, 'AppInstance').some(t => isSlackApp(t.id))) continue
    const appGroup = targetsOf(e, 'AppGroup')[0]
    if (!appGroup?.id) continue
    if (/^S[A-Z0-9]+$/.test(String(appGroup.alternateId ?? ''))) slackIdOf.set(appGroup.id, { id: appGroup.alternateId, eventId: `${e.eventType}#${e.uuid}` })
    const mapping = targetsOf(e, 'GroupPushMapping')[0]
    if (mapping?.id) appGroupOf.set(mapping.id, { id: appGroup.id, eventId: `${e.eventType}#${e.uuid}` })
    const userGroup = targetsOf(e, 'UserGroup')[0]
    if (e.eventType === 'app.user_management.user_group_import.upsert_success' && userGroup?.id) imports.push({ oktaGroup: userGroup.id, appGroup: appGroup.id, eventId: `${e.eventType}#${e.uuid}` })
  }

  const slackGroupsByName = new Map<string, string[]>()
  for (const o of ds.objects.values()) {
    if (o.canonical.provider !== 'slack' || o.canonical.object_type !== 'usergroup') continue
    const name = String(o.canonical.properties.name ?? '').toLowerCase()
    if (name) slackGroupsByName.set(name, [...(slackGroupsByName.get(name) ?? []), o.fixture_key])
  }
  const linked = new Set<string>()
  const push = (linkId: string, members: string[], level: IdentityLink['level'], basis: string, name: string, slackName: string, sync: 'push' | 'import' = 'push') => {
    const set = [...new Set(members)].filter(k => ds.has(k)).map(k => ({ provider: ds.get(k)!.canonical.provider, object_key: k }))
    if (set.length < 2 || !set.some(m => m.provider === 'slack')) return false
    ds.links.push({ link_id: linkId, set, level, source: { method: 'deterministic_rule', view_version: 1, basis }, meta: { person_name: name, display_name: sync === 'push' ? `${name} → Slack ${slackName}` : `Slack ${slackName} → ${name}`, kind: 'group', sync } })
    for (const m of set) linked.add(m.object_key)
    return true
  }

  // OK-13 Group Push 매핑
  for (const env of raw.pages('okta', 'OK-13')) {
    if (!isSlackApp(env.request_params.app)) continue
    for (const m of itemsOf(env)) {
      const source = oktaKey.group(String(m.sourceGroupId))
      const target = m.targetGroupId ? oktaKey.group(String(m.targetGroupId)) : undefined
      const name = String(ds.get(source)?.canonical.properties.name ?? m.sourceGroupId)
      const appGroup = appGroupOf.get(m.id)
      const slackId = appGroup ? slackIdOf.get(appGroup.id) : undefined
      if (slackId && ds.has(slackKey.usergroup(slackId.id))) {
        const slackGroup = slackKey.usergroup(slackId.id)
        push(`LNK-GRP-${m.id}`, [source, ...(target ? [target] : []), slackGroup], 'resolved',
          `okta:OK-13 group-push mapping ${m.id} (source ${m.sourceGroupId}); okta:OK-12 ${appGroup!.eventId} → AppGroup ${appGroup!.id}; okta:OK-12 ${slackId.eventId} AppGroup.alternateId = slack ${slackId.id}`,
          name, String(ds.get(slackGroup)?.canonical.properties.name ?? slackId.id))
        continue
      }
      const byName = slackGroupsByName.get(name.toLowerCase()) ?? []
      if (byName.length === 1) {
        push(`LNK-GRP-${m.id}`, [source, ...(target ? [target] : []), byName[0]], 'candidate',
          `okta:OK-13 group-push mapping ${m.id}; okta:OK-12 에 Slack 그룹 id 가 없어(90일 보존) 이름 일치로만 잇는다: okta group name = slack usergroup name`,
          name, String(ds.get(byName[0])?.canonical.properties.name ?? byName[0]))
        continue
      }
      ds.notes.push(`Identity Link: Okta Group Push ${m.id}(${name}) 의 Slack 그룹을 찾지 못했다 (System Log 에 id 없음, 이름 일치 ${byName.length}건)`)
    }
  }

  // Slack → Okta 그룹 가져오기
  for (const { oktaGroup, appGroup, eventId } of imports) {
    const okta = oktaKey.group(oktaGroup)
    const slackId = slackIdOf.get(appGroup)
    if (!slackId || linked.has(okta)) continue
    const slackGroup = slackKey.usergroup(slackId.id)
    const name = String(ds.get(okta)?.canonical.properties.name ?? oktaGroup)
    if (!push(`LNK-GRP-IMPORT-${oktaGroup}`, [okta, slackGroup], 'resolved', `okta:OK-12 ${eventId} UserGroup ${oktaGroup} + AppGroup.alternateId = slack ${slackId.id}`, name, String(ds.get(slackGroup)?.canonical.properties.name ?? slackId.id), 'import')) {
      ds.notes.push(`Identity Link: Slack 에서 가져온 Okta 그룹 ${name} 의 Slack 그룹 ${slackId.id} 객체가 없다 (SL-06·SL-11·SL-15 에 안 나옴)`)
    }
  }
}

export function buildIdentityLinksV2(ds: DatasetV2, ctx: NormalizeContext, raw: RawSet): void {
  buildGroupLinks(ds, raw)
  for (const l of ds.links) if (l.meta?.kind === 'group') l.meta = { ...l.meta, schema_level_open: 'Link_Schema_v3 미결 — 벤더 매핑이지만 Slack 쪽 키가 끊겨 단계를 못 정한다' }
  if (!ctx.okta) ds.notes.push('Identity Link v2: Okta 사용자가 없어 사람 링크를 만들지 않았다 (허브가 Okta 다)')
  buildCrosswalkLinks(ds, ctx, raw)
}
