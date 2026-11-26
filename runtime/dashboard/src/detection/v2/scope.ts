import type { GraphStoreV2 } from '../../model/graph'

/** 요약 문장에 쓰는 객체 이름 (화면 표시 이름 → 이름 속성 → 키) */
export function objectLabel(key: string | undefined, graph: GraphStoreV2): string {
  if (!key) return ''
  const obj = graph.objectsByKey.get(key)
  return String(obj?.fixture_meta?.display_name ?? obj?.canonical.properties.name ?? key)
}
