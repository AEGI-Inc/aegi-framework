import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, ChevronRight, Download, Search, ShieldOff, X } from 'lucide-react'
import type { FindingV2 } from '../model/findingV2'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId, providerName } from './providers'
import { scenarioTag, scenarioTagsFor, findingTagKey, isThreatGroupKey, THREAT_GROUP_ORDER, type ThreatGroupKey } from './scenarioTags'
import type { Provider } from '../model/object'
import { SEVERITY_RANK, severityClass, severityLabel } from './severity'
import { type FindingView } from '../exceptions/applyExceptions'
import { engineRow, sortRows, type ThreatRow } from './threatRows'
import { LiveCount, readListMemory, scrollBox, writeListMemory } from '../ui/ListScreen'
import { HANDLING_LABEL, HANDLING_STATES, type HandlingState, type ThreatHandling } from '../model/handling'
import HandlingBadge from '../handling/HandlingBadge'
import type { Severity } from './severity'
import type { GraphStoreV2 } from '../model/graph'
import type { EvidenceStore } from '../model/evidence'

/* 목록에서 보던 자리. 상세에 다녀오거나, 다른 화면에 갔다 오거나, 새로고침해도 거르기와 스크롤,
   마지막으로 연 위협이 그대로다. Access Gaps, Exceptions, Credentials 목록과 같은 방식(탭 세션)이다. */
const MEMORY_KEY = 'aegi:threat-list:v1'
type ListMemory = {
  showExcepted: boolean
  /** 위협 판정 V2 미확정 위협도 보임. 기본은 켜짐(확실성은 심각도와 판정에 쓰지 않고 「추정」 표시로만 쓴다) */
  showUnconfirmed?: boolean
  tags: Array<ThreatGroupKey | 'other'>
  saas: Provider[]
  query: string
  scrollTop: number
  lastId: string
  severities: Severity[]
  handling: HandlingState[]
  /** 예전 근거 거르기를 적어 둔 값. 지금은 'config'(설정 점검 탭)로 읽는 데만 쓴다 */
  basis?: string
  /** 설정 점검 탭. 위협 4유형과 섞지 않고 따로 본다. 처음에는 위협 탭 */
  configList?: boolean
}
const memory = () => readListMemory<ListMemory>(MEMORY_KEY)
const remember = (patch: Partial<ListMemory>) => writeListMemory<ListMemory>(MEMORY_KEY, patch)

/* 거르기는 주소에도 남긴다(#threat?tag=…&saas=…&sev=…&state=…&q=…&excepted=1).
   링크를 받은 사람도, 뒤로 가기로 돌아와도 같은 목록이다. 주소에 거르기가 있으면 탭에 적어 둔 것보다 앞선다 */
type ListFilters = Pick<ListMemory, 'tags' | 'saas' | 'severities' | 'handling' | 'query' | 'showExcepted' | 'showUnconfirmed' | 'configList'>
const FILTER_PARAMS = ['tag', 'saas', 'sev', 'state', 'q', 'excepted', 'unconfirmed', 'basis', 'src', 'list']

