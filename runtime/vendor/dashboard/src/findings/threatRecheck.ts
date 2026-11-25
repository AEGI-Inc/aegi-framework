import type { FindingV2 } from '../model/findingV2'
import type { GraphStoreV2 } from '../model/graph'
import type { EvidenceStore } from '../model/evidence'
import type { Provider } from '../model/object'
import { findingPathProviders } from './findingPath'

/**
 * 위협 다시 수집에 전달할 provider 식별자 목록을 뽑는다.
 * 중복을 제거하고 빈 목록이면 빈 배열을 반환한다.
 */
export function getThreatRecheckProviders(
  finding: FindingV2,
  graph?: GraphStoreV2,
  evidenceStore?: EvidenceStore
): string[] {
  let providers: Provider[] = []
  if (graph && evidenceStore) {
    try {
      providers = findingPathProviders(finding, graph, evidenceStore)
    } catch {
      providers = finding.providerSet ?? []
    }
  } else {
    providers = finding.providerSet ?? []
  }

  const seen = new Set<string>()
  const result: string[] = []
  for (const p of providers) {
    const trimmed = String(p).trim().toLowerCase()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      result.push(trimmed)
    }
  }
  return result
}

export interface CollectStatusResponse {
  state: 'idle' | 'running' | 'done' | 'failed'
  jobId?: string
  provider?: string
  startedAt?: string
  finishedAt?: string
  step?: string
  lines?: number
  result?: unknown
  error?: string
}

export type PostCollectResult =
  | { success: true; jobId: string }
  | { conflict: true }
  | { success: false; error?: string }

export async function postCollectThreat(
  providers: string[]
): Promise<PostCollectResult> {
  try {
    const res = await fetch('/__aegi/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ provider: providers.join(',') }),
    })
    if (res.status === 409) return { conflict: true }
    if (res.status === 202 || res.ok) {
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; jobId?: string }
      return { success: true, jobId: data.jobId ?? '' }
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    return { success: false, error: data.error }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '수집 요청에 실패했습니다.' }
  }
}

export async function fetchCollectStatus(): Promise<CollectStatusResponse | null> {
  try {
    const res = await fetch('/__aegi/collect-status', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!res.ok) return null
    return (await res.json()) as CollectStatusResponse
  } catch {
    return null
  }
}
