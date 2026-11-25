import { Scissors, TriangleAlert } from 'lucide-react'
import { EA_AFFECTS_LABEL, type EaExplanation, type EaObj, type EaPathItem } from './eaExplain'

/**
 * Effective Access 경로 그림. 그래프의 선 상세, Finding 상세, Effective Access 상세 화면이 같이 쓴다.
 * 칸(항목)과 이음(관계 · 동일인 연결)을 세로로 늘어놓고, SaaS 가 바뀌는 자리, 저장되지 않은 구간(점선),
 * 확인하지 못한 곳(⚠), 차단 지점(✂)을 그 자리에 붙인다.
 */
export default function EaPath({ path, onFocus, detailed = false }: {
  path: EaPathItem[]
  /** 칸 이름을 누르면 그래프에서 그 항목 중심으로 본다 */
  onFocus?: (key: string) => void
  /** 확인하지 못한 곳마다 누가 풀 수 있는지도 적는다. 차단 지점은 표시만 하고 풀이는 아래 목록에 둔다 */
  detailed?: boolean
}) {
  return (
    <ol className="ea-path">
      {path.map((item, i) => {
        if (item.kind === 'cross') {
          return <li key={i} className="ea-path-cross">{item.from} → {item.to}</li>
        }
        if (item.kind === 'node') {
          return (
            <li key={i} className={`ea-path-node ${item.end ? 'is-end' : ''}`}>
              <span className="ea-path-dot" aria-hidden="true" />
              <span className="ea-path-name">
                <NodeName obj={item.obj} onFocus={onFocus} />
                {item.obj.providerLabel && <span className="ea-path-saas">{item.obj.providerLabel}</span>}
                {item.obj.integration && <span className="ea-path-kind">연동</span>}
              </span>
            </li>
          )
        }
        return (
          <li key={i} className={`ea-path-link ${item.via === null ? 'is-gap' : ''} ${item.cut ? 'is-cut' : ''}`} title={item.title}>
            <span className="ea-path-bar" aria-hidden="true" />
            <span className="ea-path-rel">
              <span className="ea-path-label">
                {item.label}
                {item.weak && <em className="ea-path-weak">{item.weak}</em>}
              </span>
              {item.warnings.map((w, j) => (
                <span key={j} className="ea-path-warn">
                  <TriangleAlert size={13} strokeWidth={2.2} aria-hidden="true" />
                  <span>{w.text}{detailed && <small>{w.hint}</small>}</span>
                </span>
              ))}
              {item.cut && (
                <span className="ea-path-cut">
                  <Scissors size={13} strokeWidth={2.2} aria-hidden="true" />
                  {detailed
                    ? <span>차단 지점</span>
                    : <span>차단 지점: {item.cut.note} <em>{EA_AFFECTS_LABEL[item.cut.affects]}</em></span>}
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** 메일 주소 이름은 @ 앞만 적는다. 전체 이름은 커서를 올리면 뜬다 */
export function eaShortName(name: string): string {
  const mail = /^([^@\s]+)@[^@\s]+\.[a-z]{2,}$/i.exec(name)
  return mail ? mail[1] : name
}

/**
 * 경로를 두 줄로: 출발 → 도착, 그 아래 거쳐 가는 곳. 목록(그래프의 보안 요약, 선 상세, Finding 상세의 요약 칸)이 쓴다.
 * 전에는 경로의 칸 이름을 모두 이어 적어, 봇 계정 메일 주소까지 한 칸이 네다섯 줄로 늘어졌다.
 * 전체 경로는 커서를 올리면 뜨고, 누르면 나오는 상세의 경로 그림에 있다.
 * sources를 주면(같은 판정, 같은 대상을 한 칸으로 묶은 목록) 출발에 그 이름들을 적고, paths는 묶인 경로 수다.
 */
export function EaBrief({ chain, sources, paths = 1 }: { chain: EaExplanation['chain']; sources?: string[]; paths?: number }) {
  if (!chain.length) return null
  const middle = [...new Set(chain.slice(1, -1).map(part => part.name))]
  const gaps = chain.filter(part => part.gap).length
  const via = [
    middle.length ? `${eaShortName(middle[0])}${middle.length > 1 ? ` 외 ${middle.length - 1}곳` : ''} 경유` : '직접',
    gaps ? `관계 누락 ${gaps}` : '',
    paths > 1 ? `경로 ${paths}개` : '',
  ].filter(Boolean).join(', ')
  return (
    <span className="ea-brief" title={chain.map(part => part.name).join(' → ')}>
      <span className="ea-brief-ends">
        <b>{(sources ?? [chain[0].name]).map(eaShortName).join(', ')}</b> → <b>{eaShortName(chain[chain.length - 1].name)}</b>
      </span>
      <span className="ea-brief-via">{via}</span>
    </span>
  )
}

/** 같은 판정, 같은 닿는 방식, 같은 대상인 결론을 한 칸으로 묶는다(순서는 처음 나온 차례) */
export function groupEa<T extends { level: string; rule: string; targetKey: string }>(rows: readonly T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = `${row.level}|${row.rule}|${row.targetKey}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.values()]
}

function NodeName({ obj, onFocus }: { obj: EaObj; onFocus?: (key: string) => void }) {
  const title = [obj.providerLabel, obj.type].filter(Boolean).join(', ')
  return onFocus ? (
    <button type="button" className="ea-path-obj" title={`${title}\n그래프에서 이 항목 중심으로 보기`} onClick={() => onFocus(obj.key)}>{obj.name}</button>
  ) : (
    <b className="ea-path-obj" title={title}>{obj.name}</b>
  )
}
