import type { CoverageFile } from '../detection/v2/engine/types'
import { REASON_LABELS, SCOPE_LABELS, type ExceptionDataset, type ThreatException } from '../model/exception'
import { HANDLING_LABEL, type ThreatHandling } from '../model/handling'
import { REMEDIATION_STATUS_LABEL, type RemediationProgressRecord } from '../model/remediationProgress'
import type { FindingV2 } from '../model/findingV2'
import { latestCollectedByProvider } from '../model/collectionFreshness'
import { STATUS_LABELS, applyExceptions, fingerprintOf } from '../exceptions/applyExceptions'
import { destinationKeysOf } from '../findings/outsideDestinations'
import { emptyKgResult, finishKgExecution, type KgContext, type KgExecution } from './kgTools'
import { parseToolArgs, type KgCall, type KgFact } from './chatProtocol'
import { getStandardHistory, getStandardResults, type Item as StandardItem } from '../config-findings/standardResultsStore'
import { remediationFor } from '../compliance/remediations'
import { complianceForFinding } from '../compliance/findingCompliance'

export interface CollectionContext {
  snapshotId?: string; createdAt?: string; providers?: readonly string[]; coverage?: CoverageFile
  source: 'snapshot' | 'local'
}
export interface InvestigationContext {
  dataset: ExceptionDataset; backend: 'remote' | 'local'; findings: readonly FindingV2[]
  handling: readonly ThreatHandling[]; remediation: readonly RemediationProgressRecord[]; exceptions: readonly ThreatException[]
}
type Fact = Omit<KgFact, 'id'>
const text = (value: unknown, max = 300) => typeof value === 'string' ? value.slice(0, max) : null
const validTime = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null

export function collectionStatus(context: KgContext, call: KgCall, index: number): KgExecution {
  const args = parseToolArgs(call.function.name, JSON.parse(call.function.arguments))!
  const metadata = context.collection, latest = latestCollectedByProvider(context.graph)
  const providers = [...new Set([...(metadata?.providers ?? []), ...latest.keys(), ...(metadata?.coverage?.calls.map(c => c.provider) ?? [])])]
    .filter(p => !args.provider || p === args.provider).sort()
  const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 20)
  const facts: Fact[] = [{ kind: 'reference', ref: 'collection:scope', label: '수집 상태 조회 범위', detail: '현재 데이터셋의 수집 시각과 게시된 API 수집 범위입니다. API 수집 범위는 감사 이벤트의 수집 완전성을 보증하지 않습니다.',
    data: { source: metadata?.source ?? 'unknown', snapshotId: text(metadata?.snapshotId, 100), createdAt: validTime(metadata?.createdAt),
      coverageGeneratedAt: validTime(metadata?.coverage?.generated_at), eventCoverage: 'unknown', total: providers.length, offset,
      nextOffset: offset + limit < providers.length ? offset + limit : null } }]
  let returned = 0
  const callOffset = Number(args.callOffset ?? 0)
  for (const provider of providers.slice(offset, offset + limit)) {
    const calls = metadata?.coverage?.calls.filter(c => c.provider === provider) ?? []
    const shown = calls.slice(callOffset, callOffset + 8).map(c => ({ callId: text(c.call_id, 120), completeness: text(c.completeness, 80), reasons: c.reasons?.slice(0, 5).map(r => text(r, 160)) ?? [] }))
    const fact: Fact = { kind: 'reference', ref: `collection:${provider}`, label: `${provider} 수집 상태`,
      detail: `${provider}\n마지막 관측 수집 시각: ${validTime(latest.get(provider)) ?? '미확인'}\nAPI 수집 범위: ${calls.length ? shown.map(c => `${c.callId}: ${c.completeness}`).join(', ') : '미확인'}\n이벤트 수집 범위: 미확인`,
      data: { provider, lastCollectedAt: validTime(latest.get(provider)), coverageAvailable: calls.length > 0, calls: shown, totalCalls: calls.length,
        callOffset, nextCallOffset: callOffset + shown.length < calls.length ? callOffset + shown.length : null, callsTruncated: callOffset + shown.length < calls.length,
        completenessCounts: Object.fromEntries([...new Set(calls.map(c => c.completeness))].map(state => [state, calls.filter(c => c.completeness === state).length])), eventCoverage: 'unknown' } }
    if (JSON.stringify([...facts, fact]).length > 12_000) break
    facts.push(fact); returned++
  }
  facts[0].data = { ...facts[0].data, returned, nextOffset: offset + returned < providers.length ? offset + returned : null }
  const result = emptyKgResult(`SaaS ${providers.length}개 중 ${returned}개 수집 메타데이터 조회. 시각 없음과 범위 미확인은 수집 실패나 활동 없음으로 단정할 수 없습니다.`)
  result.navigation = [{ page: 'Adapters', label: '수집 상태 보기' }]
  return finishKgExecution(context, call.function.name, args, index, result, facts, offset + returned < providers.length || facts.some(f => f.data?.callsTruncated === true))
}

