import snapshot from '../config-findings/ismsMapping.snapshot.json'
import catalog from './catalog.snapshot.json'
import iso from './iso27001.snapshot.json'
import type { ItemTier, TypeScopeItem } from './typeScope'
import rawTypeScope from './typeScope.snapshot.json'

export type FrameworkId = 'isms-p' | 'iso27001' | 'pipa'
export interface Requirement { key: string; id: string; text: string; companyInput: string[]; tier?: ItemTier; tierReason?: string }
export interface Control { id: string; title: string; subtitle: string; group: string; requirements: Requirement[]; inScope: boolean; related: { framework: FrameworkId; id: string; title: string }[] }
export interface FrameworkGroup { no: string; name: string }
export interface Framework { id: FrameworkId; label: string; unit: string /* '지원 인증기준' | '통제' | '조항' */; groups: FrameworkGroup[]; controls: Control[] }

const typeScopeItems = (rawTypeScope as unknown as { items: TypeScopeItem[] }).items
const typeScopeByKey = new Map<string, TypeScopeItem>(typeScopeItems.map(item => [item.key, item]))
const ismsLinkedReqs = new Set(snapshot.links.map(l => l.requirement))
// 제외 등급이 아닌 매핑 항목만 범위 안
const inScopeItem = (key: string) => {
  const item = typeScopeByKey.get(key)
  return Boolean(item) && item?.tier !== 'exclude'
}
const tierOf = (item: TypeScopeItem | undefined) => (item?.tier ? { tier: item.tier, tierReason: item.tierReason } : {})
const isVisibleTier = (tier: ItemTier | undefined) => tier === 'auto' || tier === 'evidence'

const groupNames = new Map(
  (catalog as { items: { standard: string; number: string; group: string }[] }).items
    .filter(i => i.standard === 'ISMS-P')
    .map(i => [i.number, i.group]),
)
const ismsGroupByNo = new Map<string, string>()
for (const g of groupNames.values()) {
  const [no, ...rest] = g.split('. ')
  if (no && rest.length && !ismsGroupByNo.has(no)) ismsGroupByNo.set(no, rest.join('. '))
}

export const sortKey = (c: string) => c.split('.').map(n => n.padStart(3, '0')).join('.')

const PIPA_DOC_BY_ID: Record<string, string> = {
  'law-011357': '개인정보 보호법',
  'law-011468': '개인정보 보호법 시행령',
  'admin-73493': '개인정보의 안전성 확보조치 기준',
  'admin-73464': '표준 개인정보 보호지침',
}
export const PIPA_DOC_ORDER = [
  '개인정보 보호법',
  '개인정보 보호법 시행령',
  '개인정보의 안전성 확보조치 기준',
  '표준 개인정보 보호지침',
]

export function fallbackPipaLocation(id: string): string {
  const [docId, articleRaw = '', paraRaw = ''] = id.split(':')
  const doc = PIPA_DOC_BY_ID[docId] ?? docId
  const pNum = paraRaw.replace(/^p/, '')
  if (articleRaw.startsWith('annex-')) return `${doc} 별표 0`
  const m = articleRaw.match(/^article-(\d+)(?:-(\d+))?$/)
  if (!m) return `${doc} ${id}`
  const art = m[2] ? `제${m[1]}조의${m[2]}` : `제${m[1]}조`
  const para = pNum && pNum !== '0' ? ` 제${pNum}항` : ''
  return `${doc} ${art}${para}`
}

export function pipaSortKey(clause: string): string {
  const m = clause.match(/^제(\d+)조(?:의(\d+))?(?:\s*제(\d+)항)?/)
  if (!m) return `999.${clause}`
  return `${m[1].padStart(3, '0')}.${(m[2] ?? '0').padStart(3, '0')}.${(m[3] ?? '0').padStart(3, '0')}`
}

function buildIsmsRows() {
  const existingIds = new Set(snapshot.requirements.map(r => r.id))
  const criterionTitles = new Map(snapshot.requirements.map(r => [r.criterion, r.title]))
  const rawReqs = [
    ...snapshot.requirements,
    ...typeScopeItems
      .filter(item => item.framework === 'ISMS-P' && !existingIds.has(item.id))
      .map(item => {
        const criterion = item.id.split('-')[0]
        return {
          id: item.id,
          criterion,
          title: criterionTitles.get(criterion) ?? item.title,
          question: item.summary,
          limitation: '',
        }
      }),
  ]
  const byCriterion = new Map<string, typeof rawReqs>()
  for (const r of rawReqs) {
    byCriterion.set(r.criterion, [...(byCriterion.get(r.criterion) ?? []), r])
  }
  return byCriterion
}

const cache = new Map<FrameworkId, Framework>()

