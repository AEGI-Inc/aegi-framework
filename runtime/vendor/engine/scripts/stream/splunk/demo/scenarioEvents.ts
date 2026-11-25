/**
 * 공개 데모 /opsbot 과 CI 토큰 시나리오의 Splunk 데모 이벤트. Event Board 시연이 읽는 원본 이벤트다.
 * 파일의 index 는 aegi_demo 지만 Splunk 에 그 색인이 없어, 보낼 때 운영 색인으로 바꾼다(docs/SPLUNK_QUERY_GATEWAY.md 「공개 데모 Gateway」).
 *
 * - 시각은 시나리오 데이터셋(scripts/demo/publicDemoScenarios.ts 로 만든 것)의 관측 시각을 그대로 쓴다. 엔진 기록과 Event Board 가 같은 순간을 가리킨다.
 * - 이벤트 모양은 ucEvents.ts(UC1)와 같은 원본 형식이다: Okta System Log, GitHub 감사 로그.
 * - 이 스크립트는 파일(collected/ 아래 jsonl)만 쓴다. Splunk 로 보내는 일은 사람이 지시할 때 따로 한다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRng, assertSafePath, summarizeEvents, type DemoHecEvent } from './ucEvents.ts'
import { ID, PEOPLE } from '../../../demo/publicDemoScenarios.ts'
import { DOMAIN } from '../../../demo/publicDemoUc1.ts'

export interface ScenarioEvent extends Omit<DemoHecEvent, 'sourcetype'> {
  sourcetype: DemoHecEvent['sourcetype'] | 'github:cloud:audit'
}

interface Obs { id: string; occurredAt: string; attributes: Record<string, unknown> }

const GH_ORG_LOGIN = 'aegi-site-r1-org'
const mail = (p: { first: string; last: string }) => `${p.first}.${p.last}@${DOMAIN}`.toLowerCase()

export function generateScenarioEvents(observations: Obs[], baseIso: string, seed = 'scenarios'): ScenarioEvent[] {
  const rng = createRng(seed)
  const baseMs = Date.parse(baseIso)
  if (!Number.isFinite(baseMs)) throw new Error(`Invalid base timestamp: ${baseIso}`)
  const hex = (len: number) => { let s = ''; while (s.length < len) s += Math.floor(rng() * 16).toString(16); return s.slice(0, len) }
  const digits = (len: number) => { let s = ''; while (s.length < len) s += Math.floor(rng() * 10).toString(10); return s.slice(0, len) }
  const obs = (id: string) => {
    const o = observations.find(x => x.id === id)
    if (!o) throw new Error(`데이터셋에 관측 ${id} 가 없다. publicDemoScenarios.ts 로 만든 데이터셋을 넘긴다`)
    return o
  }
  const at = (o: Obs, plusSec = 0) => Date.parse(o.occurredAt) + plusSec * 1000
  const events: ScenarioEvent[] = []
  const push = (time: number, sourcetype: ScenarioEvent['sourcetype'], event: Record<string, unknown>) =>
    events.push({ time: time / 1000, index: 'aegi_demo', sourcetype, source: 'aegi-demo:uc', host: 'aegi-demo', event })

  const okta = (time: number, eventType: string, displayMessage: string, actor: Record<string, unknown>, target: Record<string, unknown>[], debugData?: Record<string, unknown>) =>
    push(time, 'okta:im2:log', {
      uuid: `okta-${hex(16)}`, published: new Date(time).toISOString(), eventType, displayMessage, actor, target,
      client: { ipAddress: `203.0.113.${10 + Math.floor(rng() * 40)}`, userAgent: { rawUserAgent: actor.type === 'User' ? 'Mozilla/5.0' : 'Okta' } },
      outcome: { result: 'SUCCESS' }, transaction: { id: `tx-${hex(10)}` },
      ...(debugData ? { debugContext: { debugData } } : {}),
    })
  const oktaUser = (p: { okta: string; first: string; last: string }) => ({ id: p.okta, type: 'User', alternateId: mail(p), displayName: `${p.first} ${p.last}` })
  const github = (time: number, action: string, actor: { id: number; login: string }, repo: { id: number; name: string }, extra: Record<string, unknown> = {}) =>
    push(time, 'github:cloud:audit', {
      '@timestamp': time, _document_id: `demo-${hex(20)}`, action, actor: actor.login, actor_id: actor.id,
      org: GH_ORG_LOGIN, repo: `${GH_ORG_LOGIN}/${repo.name}`, repo_id: repo.id, actor_ip: `198.51.100.${10 + Math.floor(rng() * 70)}`, ...extra,
    })

  // --- 시나리오 2: /opsbot 요청마다 PAT 주인 이름으로 남은 git.push. Slack 감사 로그에는 슬래시 명령 요청자가 남지 않는다(요청 기록은 봇 로그)
  const { seojin } = PEOPLE
  for (const n of [1, 2, 3]) {
    const o = obs(`OBS-REQ-DEMO-S2-${n}`)
    const commit = ID.s2.commits[n - 1]!
    github(at(o, 20 + Math.floor(rng() * 20)), 'git.push', seojin.github, { id: ID.s2.repo, name: ID.s2.repoName }, {
      programmatic_access_type: 'Fine-grained personal access token', token_id: ID.s2.pat, hashed_token: hex(44),
      ref: 'refs/heads/main', after: commit.sha,
    })
  }

  // --- 시나리오 4: 저장소 쓰기 권한자 계정으로 워크플로 파일을 고친 push, 워크플로 실행, 그 토큰(최고 관리자 명의)으로 한 Okta 관리 작업
  const { haeun, minseo } = PEOPLE
  const t0 = baseMs - 2 * 86_400_000 + 3 * 3_600_000 + Math.floor(rng() * 1_800_000)
  const repo = { id: ID.s4.repo, name: ID.s4.repoName }
  github(t0, 'git.push', haeun.github, repo, { ref: 'refs/heads/main', after: hex(40), changed_paths: [`.github/workflows/${ID.s4.workflowName}.yml`] })
  github(t0 + 95_000, 'workflows.completed_workflow_run', haeun.github, repo, {
    workflow_id: ID.s4.workflow, name: ID.s4.workflowName, event: 'push', conclusion: 'success', run_number: Number(digits(3)),
  })
  okta(t0 + 140_000, 'user.account.privilege.grant', 'Grant user privilege', oktaUser(minseo), [oktaUser(haeun)], { privilegeGranted: 'SUPER_ADMIN' })

  return events.sort((a, b) => a.time - b.time)
}

function main() {
  const argv = process.argv.slice(2)
  const value = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const dataset = value('--dataset'), out = value('--out')
  if (!dataset || !out) throw new Error('사용: npx tsx scripts/stream/splunk/demo/scenarioEvents.ts --dataset collected/<시나리오 데이터셋> --out collected/<파일>.jsonl')
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
  assertSafePath(dataset, repoRoot)
  assertSafePath(out, repoRoot)
  const manifest = JSON.parse(fs.readFileSync(path.join(dataset, 'manifest.json'), 'utf8'))
  if (!manifest.demo_scenarios_overlay) throw new Error('시나리오 2~4 합성이 없는 데이터셋이다')
  const observations = JSON.parse(fs.readFileSync(path.join(dataset, 'observations.json'), 'utf8'))
  const events = generateScenarioEvents(observations, manifest.created_at)
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(out, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  const summary = summarizeEvents(events as DemoHecEvent[])
  console.log(JSON.stringify({ events: summary.events, bySourcetype: summary.bySourcetype, byAction: summary.byAction, range: summary.range, mappingErrors: summary.mappingErrors }, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
