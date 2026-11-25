import { useId, type ReactNode } from 'react'
import { fitLabel, measureLabel } from '../semantic-graph/labelFit'
import type { ThreatGapPersonV2 } from '../model/findingV2'
import { PROVIDERS_WITH_LOGO } from './providers'

/**
 * Access Gap 벤(엔진 계약 accessGap, 2026-11-17 시안 1). 왼쪽 원은 대상에 직접 권한이 있는 사람, 오른쪽 원은 이 연동 지점으로 닿는 사람.
 * 사람 칸은 직접 권한만, 둘 다, 파생 접근만 세 열. 새로 생긴 권한이 있는 사람은 빨간 칸과 빨간 수준 글자,
 * 미확정은 점선, 관리자와 승인됨은 검정 테두리와 제외 이유. 두 원은 accessGap.css 의 직접 권한, 파생 접근 색을 쓴다.
 * 이름 앞 로고는 그 사람이 실제로 대상에 닿는 계정의 SaaS(accessProviders, 2026-11-20).
 */
export interface VennPerson extends ThreatGapPersonV2 {
  name: string
  /** 이름 앞에 로고를 다는 SaaS(accessProviders) */
  providers: string[]
}

type Col = 'direct' | 'both' | 'derived'
const ROW = 34
const PILL_H = 26
/** 한 열에 그리는 사람 수. 넘치면 「외 N명」. 사람 전부는 아래 표에 있다 */
const COL_MAX = 12
const FULL = { W: 1000, PILL_W: 190, D: { cx: 370, rx: 270 }, V: { cx: 630, rx: 270 }, COL_X: { direct: 220, both: 500, derived: 770 } as Record<Col, number> }

const MAIL = /^([^@\s]+)@[^@\s]+$/

/** 칸에 쓰는 이름. 이름 전체가 메일 주소면 @ 앞만 쓰고, 줄인 이름이 이 벤에서 겹치면 메일 전체를 쓴다(2026-11-20 시안 A). 「… 메일함」처럼 글이 붙은 이름은 그대로 */
export function shortNames(people: { person: string; name: string }[]): Map<string, string> {
  const short = (name: string) => MAIL.exec(name)?.[1] ?? name
  const count = new Map<string, number>()
  for (const p of people) count.set(short(p.name), (count.get(short(p.name)) ?? 0) + 1)
  return new Map(people.map(p => [p.person, count.get(short(p.name))! > 1 ? p.name : short(p.name)]))
}

/** 오른쪽 수준 글자 폭. 글자 종류가 몇 개뿐이라 한 번 잰 값을 쓴다 */
const tagWidths = new Map<string, number>()
const tagWidth = (tag: string) => tagWidths.get(tag) ?? tagWidths.set(tag, measureLabel(tag, 11)).get(tag)!

export function columnOf(p: ThreatGapPersonV2): Col {
  // 누구나 공유로만 직접 읽는 사람은 직접 권한 원 밖(엔진 publicOnly)
  return p.direct && p.derived && !p.publicOnly ? 'both' : p.derived ? 'derived' : 'direct'
}

export const isGapPerson = (p: ThreatGapPersonV2) => p.gained.length > 0 && !p.excluded

/** 파생 접근이 미확정인 사람(점선 칸) */
export const isUnsure = (p: ThreatGapPersonV2) => !!p.derived && p.certainty !== '확정'

/**
 * 벤 칸과 아래 표의 사람 순서. 새로 생긴 권한이 있는 사람, 제외된 사람, 나머지 순이고 같은 묶음 안에서는 확정이 미확정보다 앞(2026-11-24).
 * 그다음 파생 접근이 있는 사람, 이름 순. 벤 한 열 안에서는 파생 접근 유무가 같아 이름 순이 된다
 */
export const byPersonOrder = (a: VennPerson, b: VennPerson) =>
  Number(isGapPerson(b)) - Number(isGapPerson(a)) || Number(!!b.excluded) - Number(!!a.excluded) || Number(isUnsure(a)) - Number(isUnsure(b)) || Number(!!b.derived) - Number(!!a.derived) || a.name.localeCompare(b.name)

/**
 * 사람이 대상에 실제로 닿는 계정의 SaaS(로고가 있는 것만, 중복 없이). 대표 계정이 아니라 엔진이 준 계정을 쓴다.
 * 직접 권한 칸은 직접 권한 계정, 파생 접근 칸은 파생 접근 계정, 둘 다 칸은 둘 다(직접 권한 계정 먼저)
 */
export function accessProviders(p: ThreatGapPersonV2, providerOf: (account: string) => string | undefined): string[] {
  const col = columnOf(p)
  const accounts = [...(col !== 'derived' ? p.directAccounts ?? [] : []), ...(col !== 'direct' ? p.derivedAccounts ?? [] : [])]
  return [...new Set(accounts.map(providerOf))].filter((x): x is string => !!x && PROVIDERS_WITH_LOGO.has(x))
}

const LOGO = 14
const LOGO_STEP = 17

