import type { Provider } from '../model/object'
import { useState, useMemo } from 'react'
import type { FindingV2 } from '../model/findingV2'
import { ArrowRight, ChevronRight, TriangleAlert, Search, X } from 'lucide-react'
import { scenarioTag, findingTagKey, findingGroupKey, tagClass, classificationSearchTerms, tagOptions, type ThreatGroupKey } from './scenarioTags'
import { sortBySeverity } from './severity'
import SeverityDot from './SeverityDot'
import { BASE_PROVIDERS, providerLogoId, providerName, sortProviders } from './providers'
import ProviderLogo from '../ProviderLogo'
import { ChipGroup } from '../ui/ListScreen'

export interface FindingNavigatorProps {
  findings: FindingV2[]
  selectedFindingIds: string[]
  onToggleFinding: (findingId: string) => void
  onClearSelection: () => void
  onOpenFindingDetail: (findingId: string) => void
  showEvidence: boolean
  onToggleEvidence: () => void
  isOpen?: boolean
  onToggleOpen?: () => void
  /** 예외 처리로 가린 위협 수 */
  exceptedCount?: number
  /** 그래프 오른쪽 패널 탭 안에 들어 있을 때. 제목과 닫기는 탭 줄이 맡는다 */
  embedded?: boolean
  /** 그래프에 있는 SaaS 전부. SaaS 칩은 위협이 없는 SaaS도 빠짐없이 보인다 */
  providers?: Provider[]
}

