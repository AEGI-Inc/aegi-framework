import snapshot from './ismsMapping.snapshot.json'
import type { Item } from './standardResultsStore'

type Link = typeof snapshot.links[number]
type Requirement = typeof snapshot.requirements[number]
const requirements = new Map(snapshot.requirements.map(r => [r.id, r]))
const byItem = new Map<string, Link[]>()
const key = (provider: string, finding: string, standard: string, item: string) => JSON.stringify([provider, finding, standard, item])
for (const link of snapshot.links) {
  const k = key(link.provider, link.finding, link.standard, link.item)
  byItem.set(k, [...(byItem.get(k) ?? []), link])
}
/** 기존 시험에서 확인한 검사 조건이 달라진 경우 연결을 표시하지 않는다. */
export function relatedRequirements(provider: string, finding: string, item: Item): (Requirement & { mappingLimitation: string })[] {
  return (byItem.get(key(provider, finding, item.standard, item.item_id)) ?? [])
    .filter(link => link.field === item.rule?.field && link.condition === item.rule?.condition)
    .flatMap(link => { const requirement = requirements.get(link.requirement); return requirement ? [{ ...requirement, mappingLimitation: link.limitation }] : [] })
}