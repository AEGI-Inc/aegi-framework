import { type CSSProperties, useState } from 'react'
import { configThreatHash } from '../appRouting'
import { useAssistantBridge } from '../assistant/AssistantBridge'
import { emptySelection } from '../assistant/workspace'
import { objectLabel, objectTypeLabel } from '../blast-radius/blastLabels'
import RemediationCardBody from '../config-findings/RemediationCardBody'
import type { Finding, Item } from '../config-findings/standardResultsStore'
import { providerLogoId, PROVIDERS_WITH_LOGO } from '../findings/providers'
import type { GraphStoreV2 } from '../model/graph'
import ProviderLogo from '../ProviderLogo'
import { LABEL, SAAS, type Match } from './complianceOverviewShared'
import { buildObjectRemediationQuestion, objectRemediationView } from './objectRemediation'
import {
  buildUnifiedSaasTargets,
  hasTypeScope,
  type UnifiedObjectTarget,
  type UnifiedStatus,
} from './typeScope'

export const UNIFIED_KINDS: { key: UnifiedStatus; label: string; barClass: string }[] = [
  { key: 'fail', label: '위반', barClass: 'is-fail' },
  { key: 'pass', label: '충족', barClass: 'is-pass' },
  { key: 'unknown', label: '판정 불가', barClass: 'is-unknown' },
  { key: 'person', label: '직접 확인', barClass: 'is-person' },
  { key: 'uninspected', label: '미점검', barClass: 'is-not_collected' },
]

export const STATUS_LABEL: Record<UnifiedStatus, string> = {
  fail: '위반',
  pass: '충족',
  unknown: '판정 불가',
  person: '직접 확인',
  uninspected: '미점검',
}

export function UnifiedBar({
  counts,
  total,
  kinds = UNIFIED_KINDS,
  size = 'md',
}: {
  counts: Record<UnifiedStatus, number>
  total: number
  kinds?: typeof UNIFIED_KINDS
  size?: 'sm' | 'md' | 'lg'
}) {
  if (!total) return <span className="comp-bar-none">대상 없음</span>
  return (
    <span className={`comp-bar is-${size}`} role="img" aria-label={kinds.map(k => `${k.label} ${counts[k.key]}`).join(', ')}>
      {kinds.map(k => (counts[k.key] ? <i key={k.key} className={k.barClass} style={{ flexGrow: counts[k.key] }} /> : null))}
    </span>
  )
}