function filtersFromHash(): Partial<ListFilters> | null {
  const hash = window.location.hash
  if (!/^#threat\?/i.test(hash) || /[?&]finding=/i.test(hash)) return null
  const params = new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
  if (!FILTER_PARAMS.some(key => params.has(key))) return null
  const list = (key: string) => (params.get(key) ?? '').split(',').filter(Boolean)
  return {
    tags: list('tag').filter(k => k === 'other' || isThreatGroupKey(k)) as ListFilters['tags'],
    saas: list('saas') as Provider[],
    severities: list('sev').filter((s): s is Severity => s in SEVERITY_RANK),
    handling: list('state').filter((s): s is HandlingState => (HANDLING_STATES as readonly string[]).includes(s)),
    query: params.get('q') ?? '',
    showExcepted: params.get('excepted') === '1',
    showUnconfirmed: params.get('unconfirmed') !== '0',
    // 예전 주소의 src=config, basis=config, tag=config_gap 은 설정 점검 탭으로 읽는다
    configList: params.get('list') === 'config' || params.get('src') === 'config' || params.get('basis') === 'config' || list('tag').includes('config_gap'),
  }
}

function filtersToHash(filters: ListFilters): string {
  const params = new URLSearchParams()
  if (filters.tags.length) params.set('tag', filters.tags.join(','))
  if (filters.saas.length) params.set('saas', filters.saas.join(','))
  if (filters.severities.length) params.set('sev', filters.severities.join(','))
  if (filters.handling.length) params.set('state', filters.handling.join(','))
  if (filters.query) params.set('q', filters.query)
  if (filters.showExcepted) params.set('excepted', '1')
  if (!filters.showUnconfirmed) params.set('unconfirmed', '0')
  if (filters.configList) params.set('list', 'config')
  const query = params.toString().replace(/%2C/g, ',')
  return query ? `#threat?${query}` : '#threat'
}

/** 다른 화면(Overview 분류 단추)에서 이 거르기로 목록을 연다. 나머지 거르기와 스크롤은 처음으로 */
export function openThreatListWith(patch: Pick<Partial<ListMemory>, 'tags' | 'severities' | 'showUnconfirmed'>) {
  // 설정 점검 분류로 열면 설정 점검 탭, 그 밖은 위협 탭
  remember({ tags: [], saas: [], query: '', severities: [], handling: [], scrollTop: 0, ...patch, configList: Boolean(patch.tags?.includes('config_gap')) })
}

/** 다른 화면이 전체 건수를 보여 주고 목록을 열 때. 미확정 위협까지 보여 건수를 맞춘다 */
export function includeUnconfirmedInList() {
  remember({ showUnconfirmed: true })
}

export interface ThreatIndexProps {
  /** 예외를 적용한 뒤 열린 위협 */
  findings: FindingV2[]
  /** 예외 적용 결과 전체 — '예외 포함'과 행의 예외 표시에 쓴다 */
  views?: FindingView[]
  exceptedCount?: number
  onOpenFinding: (findingId: string) => void
  onException?: (findingId: string) => void
  onOpenExceptions?: () => void
  /** 지문 → 처리 상태 기록. 기록이 없으면 New다 */
  handling?: Map<string, ThreatHandling>
  /** 처리하던 위협 중 이번 수집에서 사라진 것 (다음 수집에서 사라지면 해결됨으로 본다) */
  gone?: ThreatHandling[]
  /** 제목 줄의 위협, 조치 보기 바꾸기 */
  viewSwitch?: ReactNode
  /** 지금 보이는(거른) 행을 CSV 로 내려받는다. 있으면 제목 줄에 「CSV 내보내기」가 생긴다 */
  onExport?: (visible: ThreatRow[]) => void
  /** 최신 기준별 판정의 위반 행(threatRows.configRows). null 이면 판정 이력을 불러오지 않은 것이다 */
  configRows?: ThreatRow[] | null
  /** 설정 행을 누르면 Threat 안에서 설정 위반 상세를 연다 */
  onOpenConfig?: (row: ThreatRow) => void
  /** 근거 활동 기록 중 합성 기록 수. 0이 아니면 수집 기록 칸에 합성 배지가 붙는다 */
  syntheticOf?: (finding: FindingV2) => number
  graph?: GraphStoreV2
  evidenceStore?: EvidenceStore
}

/**
 * Threat Analysis 첫 화면.
 *
 * 전에는 이 메뉴를 누르면 곧장 첫 위협 상세로 들어가서, 탐지된 다른
 * Finding이 몇 건인지도 화면에서 알 수 없었다. 담당자가 먼저 보는 건
 * "지금 무엇이 몇 건 떠 있고 어디부터 봐야 하는가"이므로 목록을 앞에
 * 두고, 심각도가 높은 순으로 정렬한다.
 */
export default function ThreatIndex({
  findings: openFindings,
  views = [],
  exceptedCount = 0,
  onOpenFinding,
  onException,
  onOpenExceptions,
  handling = new Map(),
  gone = [],
  syntheticOf,
  onExport,
  viewSwitch,
  graph,
  evidenceStore,
  configRows = [],
  onOpenConfig,
}: ThreatIndexProps) {
  /* 처음 거르기: 주소에 있으면 주소, 없으면 탭에 적어 둔 것. 탭에 남은 옛 분류 키는 버린다 */
  const [initial] = useState(() => {
    const merged = { ...memory(), ...(filtersFromHash() ?? {}) }
    // 설정 점검은 분류가 아니라 탭이다. 다른 화면이 설정 점검 분류로 열면 설정 점검 탭으로 연다
    const tags = merged.tags ?? []
    return {
      ...merged,
      configList: Boolean(merged.configList) || merged.basis === 'config' || tags.includes('config_gap'),
      tags: tags.filter(k => k !== 'config_gap' && (k === 'other' || isThreatGroupKey(k))),
    }
  })
  // 예외 포함을 켜면 예외로 가린 위협도 「예외 처리됨」 배지를 단 줄로 보인다.
  const [showExcepted, setShowExcepted] = useState(() => initial.showExcepted ?? false)
  const viewById = useMemo(() => new Map(views.map(v => [v.original.id, v])), [views])
  // 추정 포함을 끄면 위협 판정 V2 의 미확정 위협을 뺀다. 기본은 켜짐. 옛 위협과 설정 위반은 확실성이 없어 늘 보인다
  const [showUnconfirmed, setShowUnconfirmed] = useState(() => initial.showUnconfirmed ?? true)
  const unconfirmedCount = useMemo(
    () => (showExcepted && views.length ? views.map(v => v.finding) : openFindings).filter(f => f.threatCertainty === '미확정').length,
    [showExcepted, views, openFindings]
  )
  const engineFindings = useMemo(
    () => (showExcepted && views.length ? views.map(v => v.finding) : openFindings)
      .filter(f => showUnconfirmed || f.threatCertainty !== '미확정'),
    [showExcepted, showUnconfirmed, views, openFindings]
  )
  /* 위협과 설정 점검은 탭으로 나눈다. 처음에는 위협만 */
  const [configList, setConfigList] = useState(() => initial.configList ?? false)
  const rows = useMemo(() => (configList ? configRows ?? [] : engineFindings.map(engineRow)), [configList, engineFindings, configRows])

  // 고른 게 없으면 전부 보여 준다. "전체"를 따로 고르지 않아도 된다.
  const [activeTags, setActiveTags] = useState<Array<ThreatGroupKey | 'other'>>(() => initial.tags)
  const [activeSaas, setActiveSaas] = useState<Provider[]>(() => initial.saas ?? [])
  const [query, setQuery] = useState(() => initial.query ?? '')
  const [activeSeverities, setActiveSeverities] = useState<Severity[]>(() => initial.severities ?? [])
  const [activeHandling, setActiveHandling] = useState<HandlingState[]>(() => initial.handling ?? [])
  const [showGone, setShowGone] = useState(false)
  const stateOf = (row: ThreatRow): HandlingState => handling.get(row.fingerprint)?.state ?? 'new'
  const [lastId] = useState(() => memory().lastId ?? '')
  const pageRef = useRef<HTMLElement>(null)

  // 거르기는 바뀔 때마다 탭과 주소에 적어 둔다. 주소는 기록을 쌓지 않고 바꾼다
  useLayoutEffect(() => {
    const filters = { showExcepted, showUnconfirmed, tags: activeTags, saas: activeSaas, query, severities: activeSeverities, handling: activeHandling, configList }
    remember(filters)
    const hash = window.location.hash
    const next = filtersToHash(filters)
    if (/^#threat(\?|$)/i.test(hash) && !/[?&]finding=/i.test(hash) && hash !== next) {
      window.history.replaceState(window.history.state, '', next)
    }
  }, [showExcepted, showUnconfirmed, activeTags, activeSaas, query, activeSeverities, activeHandling, configList])

  // 보던 자리로 되돌리고, 굴릴 때마다 적어 둔다
  useLayoutEffect(() => {
    const box = scrollBox(pageRef.current)
    box.scrollTop = memory().scrollTop ?? 0
    const recent = lastId ? pageRef.current?.querySelector<HTMLElement>(`[data-finding-id="${CSS.escape(lastId)}"]`) : null
    recent?.scrollIntoView({ block: 'nearest' })
    let frame = 0
    const target: HTMLElement | Window = box === document.scrollingElement ? window : box
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => remember({ scrollTop: box.scrollTop }))
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      target.removeEventListener('scroll', onScroll)
    }
  }, [lastId])

  const openRow = (row: ThreatRow) => {
    remember({ lastId: row.key, scrollTop: scrollBox(pageRef.current).scrollTop })
    if (row.engine) onOpenFinding(row.key)
    else onOpenConfig?.(row)
  }

  const sorted = useMemo(() => sortRows(rows), [rows])

  const countByTag = useMemo(() => {
    const counts = new Map<ThreatGroupKey | 'other', number>()
    for (const row of rows) counts.set(row.group, (counts.get(row.group) ?? 0) + 1)
    return counts
  }, [rows])

  // 칩으로 띄울 SaaS는 실제로 등장한 것만 모은다. 고정 목록을 쓰면
  // 이 환경에 없는 SaaS가 0건짜리 칩으로 늘 남는다.
  const saasList = useMemo(() => {
    const counts = new Map<Provider, number>()
    for (const row of rows) {
      for (const provider of new Set(row.providers)) counts.set(provider, (counts.get(provider) ?? 0) + 1)
    }
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || providerName(a[0]).localeCompare(providerName(b[0]))
    )
  }, [rows])

  // 검색 대상은 행마다 threatRows 가 모아 둔 글이다(제목, 요약, ID, 분류, SaaS, 출처)
  const needle = query.trim().toLowerCase()

  const visible = useMemo(
    () =>
      sorted.filter(row => {
        if (!configList && activeTags.length > 0 && !activeTags.includes(row.group)) return false
        // SaaS는 하나라도 걸치면 포함이다. 여러 SaaS를 오가는 것이 이
        // 위협의 성격이라 전부 일치를 요구하면 결과가 거의 빈다.
        if (activeSaas.length > 0 && !row.providers.some(p => activeSaas.includes(p))) return false
        if (needle && !row.searchText.includes(needle)) return false
        if (activeSeverities.length > 0 && !activeSeverities.includes(row.severity)) return false
        if (activeHandling.length > 0 && !activeHandling.includes(stateOf(row))) return false
        return true
      }),
    // stateOf 는 handling 에서 나온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sorted, configList, activeTags, activeSaas, needle, activeSeverities, activeHandling, handling]
  )

  const toggleTag = (key: ThreatGroupKey) => {
    setActiveTags(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  }

  const toggleSaas = (provider: Provider) => {
    setActiveSaas(prev => (prev.includes(provider) ? prev.filter(p => p !== provider) : [...prev, provider]))
  }

  const clearAll = () => {
    setActiveTags([])
    setActiveSaas([])
    setQuery('')
    setActiveSeverities([])
    setActiveHandling([])
  }

  const toggleSeverity = (level: Severity) =>
    setActiveSeverities(prev => (prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]))
  const toggleHandling = (state: HandlingState) =>
    setActiveHandling(prev => (prev.includes(state) ? prev.filter(s => s !== state) : [...prev, state]))

  const severityCounts = (['critical', 'high', 'medium', 'low', 'info'] as Severity[])
    .map(level => ({ level, count: rows.filter(r => r.severity === level).length }))
    .filter(entry => entry.count > 0)
  const handlingCount = (state: HandlingState) => rows.filter(r => stateOf(r) === state).length

  const filtered = activeSaas.length > 0 || needle.length > 0 || activeSeverities.length > 0 || activeHandling.length > 0 || (!configList && activeTags.length > 0)

  return (
    <main className="threat-index" ref={pageRef}>
      <header className="ti-topbar page-title-bar page-title-bar-inset">
        <h1>Threat</h1>
        {viewSwitch}
        {onExport && visible.length > 0 && (
          <button type="button" className="ti-export" onClick={() => onExport(visible)}>
            <Download size={14} strokeWidth={2} aria-hidden="true" /> CSV 내보내기 ({visible.length}건)
          </button>
        )}
      </header>

      {/* 거르기. 검색 줄에 목록을 넓히는 스위치(예외 포함, 추정 포함)를 두고,
          아래 흰 칸에 심각도, 처리 상태 / 분류, SaaS 를 두 열로 맞춘다. 고른 조건은 AND 로 겹쳐 걸린다 */}
      <div className="ti-filterbar ti-filterbar-stack">
        <div className="ti-list-tabs" role="group" aria-label="목록 종류">
          <button type="button" className={!configList ? 'on' : ''} aria-pressed={!configList} onClick={() => setConfigList(false)}>
            위협 <em>{engineFindings.length}</em>
          </button>
          <button type="button" className={configList ? 'on' : ''} aria-pressed={configList} onClick={() => setConfigList(true)}>
            설정 점검 <em>{configRows?.length ?? 0}</em>
          </button>
        </div>
        <div className="ti-filter-row">
        <div className="ti-search">
          <Search size={14} strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="제목, 분류, SaaS, 위협 ID 검색"
            aria-label="위협 검색"
            onChange={event => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="ti-search-clear"
              aria-label="검색어 지우기"
              onClick={() => setQuery('')}
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          )}
        </div>

        {/* 목록을 거르는 스위치라 검색 옆에 둔다. 세로 선으로 검색과 가른다 */}
        {!configList && (views.length > 0 || unconfirmedCount > 0) && <span className="ti-filter-sep" aria-hidden="true" />}
        {views.length > 0 && !configList && (
          <label className="ti-show-excepted">
            <span>예외 포함</span>
            <input type="checkbox" checked={showExcepted} onChange={event => setShowExcepted(event.target.checked)} />
            <i aria-hidden="true" />
          </label>
        )}
        {unconfirmedCount > 0 && !configList && (
          <label className="ti-show-excepted">
            <span>추정 포함 <b>{unconfirmedCount}</b></span>
            <input type="checkbox" checked={showUnconfirmed} onChange={event => setShowUnconfirmed(event.target.checked)} />
            <i aria-hidden="true" />
          </label>
        )}
        </div>

        <div className="ti-filter-grid">
        <div className="ti-filter-group" role="group" aria-label="심각도 필터">
          <span className="ti-filter-legend">심각도</span>
          {severityCounts.map(({ level, count }) => {
            const on = activeSeverities.includes(level)
            return (
              <button type="button" key={level} className={`ti-filter-chip ti-severity-chip ${on ? 'ti-on' : ''}`} aria-pressed={on} onClick={() => toggleSeverity(level)}>
                <b className={`fn-severity-badge ${severityClass(level)}`}>{severityLabel(level)}</b>
                <em>{count}</em>
              </button>
            )
          })}
        </div>

        <div className="ti-filter-group" role="group" aria-label="처리 상태 필터">
          <span className="ti-filter-legend">처리 상태</span>
          {HANDLING_STATES.map(state => {
            const on = activeHandling.includes(state)
            return (
              <button type="button" key={state} className={`ti-filter-chip ${on ? 'ti-on' : ''}`} aria-pressed={on} onClick={() => toggleHandling(state)}>
                {HANDLING_LABEL[state]}
                <em>{handlingCount(state)}</em>
              </button>
            )
          })}
          {gone.length > 0 && (
            <button type="button" className={`ti-filter-chip ${showGone ? 'ti-on' : ''}`} aria-expanded={showGone} onClick={() => setShowGone(v => !v)}>
              미탐지
              <em>{gone.length}</em>
            </button>
          )}
        </div>

        {!configList && <div className="ti-filter-group" role="group" aria-label="분류 필터">
          <span className="ti-filter-legend">분류</span>
          {/* 분류는 늘 같은 위협 4유형이라 0건도 보인다(눌리지 않음). 「비인가 접근 0」이 그 분류가 없는 것과 구별되게. 설정 점검은 탭으로 뺐다.
              심각도 칩처럼 목록과 같은 분류 배지에 수를 붙인다 */}
          {THREAT_GROUP_ORDER.filter(key => key !== 'config_gap').map(key => {
            const count = countByTag.get(key) ?? 0
            const on = activeTags.includes(key)
            return (
              <button
                type="button"
                key={key}
                className={`ti-filter-chip ti-severity-chip ${on ? 'ti-on' : ''}`}
                aria-pressed={on}
                disabled={count === 0}
                title={scenarioTag(key).description}
                onClick={() => toggleTag(key)}
              >
                <b className={`scenario-tag-badge sc-${key}`}>{scenarioTag(key).label}</b>
                <em>{count}</em>
              </button>
            )
          })}
        </div>}

        <div className="ti-filter-group" role="group" aria-label="SaaS 필터">
          <span className="ti-filter-legend">SaaS</span>
          {saasList.map(([provider, count]) => {
            const on = activeSaas.includes(provider)
            return (
              // 이름은 적지 않고 로고만 둔다. SaaS 가 늘면 이름 칩이 줄을 넘쳤다. 이름은 툴팁, 읽기 도구로.
              <button
                type="button"
                key={provider}
                className={`ti-filter-chip ti-saas-chip ${on ? 'on' : ''}`}
                aria-pressed={on}
                aria-label={`${providerName(provider)} ${count}건`}
                title={`${providerName(provider)}의 위협`}
                onClick={() => toggleSaas(provider)}
              >
                <i aria-hidden="true">
                  <ProviderLogo provider={providerLogoId(provider)} />
                </i>
                <em>{count}</em>
              </button>
            )
          })}
        </div>
        </div>

        {/* 몇 건이 걸렸는지는 거를 때만 적는다. 제목 옆의 「4 Findings」는 목록이 이미 말했다. */}
        {filtered && (
          <div className="ti-filter-result">
            <span className="ti-count">{visible.length} / {rows.length}건</span>
            <button type="button" className="ti-filter-clear" onClick={clearAll}>
              전체 보기
            </button>
          </div>
        )}
      </div>

      {configList && configRows === null && (
        <p className="ti-config-note">설정 판정 이력을 불러오지 않아 설정 위반은 목록에 없습니다.</p>
      )}

      {showGone && gone.length > 0 && (
        <section className="ti-gone" aria-label="이번 수집에서 사라진 위협">
          <ul>
            {gone.map(record => (
              <li key={record.fingerprint}>
                <HandlingBadge state="done" auto />
                <span>{record.title}</span>
                <span className="mono">{record.findingId}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <LiveCount count={visible.length} noun={filtered ? '조건에 맞는 위협' : '위협'} />
      {/* 표 구조(grid). 화면 읽기 프로그램이 줄마다 칸 이름과 값을 같이 읽는다. 줄은 Enter 로 상세를 연다 */}
      <section className="ti-table" role="grid" aria-label="탐지된 위협 목록" aria-rowcount={visible.length + 1}>
        <div className="ti-head" role="row">
          <span role="columnheader">심각도</span>
          <span role="columnheader">위협</span>
          <span role="columnheader">SaaS</span>
          <span role="columnheader">처리 상태</span>
          <span role="columnheader">증적</span>
          <span role="columnheader"><span className="sr-only">예외 처리</span></span>
        </div>

        {visible.length === 0 ? (
          <p className="ti-empty">
            {filtered ? (
              '조건에 맞는 위협 없음'
            ) : exceptedCount > 0 ? (
              <>
                열린 위협 없음{' '}
                {onOpenExceptions && (
                  <button type="button" className="ti-exception-link" onClick={onOpenExceptions}>
                    예외 {exceptedCount}건 보기
                  </button>
                )}
              </>
            ) : (
              '탐지된 위협 없음'
            )}
          </p>
        ) : (
          visible.map(row => {
            const finding = row.engine
            const tags = scenarioTagsFor(finding ? findingTagKey(finding) : row.group === 'other' ? undefined : row.group)
            const view = finding ? viewById.get(finding.id) : undefined
            const state = view?.state ?? 'open'
            const record = handling.get(row.fingerprint)
            // 행 전체가 상세로 가는 줄이다. 안에 예외 단추를 두어야 해서 <button> 이 아니라 표의 줄(role="row")로 두고
            // 초점과 Enter, Space 로 연다(단추 안에 단추는 둘 수 없다).
            // 설정 행은 onOpenConfig 가 없으면(데모 모드) 갈 상세가 없으므로 누를 수 없는 줄로 둔다.
            const openable = Boolean(row.engine || onOpenConfig)
            return (
              <div
                role="row"
                tabIndex={openable ? 0 : undefined}
                aria-label={`${severityLabel(row.severity)} ${row.title}`}
                key={row.key}
                data-finding-id={row.key}
                className={`ti-row ${state !== 'open' ? `is-${state}` : ''} ${row.key === lastId ? 'is-recent' : ''} ${openable ? '' : 'is-static'}`}
                onClick={openable ? () => openRow(row) : undefined}
                onKeyDown={event => {
                  if (!openable || event.target !== event.currentTarget) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openRow(row)
                  }
                }}
              >
                <span className="ti-cell-severity" role="gridcell">
                  <i className={`ti-severity-dot ${severityClass(row.severity)}`} />
                  <b className={`fn-severity-badge ${severityClass(row.severity)}`}>
                    {severityLabel(row.severity)}
                  </b>
                </span>

                <span className="ti-cell-main" role="gridcell">
                  {/* 분류는 제목 위 줄에 둔다. 제목과 한 줄에 섞으면 분류가
                      늘어날수록 제목이 밀려 들어간다. */}
                  <span className="ti-tag-row">
                    {state === 'excepted' && <span className="ex-state-badge excepted">예외 처리됨</span>}
                    {tags.map(tag => (
                      <span key={tag.key} className={`scenario-tag-badge sc-${tag.key}`} title={tag.description}>
                        {tag.label}
                      </span>
                    ))}
                  </span>
                  <b>
                    {row.title}
                    {row.basis === 'structural' && !row.engine?.occurrence && (
                      <i className="fd-record-badge inferred" title="실행 기록 없이 권한 연결로만 이어진 경로입니다">추정</i>
                    )}
                    {row.engine?.threatCertainty === '미확정' && (
                      <i className="fd-record-badge inferred" title="판정에 필요한 값 일부를 수집하지 못함">추정</i>
                    )}
                  </b>
                  {row.config && (
                    <small className="ti-config-items">위반 기준 {[...new Set(row.config.failItems.map(i => i.standard))].join(', ')}</small>
                  )}
                </span>

                {/* 로고만 흐름 순서로 적는다(Slack → GitHub). 이름은 툴팁 · 읽기 도구로. */}
                <span className="ti-cell-saas" role="gridcell" aria-label={row.providers.map(providerName).join(' → ')}>
                  <span className="ti-saas-logos">
                    {row.providers.map((provider, index) => (
                      <Fragment key={provider}>
                        {index > 0 && <ArrowRight className="ti-saas-arrow" size={12} strokeWidth={2.2} aria-hidden="true" />}
                        <i title={providerName(provider)}>
                          <ProviderLogo provider={providerLogoId(provider)} />
                        </i>
                      </Fragment>
                    ))}
                  </span>
                </span>

                <span className="ti-cell-handling" role="gridcell">
                  <HandlingBadge state={stateOf(row)} />
                  {record?.owner && <small title={`담당 ${record.owner}`}>{record.owner}</small>}
                </span>

                <span className="ti-cell-evidence" role="gridcell">
                  {finding ? (
                    <>
                      <b>{finding.evidenceObservationIds.length}</b>
                      {(() => {
                        /* 합성 기록을 실제 사고로 읽지 않게. 합성이 0건이면 배지가 없다 */
                        const synthetic = syntheticOf?.(finding) ?? 0
                        return synthetic > 0 && <i className="fd-record-badge synthetic">합성 {synthetic}</i>
                      })()}
                    </>
                  ) : '—'}
                </span>

                <span className="ti-cell-open" role="gridcell">
                  {finding && onException && state !== 'excepted' && (
                    <button
                      type="button"
                      className="ti-exception-btn"
                      title="예외 처리"
                      aria-label={`${finding.id} 예외 처리`}
                      onClick={event => {
                        event.stopPropagation()
                        onException(finding.id)
                      }}
                      onKeyDown={event => event.stopPropagation()}
                    >
                      <ShieldOff size={14} strokeWidth={2} />
                    </button>
                  )}
                  <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
                </span>
              </div>
            )
          })
        )}
      </section>
    </main>
  )
}
