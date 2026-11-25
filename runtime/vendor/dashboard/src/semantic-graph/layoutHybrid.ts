import type { SemanticEdge, SemanticLevel, SemanticNode } from './types'
import { SEMANTIC_NODE_BOX } from './viewport'
import { layoutNested } from './containment'
import { layoutObjectCircles } from './objectCircles'
import type { ProviderLink } from './circleLevels'

/** 객체 단계는 원 채우기(objectCircles), 그 밖의 상세 수준은 관계와 포함 구조에 따라 배치한다. SaaS 자리는 links 가 있으면 SaaS 자리 계획, 없으면 두 줄 격자다. */
export function layoutGraphNodes(
  nodes: SemanticNode[], edges: SemanticEdge[], level: SemanticLevel,
  containment: ReadonlyMap<string, string> = new Map(),
  /** SaaS 사이 연결(circleLevels.providerLinks). 주면 객체 단계 SaaS 묶음을 SaaS, 조직, 그룹 단계와 같은 자리 계획으로 놓는다 */
  links: ProviderLink[] = [],
): SemanticNode[] {
  if (level === 'ecosystem' || nodes.length < 2) return nodes
  // 객체 단계도 원이다: 개별 객체는 작은 원, 상위 객체와 SaaS 는 원 테두리(objectCircles)
  if (level === 'object') return layoutObjectCircles(nodes, containment, edges, links)
  return layoutNested(nodes, new Map(), SEMANTIC_NODE_BOX[level], edges)
}
