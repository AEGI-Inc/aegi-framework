import { useSyncExternalStore } from 'react'
import type { Provider } from '../model/object'

export type ItemStatus = 'pass' | 'fail' | 'unknown' | 'not_collected' | 'org_policy' | 'manual'
export interface Target { key: string; in_graph: boolean; name: string; value: unknown; status: string }
export interface Item {
  standard: string; item_id: string; title: string; status: ItemStatus; threshold: string
  rule: { source: string; field: string; condition: string; combine: string }; targets: Target[]; note: string
}
export interface Finding { id: string; provider: Provider; text: string; layer: string; group: string; kind: string; items: Item[] }
export interface Standard { id: string; name: string; tier: number; provider: Provider; raw_run: string }
export type ComplianceVerdictStatus = 'fail' | 'pass' | 'partial' | 'unknown' | 'manual' | 'no_check'
export interface ComplianceVerdictCounts { pass: number; fail: number; unknown: number; not_collected?: number; org_policy: number; manual: number }
export interface ComplianceVerdictItem {
  key: string; framework: string; id: string; tier: string; status: ComplianceVerdictStatus
  counts: ComplianceVerdictCounts; fail_findings: string[]; findings: string[]
}
export interface ComplianceFix { finding: string; items: string[]; fail_targets: number; score: number }
export interface ComplianceVerdicts {
  knowledge_commit: string; rule: string; items: ComplianceVerdictItem[]; fixes?: ComplianceFix[]
}
export interface StandardResults { generated_at: string; note: string; standards: Standard[]; findings: Finding[]; compliance?: ComplianceVerdicts }

/**
 * 기준별 판정 결과(standard_results). 그래프와 독립된 D1 판정 이력의 최신 판정을 읽는다. 그래프 데이터셋을 바꿔도 지우지 않는다.
 * 개별 객체 상세처럼 데이터셋을 직접 받지 않는 화면도 읽도록 모듈 저장소에 둔다.
 */
let snapshot: StandardResults | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export const isStandardResults = (v: unknown): v is StandardResults => !!v && typeof v === 'object' && Array.isArray((v as StandardResults).standards) && Array.isArray((v as StandardResults).findings)

/** 판정 이력에서 받은 결과. 그래프 번들은 이 저장소를 변경하지 않는다. */
export function setStandardResults(value: unknown): void {
  const next = isStandardResults(value) ? value : undefined
  if (next === snapshot) return
  snapshot = next
  emit()
}

export const getStandardResults = (): StandardResults | undefined => snapshot

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useStandardResults = (): StandardResults | undefined => useSyncExternalStore(subscribe, getStandardResults)

export interface AssessmentRun { id: string; generated_at: string; published_at: string; source_snapshot_id: string | null; standards_count: number; findings_count: number }
interface HistoryState { loading: boolean; error: string; runs: AssessmentRun[]; currentId: string | null; selected: AssessmentRun | null }
let historyState: HistoryState = { loading: false, error: '', runs: [], currentId: null, selected: null }
let requestId = 0
export const useStandardHistory = (): HistoryState => useSyncExternalStore(subscribe, () => historyState)
/** 화면 밖(AI 도구)에서 읽는 지금 이력 상태 */
export const getStandardHistory = (): HistoryState => historyState

/** Ignore stale responses when users change the selected run quickly. Failures never display an old run as the new one. */
export async function loadStandardHistory(runId?: string, fetcher: typeof fetch = fetch): Promise<void> {
  const seq = ++requestId
  historyState = { ...historyState, loading: true, error: '', selected: null }
  setStandardResults(undefined)
  emit()
  try {
    const list = await fetcher('/api/measured/standard-results/history', { credentials: 'same-origin', cache: 'no-store' })
    if (!list.ok) throw new Error('load')
    const body = await list.json() as { current_id: string | null; items: AssessmentRun[] }
    if (!Array.isArray(body.items)) throw new Error('format')
    const id = runId ?? body.current_id
    let selected: AssessmentRun | null = null
    let results: StandardResults | undefined
    if (id) {
      const response = await fetcher(`/api/measured/standard-results?run=${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) throw new Error('load')
      const value = await response.json() as { run: AssessmentRun; results: unknown }
      if (value.run?.id !== id || !isStandardResults(value.results)) throw new Error('format')
      selected = value.run
      results = value.results
    }
    if (seq !== requestId) return
    historyState = { loading: false, error: '', runs: body.items, currentId: body.current_id, selected }
    setStandardResults(results)
  } catch {
    if (seq !== requestId) return
    historyState = { ...historyState, loading: false, error: '판정 이력을 불러오지 못했습니다.', selected: null }
  }
  emit()
}
