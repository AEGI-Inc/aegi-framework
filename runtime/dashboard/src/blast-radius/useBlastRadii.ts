import type { GraphStoreV2 } from '../model/graph'
import type { Provider } from '../model/object'
import type { EffectiveAccessRow } from '../detection/v2/effectiveAccess/types'
import { computeBlastRadius, listCredentials, type BlastRadius } from '../detection/v2/blastRadius'

/** 자격증명 하나의 두 가정 결과 */
export interface CredentialBlast {
  key: string
  provider: Provider
  token: BlastRadius
  account: BlastRadius
}

/* 그래프마다 한 번만 센다 */
const cache = new WeakMap<GraphStoreV2, CredentialBlast[]>()
/* 엔진 결과를 넣은 그래프. 캐시만으로는 넣은 결과와 브라우저가 센 결과를 가를 수 없다 */
const published = new WeakSet<GraphStoreV2>()

/**
 * 그래프의 자격증명 전부를 두 가정으로 계산한다. 그래프가 같으면 한 번만 센다.
 * 실측 v2 는 48개 × 2 가정이라 화면을 열 때 바로 끝난다.
 */
export function blastRadii(graph: GraphStoreV2, eaRows?: readonly EffectiveAccessRow[]): CredentialBlast[] {
  const hit = cache.get(graph)
  if (hit) return hit
  const rows = eaRows?.filter(r => r.level !== 'denied')
  const result = listCredentials(graph).map(obj => ({
    key: obj.fixture_key,
    provider: obj.canonical.provider,
    token: computeBlastRadius(obj.fixture_key, 'token', { graph, eaRows: rows }),
    account: computeBlastRadius(obj.fixture_key, 'account', { graph, eaRows: rows }),
  }))
  cache.set(graph, result)
  return result
}

/**
 * 적재 때 엔진이 계산한 결과를 캐시에 넣는다. 같은 그래프로 묻는 blastRadii 는 다시 계산하지 않고 이것을 돌려준다.
 * 엔진은 denied 를 뺀 EA 행에 더해 위협 판정 그래프의 위임 쓰기(앱이 다른 SaaS 신원으로 하는 쓰기)를 잇는다.
 */
export function seedBlastRadii(graph: GraphStoreV2, list: CredentialBlast[]): void {
  cache.set(graph, list)
  published.add(graph)
}

/**
 * 엔진이 게시한 피해 범위만 돌려준다. 없으면(옛 스냅숏, 데모) undefined 이고, 부르는 쪽이 브라우저에서 세어 「브라우저 추정」으로 표시한다.
 * 위협 경로 그림과 AI 답이 Credentials 화면과 같은 값을 쓰게 한다. 브라우저 계산은 위임 쓰기를 잇지 않아 최고 권한이 다를 수 있다
 */
export function publishedBlastFor(graph: GraphStoreV2, key: string): CredentialBlast | undefined {
  return published.has(graph) ? cache.get(graph)?.find(c => c.key === key) : undefined
}

export function blastFor(graph: GraphStoreV2, key: string, eaRows?: readonly EffectiveAccessRow[]): CredentialBlast | undefined {
  return blastRadii(graph, eaRows).find(c => c.key === key)
}
