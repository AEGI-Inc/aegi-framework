import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { FixtureObject } from '../model/object'
import type { IdentityLink } from '../model/link'
import { objectDisplayName } from './objectChip'

export interface PersonGroup {
  link: IdentityLink
  name: string
  /** 그 사람의 계정 전부 (검색에 걸리지 않은 계정도) */
  accounts: Array<{ key: string; object: FixtureObject }>
}

/**
 * 검색 결과를 동일인 연결로 묶는다.
 *
 * 사용자 A를 찾으면 Slack, GitHub, Okta 계정이 따로 세 줄로 나와, 같은 사람인지 다시 맞춰야 했다.
 * 결과 객체가 계정 둘 이상인 동일인 연결에 들어 있으면 그 사람 한 줄로 묶고, 연결된 계정을 모두 보인다.
 * 묶이지 않은 객체는 rest 로 그대로 둔다.
 */
export function groupByPerson(
  graph: GraphStore | GraphStoreV2,
  results: Array<{ key: string; object: FixtureObject }>,
): { people: PersonGroup[]; rest: Array<{ key: string; object: FixtureObject }> } {
  const people = new Map<string, PersonGroup>()
  const grouped = new Set<string>()
  for (const { key } of results) {
    for (const linkId of graph.linkIdsByObject?.get(key) ?? []) {
      const link = graph.linksById?.get(linkId)
      if (!link || link.level === 'different' || link.set.length < 2) continue
      grouped.add(key)
      if (people.has(link.link_id)) continue
      const accounts = link.set.flatMap(member => {
        const object = graph.objectsByKey.get(member.object_key)
        return object ? [{ key: member.object_key, object }] : []
      })
      const name = String(link.meta?.display_name ?? link.meta?.person_name ?? (accounts[0] ? objectDisplayName(accounts[0].object) : link.link_id))
      people.set(link.link_id, { link, name, accounts })
    }
  }
  return { people: [...people.values()], rest: results.filter(result => !grouped.has(result.key)) }
}
