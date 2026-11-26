import { useMemo, useState } from 'react'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId, providerName } from '../findings/providers'
import type { Leg, PathStep, ScenarioGraph } from './scenarioGraph'
import EffectPanel from './EffectPanel'
import OrbGraph, { type OrbItem } from './OrbGraph'
import { finalGrade, finalScore, impactPreview, lookAhead, scopeOf, type Grade } from './pathRisk'

/*
 * 경로 만들기 (PoC). SaaS 연결과 같은 원 그래프다. 처음에는 SaaS 를 둥글게 띄우고, 하나를 누르면 가운데로 오면서
 * 진입점 묶음(사람, 그룹·조직·누구나, 자동화 신원)을 펼친다. 묶음 → 진입점 → 홉 → (다음 홉 또는 영향) 순으로 고르며,
 * 고른 노드가 가운데로 오고 지나온 노드는 왼쪽에 작게 남는다. 왼쪽 노드를 누르면 그 단계로 돌아간다.
 * 후보에는 앞으로 닿을 수 있는 최고 위험(미리보기)을, 고른 홉에는 실행 신원과 신원 전환을, 영향에 닿으면 도착 등급을 적는다.
 * 가운데 노드를 누르면 그 노드의 분석이 아래에 열린다. 후보가 많으면 앞의 KID_LIMIT 개와 「더 보기」를 둔다.
 */
type GroupKey = 'people' | 'groups' | 'bots'
const GROUPS: GroupKey[] = ['people', 'groups', 'bots']
const GROUP_LABEL: Record<GroupKey, string> = { people: '사람', groups: '그룹, 조직, 누구나', bots: '자동화 신원' }
const GROUP_GLYPH: Record<GroupKey, string> = { people: '사람', groups: '그룹', bots: '봇' }
/** 처음에 보이는 후보 수. 넘으면 「더 보기」 원을 둔다 */
const KID_LIMIT = 10
const MORE_ID = '__more'

/** 노드 원 안: SaaS 로고, SaaS 가 없으면(누구나 등) 이름 앞 두 글자 */
function NodeIcon({ sg, k }: { sg: ScenarioGraph; k: string }) {
  const p = sg.provider(k)
  return p ? <ProviderLogo provider={providerLogoId(p)} /> : <span className="scb-orb-glyph">{sg.name(k).slice(0, 2)}</span>
}

