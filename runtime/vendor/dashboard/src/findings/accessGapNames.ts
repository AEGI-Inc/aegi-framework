import type { GraphStoreV2 } from '../model/graph'
import type { Provider } from '../model/object'

/** 로고가 없는 SaaS 를 적을 때 쓰는 색 점. Access Gaps 목록과 벤 머리가 쓴다 */
export const PROVIDER_COLOR: Partial<Record<Provider, string>> = {
  slack: '#611f69',
  github: '#24292e',
  okta: '#007dc1',
  gws: '#0f9d58',
  atlassian: '#0052cc',
}

export function objectName(key: string, graph: GraphStoreV2): string {
  const o = graph.objectsByKey.get(key)
  return String(o?.fixture_meta?.display_name ?? o?.canonical.properties.name ?? key)
}

/** 위협 판정의 가상 키를 화면 객체로. 메일 내용(mail:계정)은 그 계정, 조직 밖 주소(outside...)와 사용자 속성(attr:)은 객체가 없다 */
export function realKey(key: string): string | undefined {
  if (key.startsWith('mail:')) return key.slice('mail:'.length)
  if (key.startsWith('outside') || key.startsWith('attr:')) return undefined
  return key
}

/** 위협 판정의 키 이름. 위협 상세 제목(threatV2.ts)과 같은 이름을 쓴다 */
export function keyName(key: string, graph: GraphStoreV2): string {
  if (key === '@everyone') return '누구나'
  if (key.startsWith('mail:')) return `${objectName(key.slice('mail:'.length), graph)} 메일함`
  if (key.startsWith('outside')) return '조직 밖 주소'
  if (key.startsWith('attr:')) {
    const rest = key.slice('attr:'.length)
    const owner = rest.replace(/:[^:]*$/, '')
    return `${objectName(owner, graph)} ${rest.slice(owner.length + 1)} 속성`
  }
  return objectName(key, graph)
}
