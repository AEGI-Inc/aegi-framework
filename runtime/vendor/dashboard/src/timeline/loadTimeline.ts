/**
 * Event Timeline 데이터. dev 서버는 선택된 데이터셋 폴더(v2 또는 ver IM)의 events.json, 배포본은 `/api/measured/graph/events`(실측 로그인 세션).
 * 서버에 Splunk가 연결되어 있으면 Connector가 Splunk를 검색해 D1 로그 캐시에 쓰고, 화면은 끝난 SaaS부터 D1에서 읽는다
 * (server/logEvents.ts). 연결되어 있지 않으면 D1 그래프 이벤트다.
 * 서버 조회는 기간(EventScope)이 있을 때만 한다. 화면을 열기만 해서는 불러오지 않는다.
 */
import measuredV2Local from 'virtual:aegi-measured-v2'
import measuredImLocal from 'virtual:aegi-measured-im'
import { activeDataset } from '../data/datasetBootstrap'
import type { EventScope, TimelineEvent } from './timelineAnalysis'
import type { EventLink } from './timelineAnalysis'
import { readLogEvents, type LoadProgress } from './logRead'
export type { LoadPhase, LoadProgress, ProviderLoad } from './logRead'

export interface TimelineSource {
  events: TimelineEvent[]
  /** adapter-engine 이 계산한 이벤트 연결. 아직 게시되지 않았으면 null (dev 는 데이터셋 폴더의 event_links.json) */
  links: EventLink[] | null
  origin: 'local' | 'd1' | 'splunk' | 'none'
  /** Splunk 조회 기간(UTC). D1, 로컬은 null */
  range?: { from: string; to: string } | null
  generatedAt: string | null
  problem: string | null
  /** 아직 받는 중이면 다 읽은 SaaS 수와 전체 SaaS 수. 다 받았으면 없다 */
  progress?: { done: number; total: number } | null
}

/** dev 데이터셋 폴더에 이벤트가 있으면 그것(이미 메모리에 있어 조회가 아니다). 없으면 null */
export function localTimeline(): TimelineSource | null {
  const activeLocal = activeDataset === 'measured-im' && measuredImLocal ? measuredImLocal : measuredV2Local
  const local = activeLocal?.events as { events?: TimelineEvent[]; generated_at?: string } | undefined
  const localLinks = (activeLocal?.event_links as { links?: EventLink[] } | undefined)?.links ?? null
  return local?.events ? { events: local.events, links: localLinks, origin: 'local', generatedAt: local.generated_at ?? null, problem: null } : null
}

/**
 * `onPartial` 은 SaaS 하나를 읽을 때마다 그때까지 받은 이벤트를 넘긴다(끝난 SaaS부터 화면에 보이게).
 * 다 받은 결과는 돌려주는 값이다.
 */
export async function loadTimelineEvents(apiBase = '/api/measured/graph', scope?: EventScope, onPartial?: (partial: TimelineSource) => void, onProgress?: (progress: LoadProgress) => void): Promise<TimelineSource> {
  const local = localTimeline()
  if (local) return local
  if (!scope) return { events: [], links: null, origin: 'none', generatedAt: null, problem: null }
  try {
    const query = new URLSearchParams()
    query.set('from', scope.from); query.set('to', scope.to); scope.objectKeys.forEach(key => query.append('object', key)); scope.providers?.forEach(p => query.append('provider', p))
    const read = await readLogEvents(apiBase, query, {
      onProgress,
      onPage: onPartial && (partial => onPartial({ events: partial.events, links: null, origin: 'splunk', range: partial.range, generatedAt: null, problem: null, progress: partial.progress })),
    })
    if (read.origin === 'd1') return { events: read.events, links: read.links, origin: 'd1', generatedAt: read.generatedAt, problem: read.problem, range: null }
    return { events: read.events, links: read.links, origin: 'splunk', generatedAt: read.generatedAt, problem: read.problem, range: read.range, progress: null }
  } catch (err) {
    return { events: [], links: null, origin: 'none', generatedAt: null, problem: err instanceof Error ? err.message : String(err) }
  }
}