export default function FindingNavigator({
  findings,
  selectedFindingIds,
  onToggleFinding,
  onClearSelection,
  onOpenFindingDetail,
  showEvidence,
  onToggleEvidence,
  isOpen = true,
  onToggleOpen,
  exceptedCount = 0,
  embedded = false,
  providers = [],
}: FindingNavigatorProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(() => !isOpen || (typeof window !== 'undefined' && window.innerWidth <= 960))
  const collapsed = onToggleOpen ? !isOpen : internalCollapsed
  const [searchQuery, setSearchQuery] = useState('')
  /* Threat Analysis 칩과 같이 여러 개를 고를 수 있다. 비면 전체 */
  const [groupFilter, setGroupFilter] = useState<ThreatGroupKey[]>([])
  const [providerFilter, setProviderFilter] = useState<Provider[]>([])
  const toggleIn = <K,>(list: K[], key: K) => (list.includes(key) ? list.filter(k => k !== key) : [...list, key])

  // 어느 화면에서 보든 심각한 것이 위에 온다. 정렬 규칙은 severity.ts
  // 한 곳에 있고, 같은 심각도 안에서는 id 순으로 고정해 목록을 다시
  // 그려도 줄 순서가 흔들리지 않는다.
  const filteredFindings = useMemo(() => {
    return sortBySeverity(findings).filter(f => {
      if (groupFilter.length && !groupFilter.some(key => key === findingGroupKey(f))) return false
      if (providerFilter.length && !f.providerSet.some(p => providerFilter.includes(p))) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchTitle = f.title.toLowerCase().includes(q)
        const matchSummary = f.summary.toLowerCase().includes(q)
        const matchId = f.id.toLowerCase().includes(q)
        const matchCategory = classificationSearchTerms(findingTagKey(f)).some(term => term.toLowerCase().includes(q))
        if (!matchTitle && !matchSummary && !matchId && !matchCategory) return false
      }
      return true
    })
  }, [findings, groupFilter, providerFilter, searchQuery])


  /* 기본 네 SaaS, 그래프에 있는 SaaS, 위협에 나오는 SaaS 전부 */
  const providerOptions = useMemo(() => sortProviders([...new Set([...BASE_PROVIDERS, ...providers, ...findings.flatMap(f => f.providerSet)])]), [findings, providers])
  const categoryOptions = tagOptions(findings.map(findingTagKey))

  const toggleCollapse = () => {
    if (onToggleOpen) onToggleOpen()
    else setInternalCollapsed(prev => !prev)
  }

  if (collapsed) {
    return (
      <div className="finding-navigator-collapsed" onClick={toggleCollapse} title="위협 목록 열기">
        <span className="fn-icon"><TriangleAlert size={16} strokeWidth={2} /></span>
        <span className="fn-label">위협</span>
        <span className="fn-badge">{findings.length}</span>
        {selectedFindingIds.length > 0 && (
          <span className="fn-selected-badge">{selectedFindingIds.length}개 강조</span>
        )}
      </div>
    )
  }

  return (
    <aside className={`finding-navigator-shell${embedded ? ' is-embedded' : ''}`} aria-label="탐지 결과 목록">
      {/* Header */}
      {!embedded && <div className="finding-navigator-header">
        <div className="fn-header-title">
          <h3>탐지 결과</h3>
          <span className="fn-count-tag">{findings.length}</span>
        </div>
        <button
          type="button"
          className="fn-collapse-btn"
          onClick={toggleCollapse}
          aria-label="위협 창 접기"
          title="접기"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>}

      {/* 도구 줄: 탐지 경로 스위치와 강조 상태. 경고색 상자 대신 중립 스위치 한 줄이다 */}
      <div className="fn-toolbar">
        {/* Threat Analysis 「예외 포함」과 같은 스위치 */}
        <label className="ti-show-excepted fn-evidence-switch">
          <span>탐지 경로</span>
          <input type="checkbox" checked={showEvidence} onChange={onToggleEvidence} />
          <i aria-hidden="true" />
        </label>
        {showEvidence && selectedFindingIds.length > 0 && (
          <span className="fn-footer-status">
            <strong>{selectedFindingIds.length}</strong>건 강조
            <button type="button" className="fn-clear-btn" onClick={onClearSelection}>해제</button>
          </span>
        )}
      </div>

      <div className="fn-search-input-wrap">
        <span className="fn-search-icon"><Search size={14} strokeWidth={2} /></span>
        <input
          type="text"
          placeholder="위협, 분류, 요약 검색"
          aria-label="위협 검색"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="fn-search-input"
        />
        {searchQuery && (
          <button type="button" className="fn-clear-search" aria-label="검색어 지우기" onClick={() => setSearchQuery('')}>
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* 거르기: 운영체제 기본 선택 상자 대신 다른 목록 화면과 같은 칩. 다시 누르면 전체로 돌아간다 */}
      <div className="fn-filters">
        {/* 고를 것이 하나뿐인 묶음은 거를 것이 없어 숨긴다 */}
        {categoryOptions.length > 1 && (
          <ChipGroup<ThreatGroupKey>
            legend="분류"
            items={categoryOptions.map(key => {
              const count = findings.filter(f => findingGroupKey(f) === key).length
              return { key: key as ThreatGroupKey, label: scenarioTag(key).label, count, ariaLabel: `${scenarioTag(key).label} ${count}건` }
            })}
            isOn={key => groupFilter.includes(key)}
            onToggle={key => setGroupFilter(prev => toggleIn(prev, key))}
          />
        )}
        <ChipGroup<Provider>
          legend="SaaS"
          items={providerOptions.map(p => {
            const count = findings.filter(f => f.providerSet.includes(p)).length
            return { key: p, label: <ProviderLogo provider={providerLogoId(p)} />, count, logo: true, ariaLabel: `${providerName(p)} ${count}건`, title: providerName(p) }
          })}
          isOn={p => providerFilter.includes(p)}
          onToggle={p => setProviderFilter(prev => toggleIn(prev, p))}
        />
      </div>

      {/* Findings List */}
      <div className="finding-navigator-list">
        {filteredFindings.length === 0 ? (
          <div className="fn-empty">일치하는 위협 없음</div>
        ) : (
          filteredFindings.map(f => {
            const isSelected = selectedFindingIds.includes(f.id)
            const isHighlighted = showEvidence && isSelected
            return (
              <div key={f.id} className={`fn-finding-row ${isHighlighted ? 'selected' : ''}`}>
                {/* 체크하면 그래프에 이 위협의 경로를 강조한다. 탐지 경로가 꺼져 있으면 함께 켠다 */}
                <label className="fn-checkbox-label" title="그래프에 이 탐지 경로 강조">
                  <input
                    type="checkbox"
                    aria-label={`${f.title} 탐지 경로 강조`}
                    checked={isHighlighted}
                    onChange={() => {
                      // 탐지 경로가 꺼져 있으면 켜고 이 위협을 강조한다. 이미 골라 둔 위협이면 고른 채로 둔다
                      if (!showEvidence) {
                        onToggleEvidence()
                        if (!isSelected) onToggleFinding(f.id)
                        return
                      }
                      onToggleFinding(f.id)
                    }}
                    className="fn-checkbox"
                  />
                </label>
                <button type="button" className="fn-finding-content" onClick={() => onOpenFindingDetail(f.id)} title="그래프에서 이 위협만 강조하고 요약 보기">
                  {/* 심각도는 늘 맨 앞이다. 오른쪽 끝은 위협이 지나는 SaaS */}
                  <span className="fn-row-topline">
                    <SeverityDot severity={f.severity} />
                    <span className={`scenario-tag-badge ${tagClass(findingTagKey(f))}`} title={scenarioTag(findingTagKey(f)).description}>
                      {scenarioTag(findingTagKey(f)).label}
                    </span>
                    <span className="fn-row-saas" aria-label={f.providerSet.map(providerName).join(' → ')}>
                      {f.providerSet.map((p, i) => (
                        <span key={p} className="fn-row-logo">
                          {i > 0 && <ArrowRight size={11} strokeWidth={2} aria-hidden="true" />}
                          <ProviderLogo provider={providerLogoId(p)} />
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="fn-finding-title">{f.title}</span>
                  <ChevronRight className="fn-row-go" size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            )
          })
        )}
      </div>

      {exceptedCount > 0 && (
        <p className="fn-excepted-note">예외 처리된 위협 {exceptedCount}건 제외</p>
      )}
    </aside>
  )
}