/** 직접 권한 칸 글. 누구나 공유로만 직접 읽으면 그렇게 적는다. 조직 밖 직접 공유는 「조직 밖」, 승인된 사람의 직접 공유는 「승인 범위 안」(2026-11-18 시안 A) */
export const directText = (p: ThreatGapPersonV2) =>
  p.share && !p.excluded ? `직접 공유 ${p.share}, 조직 밖`
    : !p.direct ? '없음'
    : p.share && p.excluded === '승인됨' ? `직접 공유 ${p.direct}, 승인 범위 안`
    : p.publicOnly ? `누구나 공유 ${p.direct}` : p.direct

/** logo: SaaS 로고 그리기. 로고 그림(png 포함)을 이 파일이 불러오지 않게 부르는 쪽이 준다 */
export default function AccessGapVenn({ people, directCount, derivedCount, logo }: { people: VennPerson[]; directCount: number; derivedCount: number; logo: (provider: string) => ReactNode }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const { W, PILL_W, D, V, COL_X } = FULL
  const names = shortNames(people)
  const all: Record<Col, VennPerson[]> = { direct: [], both: [], derived: [] }
  for (const p of people) all[columnOf(p)].push(p)
  for (const c of Object.keys(all) as Col[]) all[c].sort(byPersonOrder)
  const more: Record<Col, number> = { direct: 0, both: 0, derived: 0 }
  const cols: Record<Col, VennPerson[]> = { direct: [], both: [], derived: [] }
  for (const c of Object.keys(all) as Col[]) {
    // 직접 권한만 있는 사람은 엔진이 앞쪽 일부만 준다. 나머지 수는 directCount 로 센다
    const total = c === 'direct' ? Math.max(all.direct.length, directCount - all.both.length) : all[c].length
    cols[c] = all[c].slice(0, COL_MAX)
    more[c] = total - cols[c].length
  }
  const rows = (c: Col) => cols[c].length + (more[c] > 0 ? 1 : 0)
  const n = Math.max(1, rows('direct'), rows('both'), rows('derived'))
  const maxDy = ((n - 1) * ROW) / 2 + PILL_H / 2
  const ry = Math.max(170, maxDy / 0.6)
  const top = 58
  const cy = top + ry
  const H = cy + ry + 16
  const y = (c: Col, i: number) => cy - ((rows(c) - 1) * ROW) / 2 + i * ROW

  const pill = (p: VennPerson, c: Col, i: number) => {
    const gap = isGapPerson(p)
    const cls = `gv-person gv-${c} ${gap ? 'is-gap' : ''} ${p.excluded ? 'is-excluded' : ''} ${isUnsure(p) ? 'is-unsure' : ''}`
    const tag = p.excluded ?? (gap ? p.gained.join(', ') : '')
    const nameX = p.providers.length ? 9 + p.providers.length * LOGO_STEP + 2 : 10
    return (
      <g key={p.person} className={cls} transform={`translate(${COL_X[c] - PILL_W / 2}, ${y(c, i) - PILL_H / 2})`}>
        <rect width={PILL_W} height={PILL_H} />
        {p.providers.map((pr, k) => (
          <foreignObject key={pr} x={9 + k * LOGO_STEP} y={(PILL_H - LOGO) / 2} width={LOGO} height={LOGO}>
            {logo(pr)}
          </foreignObject>
        ))}
        <text x={nameX} y={17.5}>{fitLabel(names.get(p.person)!, PILL_W - nameX - (tag ? tagWidth(tag) + 12 : 10), 13)}</text>
        {tag && <text x={PILL_W - 8} y={17.5} textAnchor="end" className="gv-tag">{tag}</text>}
        <title>{`${p.name}\n직접 권한: ${directText(p)}\n파생 접근: ${p.derived ?? '없음'}${p.certainty ? `\n확실성: ${p.certainty}` : ''}`}</title>
      </g>
    )
  }

  return (
    <svg className="gap-venn" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`직접 권한 ${directCount}명, 파생 접근 ${derivedCount}명`}>
      <defs>
        <mask id={`gv-only-${uid}`}>
          <rect width={W} height={H} fill="black" />
          <ellipse cx={V.cx} cy={cy} rx={V.rx} ry={ry} fill="white" />
          <ellipse cx={D.cx} cy={cy} rx={D.rx} ry={ry} fill="black" />
        </mask>
      </defs>
      <ellipse className="gv-set gv-set-direct" cx={D.cx} cy={cy} rx={D.rx} ry={ry} />
      <ellipse className="gv-set gv-set-derived" cx={V.cx} cy={cy} rx={V.rx} ry={ry} />
      <rect className="gv-only" width={W} height={H} mask={`url(#gv-only-${uid})`} />
      <text x={D.cx - 60} y={top - 18} textAnchor="middle" className="gv-label gv-label-direct">직접 권한 {directCount}명</text>
      <text x={V.cx + 60} y={top - 18} textAnchor="middle" className="gv-label gv-label-derived">파생 접근 {derivedCount}명</text>
      {(['direct', 'both', 'derived'] as Col[]).map(c => (
        <g key={c}>
          {cols[c].length ? cols[c].map((p, i) => pill(p, c, i)) : <text x={COL_X[c]} y={cy + 4} textAnchor="middle" className="gv-empty">없음</text>}
          {more[c] > 0 && <text x={COL_X[c]} y={y(c, cols[c].length) + 4} textAnchor="middle" className="gv-empty">외 {more[c]}명</text>}
        </g>
      ))}
    </svg>
  )
}
