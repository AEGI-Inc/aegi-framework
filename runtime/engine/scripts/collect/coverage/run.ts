/**
 * SaaS 연결 개요 — 연결한 SaaS 마다 「무엇이 있고, 무엇을 알고, 무엇을 모르는지」를 한 번에 보인다.
 *
 *   npm run collect:coverage -- [--raw collected-generic] [--dataset src/data/aegi_inc_measured_v2]
 *
 * 1. 규격 대비 수집 범위 (catalogCoverage): 규격 종류마다 수집함, 0개, 권한 부족, 수집 안 함
 * 2. 감사 로그 감지 (auditKinds): 수집 목록 밖의 종류가 바뀌었는지
 *
 * 데이터셋 폴더에 collection_coverage.json(화면용)과 collection-coverage.md(사람용)를 쓴다.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { RawSet } from '../shared/raw'
import { catalogCoverage, INTERFACE_PRIORITY, type CoverageStatus, type ProviderCoverage } from './catalogCoverage'
import { auditKinds, type AuditKind } from './auditKinds'

const ROOT = path.resolve(import.meta.dirname, '../../..')

export interface CollectionCoverageFile {
  format: 'aegi-collection-coverage/v1'
  generated_at: string
  providers: ProviderCoverage[]
  audit: AuditKind[]
}

const PROVIDER_LABEL: Record<string, string> = { okta: 'Okta', gws: 'Google Workspace', slack: 'Slack', github: 'GitHub' }
const STATUS_LABEL: Record<CoverageStatus, string> = { collected: '수집함', absorbed: '다른 객체에 담아 수집', basic: '있음 (기본 정보만)', empty: '수집함, 0개', blocked: '권한, 설정으로 못 받음', not_collected: '수집 안 함', no_api: 'API 없음' }
const ALERT_LABEL = { uncollected: '수집하지 않는 종류가 바뀌었다', blocked: '못 받는 종류가 바뀌었다', unknown: '규격에 맞출 수 없는 종류' }
const RISKY = new Set(['Integration', 'Endpoint', 'Automation', 'Credential'])

export function renderMarkdown(file: CollectionCoverageFile): string {
  const L: string[] = ['# SaaS 연결 개요', '', `만든 시각 ${file.generated_at}`, '']
  L.push('| SaaS | 테넌트 | 객체 | 규격 종류 | 수집함 | 기본 정보만 | 0개 | 못 받음 | 수집 안 함 | 감사 로그 경보 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const p of file.providers) {
    const alerts = file.audit.filter(a => a.provider === p.provider && a.alert).length
    L.push(`| ${PROVIDER_LABEL[p.provider]} | ${p.tenant ?? '-'} | ${p.objects} | ${p.catalogTypes} | ${p.counts.collected + p.counts.absorbed} | ${p.counts.basic} | ${p.counts.empty} | ${p.counts.blocked} | ${p.counts.not_collected + p.counts.no_api} | ${alerts} |`)
  }
  for (const p of file.providers) {
    L.push('', `## ${PROVIDER_LABEL[p.provider]}${p.tenant ? ` (${p.tenant})` : ''}`, '')
    L.push('| 인터페이스 | 규격 종류 | 수집하는 종류 | 객체 |', '| --- | --- | --- | --- |')
    for (const i of INTERFACE_PRIORITY) {
      const row = p.byInterface[i]
      if (row) L.push(`| ${i} | ${row.types} | ${row.collected} | ${row.objects} |`)
    }
    L.push('', '### 아는 것', '')
    for (const t of p.types.filter(x => x.status === 'collected' || x.status === 'absorbed' || x.status === 'basic' || x.status === 'empty')) {
      L.push(`- ${t.name} [${t.interfaces.join(', ')}] ${t.status === 'absorbed' ? `→ ${t.absorbedAs}` : t.status === 'basic' ? `${t.count}개 (존재 확인, 기본 정보만)` : `${t.count}개`} (${t.calls.map(c => `${c.call_id} ${c.completeness}`).join(', ') || '-'})`)
    }
    const blocked = p.types.filter(x => x.status === 'blocked')
    if (blocked.length) {
      L.push('', '### 수집하려 했지만 못 받은 것 (있는지 없는지 모름)', '')
      for (const t of blocked) L.push(`- ${t.name} [${t.interfaces.join(', ')}] — ${t.calls.map(c => `${c.call_id} ${c.completeness}${c.reasons.length ? ` (${c.reasons.slice(0, 2).join('; ')})` : ''}`).join(', ')}`)
    }
    const gaps = p.types.filter(x => x.status === 'not_collected')
    const risky = gaps.filter(t => t.interfaces.some(i => RISKY.has(i)))
    L.push('', `### 수집하지 않는 종류 ${gaps.length}개 (연동, 엔드포인트, 자동화, 자격증명 ${risky.length}개를 먼저)`, '')
    const presence = (t: (typeof gaps)[number]) => !t.probe ? '존재 확인 안 함' : t.probe.result === 'found' ? (t.probe.count ? `있음 ${t.probe.count}개` : '없음 (0개 확인)') : t.probe.result === 'not_found' ? '없음 (기능 꺼짐)' : `못 봄 (${t.probe.result}${t.probe.needs ? `, 필요: ${t.probe.needs}` : ''})`
    for (const t of risky) L.push(`- **${t.name}** [${t.interfaces.join(', ')}] — ${presence(t)}`)
    for (const t of gaps.filter(x => !risky.includes(x) && x.probe)) L.push(`- ${t.name} [${t.interfaces.join(', ')}] — ${presence(t)}`)
    const rest = gaps.filter(t => !risky.includes(t) && !t.probe)
    if (rest.length) L.push(`- 그 밖 ${rest.length}개: ${rest.map(t => t.name).join(', ')}`)
  }
  L.push('', '## 더 보려면 필요한 권한', '', '존재 확인이 권한 때문에 막힌 종류다. 아래 권한을 수집 자격증명에 더하면 다음 수집에서 보인다.', '')
  for (const p of file.providers) {
    const byNeed = new Map<string, string[]>()
    for (const t of p.types) if (t.probe?.needs && t.probe.result !== 'found' && t.probe.result !== 'not_found') byNeed.set(t.probe.needs, [...(byNeed.get(t.probe.needs) ?? []), t.name])
    if (!byNeed.size) continue
    L.push(`- **${PROVIDER_LABEL[p.provider]}**`)
    for (const [need, names] of byNeed) L.push(`  - ${need}: ${names.join(', ')}`)
  }
  L.push('', '## 감사 로그 감지', '')
  const alerts = file.audit.filter(a => a.alert)
  if (!alerts.length) L.push('경보 없음. 감사 로그에 나온 변경은 모두 수집하는 종류다.')
  for (const a of alerts) L.push(`- **${ALERT_LABEL[a.alert!]}** ${PROVIDER_LABEL[a.provider]} ${a.kind}${a.catalogName ? ` → ${a.catalogName}` : ''}: 변경 ${a.changes}건 (${a.examples.join(', ')}) ${a.firstAt?.slice(0, 10) ?? ''}~${a.lastAt?.slice(0, 10) ?? ''}`)
  L.push('', '### 감사 로그에 나온 종류 전부', '', '| SaaS | 로그의 종류 | 규격 종류 | 수집 | 변경 | 일상 이벤트 |', '| --- | --- | --- | --- | --- | --- |')
  for (const a of file.audit) L.push(`| ${PROVIDER_LABEL[a.provider]} | ${a.kind} | ${a.catalogName ?? '-'} | ${a.status ? STATUS_LABEL[a.status] : '-'} | ${a.changes} | ${a.routine} |`)
  return L.join('\n') + '\n'
}

function main() {
  const args = process.argv.slice(2)
  const arg = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
  const rawDir = path.resolve(ROOT, arg('--raw') ?? 'collected-generic')
  const dir = path.resolve(ROOT, arg('--dataset') ?? 'src/data/aegi_inc_measured_v2')
  const objects = JSON.parse(readFileSync(path.join(dir, 'objects.json'), 'utf8'))
  const coverageFile = path.join(dir, 'coverage.json')
  const calls = existsSync(coverageFile) ? JSON.parse(readFileSync(coverageFile, 'utf8')).calls : []
  const providers = catalogCoverage(objects, calls)
  const audit = auditKinds(RawSet.load(rawDir), providers)
  const file: CollectionCoverageFile = { format: 'aegi-collection-coverage/v1', generated_at: new Date().toISOString(), providers, audit }
  writeFileSync(path.join(dir, 'collection_coverage.json'), JSON.stringify(file, null, 2) + '\n')
  writeFileSync(path.join(dir, 'collection-coverage.md'), renderMarkdown(file))
  for (const p of providers) {
    const alerts = audit.filter(a => a.provider === p.provider && a.alert)
    console.log(`[coverage] ${PROVIDER_LABEL[p.provider]}: 규격 ${p.catalogTypes}종 중 수집 ${p.counts.collected + p.counts.absorbed}, 기본 정보만 ${p.counts.basic}, 0개 ${p.counts.empty}, 못 받음 ${p.counts.blocked}, 수집 안 함 ${p.counts.not_collected}, API 없음 ${p.counts.no_api} / 감사 로그 경보 ${alerts.length}`)
  }
  console.log(`[coverage] 보고서 ${path.relative(ROOT, path.join(dir, 'collection-coverage.md'))}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main()