/** Refresh existing authenticated read APIs. A failed team read never falls back to browser records. */
export async function investigationStatus(context: KgContext, call: KgCall, index: number, signal: AbortSignal, request: typeof fetch = fetch): Promise<KgExecution> {
  const args = parseToolArgs(call.function.name, JSON.parse(call.function.arguments))!
  const source = context.investigation
  const finding = source?.findings.find(f => f.id === args.findingId) ?? context.findings.find(f => f.id === args.findingId)
  const result = emptyKgResult('처리 기록은 운영자가 저장한 상태이며 실제 위험 제거를 증명하지 않습니다. 기록 없음과 저장소 조회 불가는 다릅니다.')
  const facts: Fact[] = []
  if (!source || !finding) {
    facts.push({ kind: 'reference', ref: 'investigation:scope', label: '처리 기록 조회 범위', state: 'unknown', detail: !source ? '처리 기록 저장소가 연결되지 않았습니다.' : '현재 데이터셋에서 해당 탐지 ID를 찾지 못했습니다.', data: { available: !!source, findingFound: !!finding } })
    return finishKgExecution(context, call.function.name, args, index, result, facts, false)
  }
  const fingerprint = fingerprintOf(finding), historyOffset = Number(args.historyOffset ?? 0)
  const section = String(args.section ?? 'all'), offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 10)
  const sections = [
    { name: 'handling', endpoint: 'handling', items: source.handling },
    { name: 'remediation', endpoint: 'remediation-progress', items: source.remediation },
    { name: 'exceptions', endpoint: 'exceptions', items: source.exceptions },
  ].filter(s => section === 'all' || section === s.name)
  const validItems = (items: unknown, section: string): boolean => Array.isArray(items) && items.every(item => item && typeof item === 'object'
    && typeof item.fingerprint === 'string' && typeof item.dataset === 'string' && Array.isArray(item.history)
    && item.history.every((event: unknown) => event && typeof event === 'object' && typeof (event as { at?: unknown }).at === 'string')
    && (section !== 'remediation' || typeof item.remediationId === 'string' && Array.isArray(item.completedSteps) && item.completedSteps.every((step: unknown) => typeof step === 'string'))
    && (section !== 'exceptions' || typeof item.id === 'string' && typeof item.reason === 'string'))
  const reads = await Promise.all(sections.map(async store => {
    if (source.backend === 'local') {
      const available = validItems(store.items, store.name)
      return { ...store, available, items: available ? store.items : [], checkedAt: null }
    }
    try {
      const response = await request(`/api/measured/${store.endpoint}?dataset=${encodeURIComponent(source.dataset)}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal })
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('unavailable')
      const body = await response.json()
      if (!validItems(body.items, store.name)) throw new Error('invalid')
      return { ...store, available: true, items: body.items as typeof store.items, checkedAt: validTime(body.serverTime) }
    } catch {
      signal.throwIfAborted()
      return { ...store, available: false, items: [], checkedAt: null }
    }
  }))
  signal.throwIfAborted()
  // 목적지 전체 예외는 등록한 위협과 지문이 달라도 이 위협의 조직 밖 목적지에 걸리면 이 위협의 기록이다
  const destinations = new Set(destinationKeysOf(finding))
  const mine = (item: (typeof reads)[number]['items'][number]) => item.fingerprint === fingerprint
    || ('scope' in item && item.scope === 'destination' && !!item.subjectKey && destinations.has(item.subjectKey))
  const records = reads.flatMap(store => store.items.filter(item => item.dataset === source.dataset && mine(item)).map(item => ({ store: store.name, item })))
  records.sort((a, b) => String(b.item.updatedAt ?? '').localeCompare(String(a.item.updatedAt ?? '')) || ('id' in a.item ? a.item.id : 'remediationId' in a.item ? a.item.remediationId : '').localeCompare('id' in b.item ? b.item.id : 'remediationId' in b.item ? b.item.remediationId : ''))
  const scope: Fact = { kind: 'reference', ref: 'investigation:scope', label: '처리 기록 조회 범위', state: reads.some(s => !s.available) ? 'unknown' : undefined,
    detail: `${source.backend === 'remote' ? '팀 공용 저장소' : '이 브라우저 저장소'}의 기록입니다. 조회하지 못한 저장소를 기록 0건으로 해석하지 마세요.\n${reads.map(store => `${({ handling: '위협 처리', remediation: '조치 진행', exceptions: '예외' } as Record<string, string>)[store.name]}: ${store.available ? `${records.filter(r => r.store === store.name).length}건` : '조회 불가'}`).join('\n')}`,
    data: { findingId: finding.id, source: source.backend === 'remote' ? 'team' : 'browser', findingFound: true,
      stores: reads.map(store => ({ section: store.name, available: store.available, checkedAt: store.checkedAt, total: store.available ? records.filter(r => r.store === store.name).length : null })),
      total: reads.every(s => s.available) ? records.length : null, knownTotal: records.length, offset, nextOffset: null as number | null, historyOffset } }
  facts.push(scope)
  let returned = 0, historyTruncated = false
  for (const { store, item } of records.slice(offset, offset + limit)) {
    const history = item.history.slice().reverse().slice(historyOffset, historyOffset + 5).map(h => ({ at: text(h.at, 64),
      state: text('state' in h ? h.state : 'status' in h ? h.status : h.action, 80), actor: text(h.actor, 40),
      ...('owner' in h ? { owner: text(h.owner, 40) } : {}), ...('note' in h ? { note: text(h.note) } : {}) }))
    const nextHistoryOffset = historyOffset + history.length < item.history.length ? historyOffset + history.length : null
    let data: Record<string, unknown>, id: string, description: string
    if (store === 'handling') {
      const h = item as ThreatHandling; id = 'handling'
      description = `위협 처리: ${HANDLING_LABEL[h.state] ?? '미확인'}\n담당자: ${text(h.owner, 40) ?? '미기록'}\n메모: ${text(h.note) ?? '미기록'}\n검증자: ${text(h.verifiedBy, 40) ?? '미기록'}\n검증 시각: ${text(h.verifiedAt, 64) ?? '미기록'}`
      data = { state: text(h.state, 80), owner: text(h.owner, 40), note: text(h.note), verifiedBy: text(h.verifiedBy, 40), verifiedAt: text(h.verifiedAt, 64) }
    } else if (store === 'remediation') {
      const r = item as RemediationProgressRecord; id = r.remediationId
      description = `조치 진행: ${REMEDIATION_STATUS_LABEL[r.status] ?? '미확인'}\n담당자: ${text(r.owner, 40) ?? '미기록'}\n기한: ${text(r.due, 64) ?? '미기록'}\n검증자: ${text(r.verifiedBy, 40) ?? '미기록'}\n검증 시각: ${text(r.verifiedAt, 64) ?? '미기록'}\n완료 단계: ${r.completedSteps?.length ?? 0}개`
      data = { remediationId: text(r.remediationId, 120), status: text(r.status, 80), owner: text(r.owner, 40), due: text(r.due, 64),
        verifiedBy: text(r.verifiedBy, 40), verifiedAt: text(r.verifiedAt, 64), completedSteps: r.completedSteps?.slice(0, 10).map(s => text(s, 80)) ?? [], completedStepsTotal: r.completedSteps?.length ?? 0, completedStepsTruncated: (r.completedSteps?.length ?? 0) > 10 }
    } else {
      const e = item as ThreatException; id = e.id
      let applicability = 'unknown', reviewReasons: string[] = []
      try { const info = applyExceptions([finding], [e], new Date()).info.get(e.id); applicability = info?.status ?? 'unknown'; reviewReasons = info?.reviewReasons ?? [] } catch { /* incomplete stored record stays unknown */ }
      description = `예외: ${STATUS_LABELS[applicability as keyof typeof STATUS_LABELS] ?? '적용 상태 미확인'}\n범위: ${SCOPE_LABELS[e.scope] ?? '미확인'}\n사유 분류: ${REASON_LABELS[e.reasonCategory] ?? '미확인'}\n사유: ${text(e.reason) ?? '미기록'}\n만료: ${text(e.expiresAt, 64) ?? '만료일 미지정'}\n검토 신호: ${reviewReasons.join(', ') || '없음'}`
      data = { exceptionId: text(e.id, 120), scope: text(e.scope, 80), subjectKey: text(e.subjectKey, 512), reasonCategory: text(e.reasonCategory, 80), reason: text(e.reason),
        actor: text(e.actor, 40), approver: text(e.approver, 40), expiresAt: text(e.expiresAt, 64), revokedAt: text(e.revokedAt, 64), applicability, reviewReasons: reviewReasons.slice(0, 8).map(r => text(r)) }
    }
    const fact: Fact = { kind: 'reference', ref: `investigation:${store}:${id}`.slice(0, 512), label: `${finding.id} ${{ handling: '위협 처리', remediation: '조치 진행', exceptions: '예외' }[store] ?? '처리'} 기록`,
      detail: `${finding.title}\n저장소: ${source.backend === 'remote' ? '팀 공용' : '이 브라우저'}\n${description}\n최근 이력:\n${history.map(h => `${h.at ?? '시각 미확인'}: ${({ ...HANDLING_LABEL, ...REMEDIATION_STATUS_LABEL, created: '등록', extended: '연장', edited: '수정', revoked: '취소', reapplied: '재적용' } as Record<string, string>)[h.state ?? ''] ?? '상태 미확인'}, ${h.actor ?? '처리자 미기록'}`).join('\n')}${nextHistoryOffset !== null ? '\n추가 이력이 있습니다.' : ''}`,
      data: { ...data, section: store, findingId: finding.id, updatedAt: text(item.updatedAt, 64), history, totalHistory: item.history.length, nextHistoryOffset } }
    if (JSON.stringify([...facts, fact]).length > 12_000) break
    facts.push(fact); returned++; historyTruncated ||= nextHistoryOffset !== null || data.completedStepsTruncated === true
  }
  const nextOffset = offset + returned < records.length ? offset + returned : null
  scope.data = { ...scope.data, nextOffset, returned }
  result.focus = { findingId: finding.id }
  return finishKgExecution(context, call.function.name, args, index, result, facts, nextOffset !== null || historyTruncated)
}

/**
 * 기준별 설정 판정(standard_results). 최신 판정 이력을 화면과 같은 저장소에서 읽는다.
 * 대상의 원본 값(target.value)에는 테넌트 값이 들어 있어 보내지 않는다.
 */
export function standardFindings(context: KgContext, call: KgCall, index: number): KgExecution {
  const args = parseToolArgs(call.function.name, JSON.parse(call.function.arguments))!
  const results = getStandardResults(), source = 'history', run = getStandardHistory().selected
  const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 10)
  const objectKey = typeof args.objectKey === 'string' ? args.objectKey : '', want = typeof args.status === 'string' ? args.status : ''
  const needle = typeof args.text === 'string' ? args.text.toLowerCase() : ''
  const facts: Fact[] = []
  if (!results) {
    facts.push({ kind: 'reference', ref: 'standards:scope', label: '설정 점검 결과 조회 범위', state: 'unknown',
      detail: '판정 이력을 불러오지 못했거나 게시된 판정이 없습니다. 위반 없음으로 볼 수 없습니다.',
      data: { available: false, source } })
    return finishKgExecution(context, call.function.name, args, index, emptyKgResult('설정 점검 결과를 읽지 못했습니다.'), facts, false)
  }
  const itemMatches = (item: StandardItem) => (!want || item.status === want) && (!objectKey || item.targets.some(t => t.key === objectKey))
  const matched = results.findings
    .filter(f => !args.provider || f.provider === args.provider)
    .filter(f => !needle || `${f.id} ${f.text} ${f.items.map(i => `${i.item_id} ${i.title}`).join(' ')}`.toLowerCase().includes(needle))
    .map(f => ({ finding: f, items: f.items.filter(itemMatches) }))
    .filter(m => m.items.length > 0)
  const statusCounts: Record<string, number> = {}
  for (const m of matched) for (const item of m.items) statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1
  facts.push({ kind: 'reference', ref: 'standards:scope', label: '설정 점검 결과 조회 범위',
    detail: `기준 ${results.standards.length}개의 판정입니다. not_collected, unknown 은 설정을 읽지 못한 것이고 통과나 위반이 아닙니다. 판정은 수집 원본으로 했고 그래프 탐색 결과가 아닙니다.`,
    data: { available: true, source, runId: text(run?.id, 120), generatedAt: text(results.generated_at, 40), publishedAt: validTime(run?.published_at),
      sourceSnapshotId: text(run?.source_snapshot_id, 120), standards: results.standards.map(s => text(s.id, 80)), total: matched.length, statusCounts, offset } })
  let returned = 0
  for (const { finding, items } of matched.slice(offset, offset + limit)) {
    const shown = items.slice(0, 5).map(item => {
      const targets = (objectKey ? item.targets.filter(t => t.key === objectKey) : item.targets)
      return { standard: text(item.standard, 80), itemId: text(item.item_id, 80), title: text(item.title, 200), status: item.status, threshold: text(item.threshold, 160),
        note: text(item.note, 200), targets: targets.slice(0, 5).map(t => ({ key: text(t.key, 512), inGraph: t.in_graph === true, name: text(t.name, 160), status: text(t.status, 40) })),
        totalTargets: targets.length }
    })
    const rem = remediationFor(finding.id)
    const fix = rem ? [
      `조치(${rem.review}): ${rem.summary}`,
      rem.where ? `설정 위치: ${rem.where}` : '설정 위치: 조치 데이터에 없음',
      `바꿀 설정: ${rem.change.setting} -> ${rem.change.recommended}`,
      `단계: ${rem.steps.join(' / ')}`,
      ...(rem.review === '근거 부족' ? ['조치 데이터 근거 부족: 공식 문서 확인 필요'] : []),
    ] : ['조치 데이터 없음']
    const compliance = complianceForFinding(finding.id).map(c => `${c.framework} ${c.controlId}`)
    const fact: Fact = { kind: 'reference', ref: `standard:${finding.id}`, label: text(finding.text, 200) ?? finding.id,
      detail: [`${finding.id} ${finding.provider} ${finding.kind}`, ...shown.map(i => `${i.standard} ${i.itemId}: ${i.status}`), ...fix,
        `관련 컴플라이언스 항목: ${compliance.length ? compliance.join(', ') : '없음'}`].join('\n'),
      data: { findingId: text(finding.id, 120), provider: finding.provider, layer: text(finding.layer, 80), group: text(finding.group, 80), kind: text(finding.kind, 80),
        items: shown, totalItems: items.length, itemsTruncated: items.length > shown.length } }
    if (JSON.stringify([...facts, fact]).length > 12_000) break
    facts.push(fact); returned++
  }
  facts[0].data = { ...facts[0].data, returned, nextOffset: offset + returned < matched.length ? offset + returned : null }
  const result = emptyKgResult(`설정 점검 결과 ${matched.length}건 중 ${returned}건을 읽었습니다.`)
  return finishKgExecution(context, call.function.name, args, index, result, facts, offset + returned < matched.length || facts.some(f => f.data?.itemsTruncated === true))
}