export function buildFramework(id: FrameworkId): Framework {
  const cached = cache.get(id)
  if (cached) return cached

  let built: Framework
  if (id === 'isms-p') {
    const byCriterion = buildIsmsRows()
    const groups: FrameworkGroup[] = [...ismsGroupByNo.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([no, name]) => ({ no, name }))
    const controls: Control[] = [...byCriterion.entries()]
      .sort((a, b) => sortKey(a[0]).localeCompare(sortKey(b[0])))
      .map(([criterion, reqs]) => {
        const [no] = (groupNames.get(criterion) ?? `${criterion.split('.')[0]}. `).split('. ')
        const requirements: Requirement[] = reqs.map(r => {
          const key = `ISMS-P:${r.id}`
          const tsItem = typeScopeByKey.get(key)
          return {
            key,
            id: r.id,
            text: r.question,
            companyInput: tsItem?.companyInput ?? [],
            ...tierOf(tsItem),
          }
        })
        const inScope = requirements.some(r => r.tier !== 'exclude' && (inScopeItem(r.key) || ismsLinkedReqs.has(r.id)))
        const reqIdSet = new Set(reqs.map(r => r.id))
        const related = iso.controls
          .filter(c => isVisibleTier(typeScopeByKey.get(`ISO27001:${c.id}`)?.tier))
          .filter(c => c.ismsp.some(ismspId => reqIdSet.has(ismspId) || ismspId.split('-')[0] === criterion))
          .map(c => ({ framework: 'iso27001' as const, id: c.id, title: c.titleKo }))
        return {
          id: criterion,
          title: reqs[0].title,
          subtitle: '',
          group: no,
          requirements,
          inScope,
          related,
        }
      })
    built = { id: 'isms-p', label: 'ISMS-P', unit: '지원 인증기준', groups, controls }
  } else if (id === 'iso27001') {
    const isms = buildFramework('isms-p')
    const ismsTitleByCriterion = new Map(isms.controls.map(c => [c.id, c.title]))
    const groups: FrameworkGroup[] = iso.themes.map(t => ({ no: t.no, name: t.name }))
    const controls: Control[] = iso.controls.map(c => {
      const key = `ISO27001:${c.id}`
      const tsItem = typeScopeByKey.get(key)
      const criteria = [...new Set(c.ismsp.map(reqId => reqId.split('-')[0]))]
      const related = criteria.filter(crit => ismsTitleByCriterion.has(crit)).map(crit => ({
        framework: 'isms-p' as const,
        id: crit,
        title: ismsTitleByCriterion.get(crit) ?? '',
      }))
      return {
        id: c.id,
        title: c.titleKo,
        subtitle: c.title,
        group: c.theme,
        requirements: [
          {
            key,
            id: c.id,
            text: tsItem?.summary ?? '',
            companyInput: tsItem?.companyInput ?? [],
            ...tierOf(tsItem),
          },
        ],
        inScope: inScopeItem(key),
        related,
      }
    })
    built = { id: 'iso27001', label: 'ISO 27001', unit: '통제', groups, controls }
  } else {
    const pipaItems = typeScopeItems.filter(item => item.framework === 'PIPA')
    const parsed = pipaItems.map(item => {
      const loc = item.location || fallbackPipaLocation(item.id)
      const docName = loc.replace(/\s*(제\d+조|별표).*$/, '').trim()
      const clauseId = loc.slice(docName.length).trim() || item.id
      return { item, docName, clauseId }
    })
    const docNames = [...new Set(parsed.map(p => p.docName))].sort((a, b) => {
      const ra = PIPA_DOC_ORDER.indexOf(a)
      const rb = PIPA_DOC_ORDER.indexOf(b)
      const oa = ra >= 0 ? ra : PIPA_DOC_ORDER.length
      const ob = rb >= 0 ? rb : PIPA_DOC_ORDER.length
      return oa - ob || a.localeCompare(b)
    })
    const groups: FrameworkGroup[] = docNames.map((name, idx) => ({ no: String(idx + 1), name }))
    const groupNoByDoc = new Map(groups.map(g => [g.name, g.no]))
    const controls: Control[] = parsed
      .sort((a, b) => {
        const ga = Number(groupNoByDoc.get(a.docName) ?? 99)
        const gb = Number(groupNoByDoc.get(b.docName) ?? 99)
        return ga - gb || pipaSortKey(a.clauseId).localeCompare(pipaSortKey(b.clauseId))
      })
      .map(({ item, docName, clauseId }) => ({
        id: clauseId,
        title: item.title,
        subtitle: docName,
        group: groupNoByDoc.get(docName) ?? '1',
        requirements: [
          {
            key: item.key,
            id: item.id,
            text: item.summary,
            companyInput: item.companyInput ?? [],
            ...tierOf(item),
          },
        ],
        inScope: item.tier !== 'exclude',
        related: [],
      }))
    built = { id: 'pipa', label: 'PIPA', unit: '조항', groups, controls }
  }

  built = inScopeOnly(built)
  cache.set(id, built)
  return built
}

// 범위 안 확인사항만 보인다(knowledge item-tiers 의 auto, evidence). 확인사항이 남지 않은 항목과 대분류는 뺀다
function inScopeOnly(fw: Framework): Framework {
  const controls = fw.controls
    .map(c => ({ ...c, requirements: c.requirements.filter(r => isVisibleTier(r.tier)), inScope: true }))
    .filter(c => c.requirements.length > 0)
  const groups = fw.groups.filter(g => controls.some(c => c.group === g.no))
  return { ...fw, groups, controls }
}