export default function ScenarioCanvas({ sg, provider, setProvider, path, setPath, analyzed, onAnalyze }: {
  sg: ScenarioGraph
  provider: string
  setProvider: (p: string) => void
  path: PathStep[]
  setPath: (p: PathStep[]) => void
  /** 분석 칸에 열린 경로 노드 (path 의 몇 번째) */
  analyzed: number | null
  onAnalyze: (i: number) => void
}) {
  const entries = useMemo(() => sg.entries(), [sg])
  const [pickedGroup, setPickedGroup] = useState<GroupKey | ''>('')
  const [showAll, setShowAll] = useState(false)
  const e = entries.get(provider) ?? { people: [], bots: [], groups: [] }
  const entryCount = (p: string) => { const x = entries.get(p); return x ? x.people.length + x.bots.length + x.groups.length : 0 }
  const providers = useMemo(() => [...sg.graph.objectsByProvider.keys()].filter(p => p && p !== 'external')
    .sort((a, b) => providerName(a).localeCompare(providerName(b))), [sg])
  // 진입점이 고른 경로의 첫 칸이면 그 진입점이 든 묶음을 쓴다 (SaaS 연결에서 경로를 들고 넘어온 경우 포함)
  const group: GroupKey | '' = path.length ? (GROUPS.find(g => e[g].includes(path[0].key)) ?? '') : pickedGroup

  const isHop = (s: PathStep) => !!s.via && s.via.hops[s.via.hops.length - 1].kinds.includes('T')
  const names = (keys: string[]) => [...new Set(keys.map(k => sg.name(k)))].join(', ') || '-'

  const nodeOrb = (k: string, id: string, extra: Partial<OrbItem> = {}): OrbItem => ({
    id, icon: <NodeIcon sg={sg} k={k} />, name: sg.name(k),
    title: `${sg.typeLabel(k)} (${sg.objectType(k)})\n${sg.name(k)}`, ...extra,
  })
  const providerOrb = (p: string): OrbItem => {
    const n = entryCount(p)
    return { id: `s:${p}`, icon: <ProviderLogo provider={providerLogoId(p)} />, name: providerName(p), title: providerName(p), empty: n === 0 }
  }
  const groupOrb = (g: GroupKey): OrbItem => ({
    id: `g:${g}`, icon: <span className="scb-orb-glyph">{GROUP_GLYPH[g]}</span>, name: GROUP_LABEL[g], title: `${providerName(provider)} 진입점, ${GROUP_LABEL[g]}`, empty: e[g].length === 0,
  })
  // 경로 칸: 고른 홉은 트리거와 동작을 title 에, 경로 끝 영향은 도착 등급
  const stepOrb = (i: number): OrbItem => {
    const s = path[i]
    const id = `n:${i}:${s.key}`
    if (i === 0) return nodeOrb(s.key, id)
    const leg = s.via ? sg.legText(s.via) : ''
    if (isHop(s)) {
      const card = sg.hopCard(s.key)
      return nodeOrb(s.key, id, {
        title: `${sg.typeLabel(s.key)} (${sg.objectType(s.key)})\n${sg.name(s.key)}\n${leg}\n트리거 ${names(card.triggers.map(h => h.from))}\n동작 ${names(card.actions.map(l => l.to))}`,
      })
    }
    const fin = i === path.length - 1 ? finalScore(sg, path) : null
    return nodeOrb(s.key, id, {
      title: `${sg.typeLabel(s.key)} (${sg.objectType(s.key)})\n${sg.name(s.key)}\n${leg}`,
      badge: fin?.grade, tone: fin ? `scb-risk-${fin.grade}` : undefined,
    })
  }

  // 다음 후보: 진입점 다음은 첫 홉, 홉 다음은 다음 홉과 영향, 영향 다음은 없다
  const candidates = useMemo((): Array<{ leg: Leg; kind: '홉' | '영향'; risk?: Grade }> => {
    if (!path.length) return []
    const onPath = new Set(path.map(s => s.key))
    const last = path[path.length - 1]
    const memo = new Map<string, number>()
    if (path.length === 1) {
      return sg.firstHops(last.key, onPath).map(l => {
        const v = lookAhead(sg, l.to, onPath, 3, memo)
        return { leg: l, kind: '홉' as const, risk: v ? finalGrade(scopeOf(sg, l.to).score * v) : undefined }
      })
    }
    if (!isHop(last)) return []
    const next = sg.nextFromHop(last.key, onPath)
    const scope = scopeOf(sg, path[1].key).score
    const grade = (v: number) => (v ? finalGrade(scope * v) : undefined)
    return [
      ...next.hops.map(l => ({ leg: l, kind: '홉' as const, risk: grade(lookAhead(sg, l.to, onPath, 3, memo)) })),
      ...next.impacts.map(l => ({ leg: l, kind: '영향' as const, risk: grade(impactPreview(sg, l)) })),
    ]
  }, [sg, path])

  let past: OrbItem[] = []
  let focus: OrbItem | null = null
  let kids: OrbItem[] = []
  if (provider) {
    const chain = [providerOrb(provider), ...(group ? [groupOrb(group)] : []), ...path.map((_, i) => stepOrb(i))]
    focus = chain[chain.length - 1]
    past = chain.slice(0, -1)
    if (!group) kids = GROUPS.map(groupOrb)
    else if (!path.length) kids = e[group].map(k => nodeOrb(k, `n:0:${k}`))
    else kids = candidates.map(c => nodeOrb(c.leg.to, `n:${path.length}:${c.leg.to}`, {
      title: `${sg.typeLabel(c.leg.to)} (${sg.objectType(c.leg.to)})\n${sg.name(c.leg.to)}\n${sg.legText(c.leg)}${c.risk ? `\n앞으로 닿을 수 있는 최고 위험 ${c.risk}, 진입점 격차 미반영` : ''}`,
      badge: c.risk, tone: c.risk ? `scb-risk-${c.risk}` : undefined,
    }))
    if (!showAll && kids.length > KID_LIMIT) {
      const rest = kids.length - KID_LIMIT
      kids = [...kids.slice(0, KID_LIMIT), { id: MORE_ID, icon: <span className="scb-orb-glyph">+{rest}</span>, name: `${rest}개 더 보기`, title: `후보 ${rest}개 더 보기` }]
    }
  }

  const onRing = (id: string) => { setProvider(id.slice(2)); setPickedGroup(''); setShowAll(false) }
  const onPast = (i: number) => {
    setShowAll(false)
    if (i === 0) { setPickedGroup(''); setPath([]); return }
    if (group && i === 1) { setPickedGroup(group); setPath([]); return }
    setPath(path.slice(0, i - (group ? 1 : 0)))
  }
  const onKid = (id: string) => {
    if (id === MORE_ID) { setShowAll(true); return }
    setShowAll(false)
    if (!group) { setPickedGroup(id.slice(2) as GroupKey); return }
    const key = id.split(':').slice(2).join(':')
    if (!path.length) { setPath([{ key }]); return }
    const c = candidates.find(x => x.leg.to === key)
    if (c) setPath([...path, { key, via: c.leg }])
  }

  const last = path[path.length - 1]
  const atImpact = path.length > 1 && !!last && !isHop(last)
  return (
    <>
      <OrbGraph
        label="경로 만들기 그래프"
        ring={providers.map(providerOrb)}
        past={past}
        focus={focus}
        kids={kids}
        onRing={onRing}
        onPast={onPast}
        onKid={onKid}
        onFocus={path.length ? () => onAnalyze(path.length - 1) : undefined}
        focusHint={path.length ? '누르면 아래에 이 노드의 분석이 열린다' : ''}
        focusOn={path.length > 0 && analyzed === path.length - 1}
      />
      {group && !path.length && e[group].length === 0 && <p className="scb-empty">이 묶음에는 진입점이 없음</p>}
      {path.length > 0 && !atImpact && candidates.length === 0 && <p className="scb-empty">{path.length === 1 ? '이 진입점에서 호출할 수 있는 홉이 없음' : '이 홉 다음 후보가 없음'}</p>}
      {atImpact && <EffectPanel sg={sg} path={path} />}
    </>
  )
}
