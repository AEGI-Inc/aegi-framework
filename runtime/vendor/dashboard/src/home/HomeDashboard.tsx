import { useMemo } from 'react'
import ProviderLogo from '../ProviderLogo'
import { scenarioTag, findingTagKey, findingGroupKey, tagClass, tagOptions, type ThreatGroupKey } from '../findings/scenarioTags'
import { sortBySeverity, type Severity } from '../findings/severity'
import SeverityDot from '../findings/SeverityDot'
import { includeUnconfirmedInList, openThreatListWith } from '../findings/ThreatIndex'
import type { FindingV2 } from '../model/findingV2'
import type { GraphStoreV2 } from '../model/graph'
import type { Provider } from '../model/object'
import { BASE_PROVIDERS, providerLogoId, providerName, sortProviders } from '../findings/providers'
import HomeEcosystemGraph from './HomeEcosystemGraph'
import { projectSemanticGraph } from '../semantic-graph/projectGraph'
import { formatKst, utcTitle } from '../utils/time'
import { COLLECTION_STATE_LABEL, collectionState, type ProviderCollection } from '../model/collectionFreshness'
import './homeDashboard.css'

type HomeDashboardProps = {
  findings: FindingV2[]
  graph: GraphStoreV2
  /** 이 환경이 언제까지 수집된 것인지 (ISO) */
  collectedAt: string
  /** SaaS별 마지막 수집과 상태 */
  collection: Map<string, ProviderCollection>
  now: Date
  onOpenThreat: () => void
  onOpenFinding: (id: string) => void
  onOpenAdapters: () => void
  onOpenGraph: (context?: { provider?: DashboardProvider; sourceProvider?: DashboardProvider; targetProvider?: DashboardProvider; findingIds?: string[] }) => void
}

type DashboardProvider = Provider
type ProviderPair = {
  key: string
  source: DashboardProvider
  target: DashboardProvider
  count: number
  findingIds: string[]
}

/** 우선 위협 줄 수 */
const TOP_COUNT = 5

const pairKey = (left: DashboardProvider, right: DashboardProvider) =>
  [left, right].sort().join('::')



