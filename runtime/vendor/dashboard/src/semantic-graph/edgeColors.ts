/**
 * 그래프 선 색. Cross-SaaS Graph(UnifiedFullGraph), Overview 의 SaaS 요약 그림(HomeEcosystemGraph)이 같이 쓴다.
 * 범례 견본(graphWorkspace.css .gx-visual-legend i.*)과 Manual 범례(manual.css .mn-legend i.*)도 이 값과 같아야 한다.
 *
 * - 파랑은 Effective Access 하나만 쓴다(빛 + 깜빡임, graphWorkspace.css .gx-ea-core). 전에는 선택 경로도 같은
 *   #2563eb 라 두 선이 번짐으로만 갈렸다. Effective Access 는 Finding 상세 등 다섯 곳이 파랑으로 맞춰져 있어
 *   선택 경로를 글자색과 같은 검정(#0f172a)으로 옮겼다.
 * - 역할 부여(policy_assignment)는 동일인 연결 남색 점선과 헷갈리지 않게 짙은 회색 점선이다.
 */
export const EDGE_COLORS = {
  /** 수집한 관계 (종류와 상관없이 같은 색) */
  relation: '#94a3b8',
  /** 탐지 증거 */
  finding: '#dc2626',
  /** 선택 경로 (검색, 경로에서 찾은 경로) */
  path: '#0f172a',
  /** 검색 결과 */
  query: '#b45309',
  /** 동일인 연결 (점선) */
  identity: '#1e1b4b',
  /** 역할 부여 (점선) */
  policy: '#64748b',
} as const
