import type { SemanticEdge } from './types'
import { EDGE_COLORS } from './edgeColors'

/* =========================================================================
   SaaS 요약(ecosystem) 그림의 부품

   Cross-SaaS Graph 화면의 SaaS 요약과 Overview의 Cross-SaaS Graph 카드가
   같이 쓴다. 두 화면이 같은 칸, 같은 선을 그리도록 모양은
   여기 한 곳에서만 정한다. 선 색과 굵기, 투명도처럼 화면의 상태(고른
   Finding, 경로, 검색)에 따라 바뀌는 값은 쓰는 쪽이 정한다.
   ========================================================================= */

export function ecosystemEdgeKind(edge: SemanticEdge) {
  return {
    isResolution: edge.kind === 'resolution_bundle' || edge.relationTypes.includes('identity_resolution'),
    isPolicyAssignment: edge.kind === 'policy_assignment' || edge.relationTypes.includes('policy_assignment'),
  }
}

/* 위협 표시 없이 그리는 선의 색과 점선. Cross-SaaS Graph 화면의 객체 선과 같다.
   동일인 연결은 남색 둥근 점선, 정책 연결은 짙은 회색 대시, 나머지 관계는 회색 실선이다.
   Overview의 SaaS 연결 그림이 쓴다. */
export function ecosystemEdgeRestStyle(edge: SemanticEdge) {
  const { isResolution, isPolicyAssignment } = ecosystemEdgeKind(edge)
  return {
    stroke: isResolution ? EDGE_COLORS.identity : isPolicyAssignment ? EDGE_COLORS.policy : EDGE_COLORS.relation,
    strokeDasharray: isResolution ? '0.001 5' : isPolicyAssignment ? '8 5' : undefined,
    strokeLinecap: (isPolicyAssignment ? 'butt' : 'round') as 'butt' | 'round',
    strokeOpacity: 0.85,
  }
}

/* 두 칸 사이의 휜 선. 같은 두 칸 사이 선이 여럿이면 lane(가운데 0, 한 칸에 1)만큼
   휘는 쪽을 나눠 선이 겹치지 않게 한다. */
export function ecosystemEdgeGeometry(src: { x: number; y: number }, tgt: { x: number; y: number }, lane = 0) {
  const midX = (src.x + tgt.x) / 2
  const midY = (src.y + tgt.y) / 2
  const dx = tgt.x - src.x
  const dy = tgt.y - src.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1

  const isDiagonal = Math.abs(dx) > 300 && Math.abs(dy) > 300
  const isHorizontal = Math.abs(dy) < 300
  const isVertical = Math.abs(dx) < 300

  let curveDist = 45
  if (isHorizontal) curveDist = midY < 900 ? -38 : 38
  else if (isVertical) curveDist = midX < 1200 ? 38 : -38
  else if (isDiagonal) curveDist = (src.x < tgt.x && src.y < tgt.y) ? 32 : -32
  curveDist += lane * 90

  const ctrlX = midX - (dy / len) * curveDist
  const ctrlY = midY + (dx / len) * curveDist

  return {
    pathD: `M ${src.x} ${src.y} Q ${ctrlX} ${ctrlY} ${tgt.x} ${tgt.y}`,
    control: { x: ctrlX, y: ctrlY },
  }
}

/* SaaS 칸. 로고, 이름, Finding 배지, 객체와 관계 수. 고른 칸, Finding이 있는 칸 같은
   상태 이름은 쓰는 쪽이 stateClass로 붙인다. 가운데 (0, 0)에 놓이니 칸 자리는
   감싸는 <g>의 transform으로 옮긴다. */