export default function HomeDashboard({
  findings,
  graph,
  collectedAt,
  collection,
  now,
  onOpenThreat,
  onOpenFinding,
  onOpenAdapters,
  onOpenGraph,
}: HomeDashboardProps) {
  /* 연동 SaaS: 처음 네 SaaS와 데이터에 들어온 SaaS 전부. 새 SaaS(Atlassian 등)가 들어오면 바로 센다 */
  const PROVIDERS = useMemo(() => sortProviders([...BASE_PROVIDERS, ...graph.objectsByProvider.keys()]), [graph])
  const asDashboardProvider = (provider: Provider): DashboardProvider | null =>
    PROVIDERS.includes(provider) ? provider : null

  /* 분류별 위협 수. 위협 목록의 분류 거르기와 같은 묶음(findingGroupKey)으로 센다 */
  const findingGroups = useMemo(() => {
    const counts = new Map<ThreatGroupKey | 'other', number>()
    findings.forEach(finding => {
      const key = findingGroupKey(finding) ?? 'other'
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    const groups: Array<{ key: ThreatGroupKey | 'other'; label: string; count: number }> = tagOptions(findings.map(findingTagKey)).map(key => ({
      key,
      label: scenarioTag(key).label,
      count: counts.get(key) ?? 0,
    }))
    if (counts.has('other')) groups.push({ key: 'other', label: scenarioTag(undefined).label, count: counts.get('other')! })
    return groups
  }, [findings])

  /* Cross-SaaS Graph 화면의 SaaS 요약과 같은 계산. 왼쪽 SaaS 연결 그림과 영향 경로 목록이 이것 하나를 같이 쓴다. */
  const ecosystem = useMemo(
    () => projectSemanticGraph(graph, findings, 'ecosystem', { relationLens: 'all', includeIdentityLinks: true }),
    [graph, findings],
  )

  /* 영향 경로는 그래프의 SaaS 사이 선과 같은 수를 쓴다. Finding의 근거(관계, 동일인 연결)가
     실제로 지나가는 선마다 세고, 한 쌍 사이에 선이 여럿이면 Finding을 한 번만 센다.
     전에는 Finding의 연관 SaaS 목록 앞 두 개로 쌍을 정해, 그래프의 선 숫자와 달랐다.
     화살표 방향은 그 쌍에 걸린 첫 Finding의 연관 SaaS 목록 순서를 따른다. */
  const affectedPaths = useMemo<ProviderPair[]>(() => {
    const pairs = new Map<string, { left: DashboardProvider; right: DashboardProvider; ids: Set<string> }>()
    ecosystem.edges.forEach(edge => {
      if (edge.findingCount === 0) return
      const left = asDashboardProvider(edge.sourceSemanticNodeId as Provider)
      const right = asDashboardProvider(edge.targetSemanticNodeId as Provider)
      if (!left || !right || left === right) return
      const key = pairKey(left, right)
      const pair = pairs.get(key) ?? { left, right, ids: new Set<string>() }
      edge.findingIds.forEach(id => pair.ids.add(id))
      pairs.set(key, pair)
    })
    return [...pairs.entries()].map(([key, pair]) => {
      const first = findings.find(finding => pair.ids.has(finding.id))
      const order = first?.providerSet ?? []
      const leftAt = order.indexOf(pair.left)
      const rightAt = order.indexOf(pair.right)
      const leftFirst = leftAt >= 0 && (rightAt < 0 || leftAt <= rightAt)
      return {
        key,
        source: leftFirst ? pair.left : pair.right,
        target: leftFirst ? pair.right : pair.left,
        count: pair.ids.size,
        findingIds: [...pair.ids],
      }
    }).sort((a, b) => b.count - a.count)
  }, [ecosystem, findings])

  const providerStatus = useMemo(() => {
    const result = new Map<DashboardProvider, boolean>()
    PROVIDERS.forEach(provider => {
      result.set(provider, (graph.objectsByProvider.get(provider)?.length || 0) > 0)
    })
    return result
  }, [graph])

  const syncedCount = PROVIDERS.filter(provider => providerStatus.get(provider)).length
  /* 수집이 정상인 SaaS. 전에는 객체가 하나라도 있으면 「연결됨」으로 셌다 */
  const okCount = PROVIDERS.filter(provider => collection.get(provider)?.state === 'ok').length
  const overall = collectionState(collectedAt, now)

  /* 위협 수를 심각도별로. 큰 숫자 아래 배지로 단다 */
  const severityCounts = useMemo(() => {
    const order: Severity[] = ['critical', 'high', 'medium', 'low']
    return order.map(level => ({ level, count: findings.filter(f => f.severity === level).length })).filter(x => x.count > 0)
  }, [findings])
  const topFindings = useMemo(() => sortBySeverity(findings).slice(0, TOP_COUNT), [findings])

  /* 위협 전체 건수에서 목록을 열면 미확정 위협까지 보여 건수를 맞춘다 */
  const openAll = () => {
    includeUnconfirmedInList()
    onOpenThreat()
  }

  /* 분류를 누르면 그 분류로 거른 위협 목록이 열린다. 다른 거르기는 푼다 */
  const openGroup = (key: ThreatGroupKey | 'other') => {
    openThreatListWith({ tags: [key], showUnconfirmed: true })
    onOpenThreat()
  }

  return (
    <main className="home-dashboard-v9">
      <section className="home-v9-title page-title-bar page-title-bar-inset">
        <h1>Overview</h1>
        <span className="home-v9-title-meta" title={utcTitle(collectedAt)}>수집 {formatKst(collectedAt)}</span>
      </section>

      {/* 위쪽 두 칸은 위협과 수집 상태만 센다. 객체, 관계 같은 수집 규모는 Adapters 머리에 있다.
          칸마다 눌러 그 화면으로 간다 */}
      <section className="hp-kpis" aria-label="우선 확인 항목">
        <button type="button" className="hp-kpi" onClick={openAll}>
          <span className="hp-kpi-label">위협</span>
          <strong>{findings.length}<small>건</small></strong>
          <span className="hp-kpi-badges">
            {severityCounts.map(s => (
              <SeverityDot key={s.level} severity={s.level} count={s.count} />
            ))}
          </span>
        </button>
        <button type="button" className="hp-kpi" onClick={onOpenAdapters} title={`수집된 SaaS ${syncedCount}곳`}>
          <span className="hp-kpi-label">마지막 수집</span>
          <strong>
            {overall.daysAgo === null ? '없음' : overall.daysAgo === 0 ? '오늘' : overall.daysAgo}
            {overall.daysAgo !== null && overall.daysAgo > 0 && <small>일 전</small>}
          </strong>
          <span className="hp-kpi-badges">
            <b className={`collect-badge is-${overall.state}`}>{COLLECTION_STATE_LABEL[overall.state]}</b>
            <span className="hp-kpi-sub">SaaS 수집 정상 {okCount} / {PROVIDERS.length}</span>
          </span>
        </button>
      </section>

      {/* 왼쪽은 SaaS가 어떻게 이어져 있는지 보는 그림, 오른쪽은 우선 위협과 Cross-SaaS 영향 경로 */}
      <section className="hp-layout">
        <article className="home-v9-card hp-graph-card">
          <div className="home-v9-card-head">
            <h2>Cross-SaaS Graph</h2>
            <button type="button" className="home-v9-link" onClick={() => onOpenGraph()}>그래프 전체 보기</button>
          </div>
          <div className="hp-graph-stage">
            <HomeEcosystemGraph projected={ecosystem} onOpenGraph={onOpenGraph} />
          </div>
        </article>

        <div className="hp-side-stack">
          <article className="home-v9-card hp-top">
            <div className="home-v9-card-head">
              <h2 className="hp-top-title">우선 위협</h2>
              <button type="button" className="home-v9-link" onClick={openAll}>모두 보기</button>
            </div>
            {/* 분류 단추는 머리 아래 띠에 둔다. 머리에 두면 단추가 두 줄이 될 때 머리 밖으로 넘치고 제목이 꺾였다 */}
            <div className="hp-tag-bar" aria-label="분류별 위협 목록 열기">
              {findingGroups.map(group => (
                <button type="button" key={group.key} className="hp-tag-chip" onClick={() => openGroup(group.key)}>
                  {group.label} <b>{group.count}</b>
                </button>
              ))}
            </div>
            {topFindings.length === 0 ? (
              <p className="hp-empty">열린 위협 없음</p>
            ) : (
              <ol className="hp-rows">
                {topFindings.map(finding => {
                  const tagKey = findingTagKey(finding)
                  return (
                    <li key={finding.id}>
                      <button type="button" className="hp-row" onClick={() => onOpenFinding(finding.id)}>
                        <span className="hp-row-meta">
                          <SeverityDot severity={finding.severity} />
                          <span className={`scenario-tag-badge ${tagClass(tagKey)}`}>{scenarioTag(tagKey).label}</span>
                          <span className="hp-row-saas" aria-label={finding.providerSet.map(providerName).join(', ')}>
                            {finding.providerSet.map((provider, index) => (
                              <span key={provider} className="hp-row-logo">
                                {index > 0 && <span className="hp-row-arrow" aria-hidden="true">→</span>}
                                <ProviderLogo provider={providerLogoId(provider)} />
                              </span>
                            ))}
                          </span>
                        </span>
                        <span className="hp-row-title">{finding.title}</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </article>

          <article className="home-v9-card hp-side">
            <div className="home-v9-card-head">
              <h2>Cross-SaaS 영향 경로</h2>
              <button type="button" className="home-v9-link" onClick={() => onOpenGraph()}>그래프 전체 보기</button>
            </div>
              <div className="hp-paths">
              {affectedPaths.map(path => (
                <button type="button" className="hp-path" key={path.key} onClick={() => onOpenGraph({ sourceProvider: path.source, targetProvider: path.target, findingIds: path.findingIds })}>
                  <span className="home-v9-path-provider"><ProviderLogo provider={providerLogoId(path.source)} />{providerName(path.source)}</span>
                  <span className="hp-row-arrow" aria-hidden="true">→</span>
                  <span className="home-v9-path-provider"><ProviderLogo provider={providerLogoId(path.target)} />{providerName(path.target)}</span>
                  <b className="hp-path-count">위협 {path.count}</b>
                </button>
              ))}
            </div>
          </article>
        </div>
      </section>
    </main>
  )
}
