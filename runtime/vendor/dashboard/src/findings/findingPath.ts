import type { FindingV2 } from '../model/findingV2'
import type { GraphStoreV2 } from '../model/graph'
import type { EvidenceStore, FindingEvidenceLink } from '../model/evidence'
import type { Provider } from '../model/object'
import { buildThreatPath, buildThreatV2Path, type PathMode, type ThreatPathLayout } from './threatPathModel'

/** 위협의 증거 링크. 위협은 증거 링크 id 를 직접 들고 온다 */
export function findingEvidenceLinks(finding: FindingV2, evidenceStore: EvidenceStore): FindingEvidenceLink[] {
  return finding.evidenceLinkIds.map(id => evidenceStore.evidenceLinksById.get(id)).filter((l): l is FindingEvidenceLink => !!l)
}

/** 탐지 경로 배치. 두 보기 모두 SaaS 상자 × 시작, 경유, 대상 칸의 같은 판이다(threatPathModel) */
export function findingPathLayout(
  view: PathMode,
  finding: FindingV2,
  graph: GraphStoreV2,
  evidenceStore: EvidenceStore,
  evidenceLinks: FindingEvidenceLink[] = findingEvidenceLinks(finding, evidenceStore)
): ThreatPathLayout {
  // 위협 판정 V2 위협의 잠재 경로는 엔진이 준 경로(path.hops)와 사람(subjects)으로 그린다. 경로가 빈 추적성 상실은 아래 그대로
  if (view === 'possible' && finding.threatPath?.hops.length) {
    const v2 = buildThreatV2Path(finding, graph)
    if (v2.nodes.length) return v2
  }
  return buildThreatPath(view, finding, graph, evidenceLinks, evidenceStore.observationsById)
}

/**
 * 위협이 지나는 SaaS. 잠재 경로 그림의 SaaS 상자를 위에서부터 읽은 순서다.
 * 판정의 providerSet 은 관련 사람의 다른 SaaS 계정까지 넣어 그림보다 넓다. 목록, 요약 화면은 그림과 같은 SaaS 를 보인다.
 * 그림에 SaaS 상자가 없으면 판정 값을 그대로 쓴다
 */
export function findingPathProviders(finding: FindingV2, graph: GraphStoreV2, evidenceStore: EvidenceStore): Provider[] {
  const lanes = findingPathLayout('possible', finding, graph, evidenceStore).lanes.flatMap(lane => (lane.provider ? [lane.provider] : []))
  return lanes.length ? lanes : finding.providerSet
}

/** 위협 목록의 SaaS 를 탐지 경로 그림과 같게 바꾼다. 화면(App.tsx), AI 평가 실행기, engine 게시 계산이 같이 쓴다 */
export function withPathProviders(findings: readonly FindingV2[], graph: GraphStoreV2, evidenceStore: EvidenceStore): FindingV2[] {
  return findings.map(finding => ({ ...finding, providerSet: findingPathProviders(finding, graph, evidenceStore) }))
}