function UnifiedObjectRow({
  itemKey,
  obj,
  onOpenObject,
  exceptedFindings,
  onExceptCheck,
}: {
  itemKey: string
  obj: UnifiedObjectTarget<Match>
  onOpenObject?: (key: string) => void
  exceptedFindings?: Set<string>
  onExceptCheck?: (f: Finding) => void
}) {
  const bridge = useAssistantBridge()
  const failFindingIds = [...new Set(obj.checks.filter(c => c.targetStatus === 'fail').map(c => c.match.f.id))]
  const hasExcepted = obj.checks.some(c => c.targetStatus === 'fail' && exceptedFindings?.has(c.match.f.id))
  const nameEl = onOpenObject && obj.inGraph
    ? <button type="button" className="cfg-link" onClick={() => onOpenObject(obj.key)}>{obj.name}</button>
    : <strong>{obj.name}</strong>
  const meta = [obj.objectType, ...obj.tags].filter(Boolean).join(', ')

  if (obj.checks.length === 0) {
    return (
      <li>
        <div className="comp-check comp-scope-row">
          <span className="comp-check-badges">
            <span className="cfg-status tl-badge">미점검</span>
          </span>
          <span>
            {nameEl}
            {meta && <small> {meta}</small>}
          </span>
          <span className="comp-scope-summary">자동 점검 없음</span>
        </div>
      </li>
    )
  }

  return (
    <li>
      <details className="comp-check">
        <summary>
          <span className="comp-check-badges">
            <span className={`cfg-status tl-badge${obj.status === 'fail' ? ' is-failure' : ''}`}>{STATUS_LABEL[obj.status]}</span>
            {hasExcepted && <span className="cfg-status tl-badge">예외</span>}
          </span>
          <span>
            {nameEl}
            {meta && <small>{meta}</small>}
          </span>
          <span>점검 {obj.checks.length}건</span>
        </summary>
        <div className="comp-check-body">
          {failFindingIds.length > 0 && bridge && (
            <div className="comp-obj-ai-bar">
              <button
                type="button"
                className="cfg-link"
                onClick={() => bridge.ask(
                  { ...emptySelection(), objectKeys: [obj.key] },
                  buildObjectRemediationQuestion(itemKey, obj.name, failFindingIds),
                  undefined,
                  true,
                )}
              >
                AI 추천
              </button>
            </div>
          )}
          <ul className="comp-check-targets">
            {obj.checks.map(({ match: m, targetStatus, value }) => {
              const remView = targetStatus === 'fail' ? objectRemediationView(m.f.id) : null
              return (
                <li key={`${m.key}:${obj.key}`}>
                  <span className={`cfg-status tl-badge${targetStatus === 'fail' ? ' is-failure' : ''}`}>
                    {LABEL[targetStatus as Item['status']] ?? targetStatus}
                  </span>
                  {targetStatus === 'fail' && exceptedFindings?.has(m.f.id) && <span className="cfg-status tl-badge">예외</span>}
                  <strong>{m.f.text}</strong>
                  <small>
                    {m.item.standard} {m.item.item_id}
                    {m.item.rule.field ? `, ${m.item.rule.field}` : ''}
                    {value !== undefined && value !== null ? `, 값: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}` : ''}
                  </small>
                  {m.f.items.some(i => i.status === 'fail') && (
                    <button
                      type="button"
                      className="cfg-link comp-check-open"
                      onClick={() => { window.location.hash = configThreatHash(m.f.provider, m.f.id) }}
                    >
                      설정 위반 상세
                    </button>
                  )}
                  {targetStatus === 'fail' && onExceptCheck && (
                    <button type="button" className="ex-btn comp-check-except" onClick={() => onExceptCheck(m.f)}>
                      예외 처리
                    </button>
                  )}
                  {remView && (
                    <details className="comp-obj-remediation">
                      <summary>조치 방법</summary>
                      {remView.kind === 'insufficient'
                        ? <p className="comp-obj-remediation-empty">공식 문서로 확인한 조치 없음</p>
                        : <RemediationCardBody remediation={remView.remediation} />}
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </details>
    </li>
  )
}

export default function TypeScopeTargets({
  itemKey,
  graph,
  ms = [],
  onOpenObject,
  exceptedFindings,
  onExceptCheck,
}: {
  itemKey: string
  graph: GraphStoreV2
  ms?: Match[]
  onOpenObject?: (key: string) => void
  exceptedFindings?: Set<string>
  onExceptCheck?: (f: Finding) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selectedStatuses, setSelectedStatuses] = useState<Set<UnifiedStatus>>(() => new Set())
  if (!hasTypeScope(itemKey) && ms.length === 0) return null

  const unified = buildUnifiedSaasTargets(graph, itemKey, ms, key => objectLabel(key, graph))
  const untargetedList = [...unified.untargetedBySaas.entries()]
  const untargetedCount = untargetedList.reduce((sum, [, list]) => sum + list.length, 0)

  if (unified.totalObjects === 0 && untargetedCount === 0 && unified.reviewObjectCount === 0) {
    return (
      <section className="comp-related" aria-label="점검 대상 및 결과">
        <header>
          <h5>점검 대상</h5>
        </header>
        <p className="comp-scope-empty">이 데이터에는 매핑된 대상 객체나 점검 결과가 없습니다.</p>
      </section>
    )
  }

  const availableKinds = UNIFIED_KINDS.filter(k => unified.counts[k.key] > 0)
  const activeSelected = new Set([...selectedStatuses].filter(s => unified.counts[s] > 0))
  const isFiltered = activeSelected.size > 0
  const visibleKinds = isFiltered
    ? UNIFIED_KINDS.filter(k => activeSelected.has(k.key))
    : (availableKinds.length > 0 ? availableKinds : UNIFIED_KINDS)

  const toggleStatus = (key: UnifiedStatus) => {
    setSelectedStatuses(prev => {
      const next = new Set([...prev].filter(s => unified.counts[s] > 0))
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const visibleTotal = visibleKinds.reduce((sum, k) => sum + unified.counts[k.key], 0)
  const visibleInspected = visibleKinds.filter(k => k.key !== 'uninspected').reduce((sum, k) => sum + unified.counts[k.key], 0)
  const filteredGroups = isFiltered
    ? unified.saasGroups
        .map(g => ({ ...g, objects: g.objects.filter(o => activeSelected.has(o.status)) }))
        .filter(g => g.objects.length > 0)
    : unified.saasGroups

  return (
    <section className="comp-related" aria-label="점검 대상 및 결과">
      <header>
        <h5>점검 대상 {visibleTotal}개</h5>
        <span className="comp-state">점검됨 {visibleInspected}개</span>
        <span className="comp-legend">
          {visibleKinds.map(k => (
            <span key={k.key} className={k.barClass}>
              <i />
              {k.label} <b>{unified.counts[k.key]}</b>
            </span>
          ))}
        </span>
      </header>
      <div className="comp-related-bar">
        <UnifiedBar counts={unified.counts} total={visibleTotal} kinds={visibleKinds} size="lg" />
      </div>

      {unified.totalObjects > 0 && (
        <div className="comp-filter-group comp-target-filter" role="group" aria-label="대상 상태 다중 필터">
          <button
            type="button"
            className={`comp-filter-btn ${!isFiltered ? 'is-selected' : ''}`}
            aria-pressed={!isFiltered}
            onClick={() => setSelectedStatuses(new Set())}
          >
            전체 {unified.totalObjects}
          </button>
          {availableKinds.map(k => {
            const checked = activeSelected.has(k.key)
            return (
              <label key={k.key} className={`comp-filter-btn comp-filter-check ${checked ? 'is-selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleStatus(k.key)}
                />
                <span>{k.label} {unified.counts[k.key]}</span>
              </label>
            )
          })}
        </div>
      )}

      {filteredGroups.length > 0 && (
        <div
          className="comp-saas-table comp-checks-by-saas"
          style={{ '--status-cols': visibleKinds.length } as CSSProperties}
        >
          <div className="comp-saas-row is-head">
            <span>SaaS</span>
            {visibleKinds.map(k => <span key={k.key}>{k.label}</span>)}
            <span>분포</span>
          </div>
          {filteredGroups.map(group => {
            const showAll = expanded[group.provider]
            const visible = showAll ? group.objects : group.objects.slice(0, 30)
            const rest = group.objects.length - 30
            const totalInGroup = visibleKinds.reduce((s, k) => s + group.counts[k.key], 0)
            return (
              <details key={group.provider} className="comp-saas">
                <summary className="comp-saas-row">
                  <span>
                    {PROVIDERS_WITH_LOGO.has(group.provider) && (
                      <span aria-hidden="true">
                        <ProviderLogo provider={providerLogoId(group.provider)} className="comp-saas-logo" />
                      </span>
                    )}
                    <strong>{SAAS[group.provider] ?? group.provider}</strong> {totalInGroup}개
                  </span>
                  {visibleKinds.map(k => (
                    <span key={k.key} className={k.key === 'fail' && group.counts.fail ? 'is-fail' : ''}>
                      <span className="comp-saas-status-label">{k.label}</span>
                      {group.counts[k.key]}
                    </span>
                  ))}
                  <UnifiedBar counts={group.counts} total={totalInGroup} kinds={visibleKinds} size="sm" />
                </summary>
                <ul>
                  {visible.map(obj => (
                    <UnifiedObjectRow
                      key={obj.key}
                      itemKey={itemKey}
                      obj={obj}
                      onOpenObject={onOpenObject}
                      exceptedFindings={exceptedFindings}
                      onExceptCheck={onExceptCheck}
                    />
                  ))}
                  {!showAll && rest > 0 && (
                    <li>
                      <button
                        type="button"
                        className="cfg-link comp-scope-more"
                        onClick={() => setExpanded(prev => ({ ...prev, [group.provider]: true }))}
                      >
                        나머지 {rest}개 객체 더 보기
                      </button>
                    </li>
                  )}
                </ul>
              </details>
            )
          })}
        </div>
      )}

      {untargetedCount > 0 && (
        <details className="comp-saas">
          <summary className="comp-scope-row">
            <strong>객체 외 점검 (수동)</strong>
            <span>{untargetedCount}건</span>
          </summary>
          <ul>
            {untargetedList.flatMap(([provider, list]) =>
              list.map(m => (
                <li key={m.key}>
                  <div className="comp-check comp-scope-row">
                    <span className="comp-check-badges">
                      <span className={`cfg-status tl-badge${m.item.status === 'fail' ? ' is-failure' : ''}`}>
                        {LABEL[m.item.status]}
                      </span>
                    </span>
                    <span>
                      <strong>{SAAS[provider] ?? provider}</strong>, {m.f.text}
                      <small> {m.item.standard} {m.item.item_id}</small>
                    </span>
                  </div>
                </li>
              )),
            )}
          </ul>
        </details>
      )}

      {unified.reviewObjectCount > 0 && (
        <details className="comp-saas">
          <summary className="comp-scope-row">
            <strong>검토 필요 객체</strong>
            <span>종류 {unified.review.length}종, 객체 {unified.reviewObjectCount}개</span>
          </summary>
          <p className="comp-scope-type-note">이 항목과 관련될 수 있지만 대상인지 확정되지 않은 객체</p>
          <ul>
            {unified.review.map(g => {
              const typeName = g.objects[0]
                ? objectTypeLabel(g.objects[0].fixture_key, graph)
                : `${SAAS[g.provider] ?? g.provider} ${g.objectType}`
              return (
                <li key={g.typeKey}>
                  <div className="comp-check comp-scope-row">
                    <span>
                      <strong>{typeName}</strong>
                    </span>
                    <span>{g.objects.length}개</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </section>
  )
}
