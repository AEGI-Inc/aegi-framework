import { kindName, type PathStep, type ScenarioGraph } from './scenarioGraph'
import { effectDetails } from './pathRisk'
import { named, withJosa } from './plainText'

/** 문장 주어: 한 사람이면 「이름」은(는), 여럿이면 다섯까지 적고 나머지는 「외 n명」 */
function subject(people: Array<{ name: string; inferred: boolean }>): string {
  const label = (p: { name: string; inferred: boolean }) => `${p.inferred ? '추정 ' : ''}${p.name}`
  if (people.length === 1) return named(label(people[0]), '은', '는')
  const shown = people.slice(0, 5).map(label).join(', ')
  return `${shown}${people.length > 5 ? ` 외 ${people.length - 5}명` : ''}은(는)`
}

/**
 * 경로 끝 영향: 영향마다 「누가, 직접 권한 없이, 무엇을 하게 되나」를 한 문장으로 먼저 보이고,
 * 엔진 근거(접근 표의 직접 권한과 파생 접근, 경로 간선)는 접어 둔다.
 */
export default function EffectPanel({ sg, path }: { sg: ScenarioGraph; path: PathStep[] }) {
  const details = effectDetails(sg, path)
  if (!details.length) return null
  const dest = sg.name(path[path.length - 1].key)
  return (
    <section className="scb-analysis" aria-label="영향 근거">
      <h2>이 경로로 생기는 일</h2>
      {details.map((d, i) => (
        <div key={i} className="scb-effect">
          <p className="scb-effect-line">
            <b className="scb-badge is-warn">{d.kind}</b>{' '}
            {d.effect === 'write'
              ? <>{subject(d.people)} {d.kind === '권한 상승' ? '직접 권한으로는 할 수 없는데' : '직접 권한이 없는데'}, 이 경로를 거치면 {named(dest)}에 {withJosa(d.action ?? '변경', '을', '를')} 할 수 있다.</>
              : <>{subject(d.people)} 원래 {named(d.origin ? sg.name(d.origin) : '원본', '을', '를')} 볼 수 없는데, 이 경로로 {named(dest)}에 옮겨진 내용을 보게 된다.</>}
          </p>
          <details className="scb-props">
            <summary>근거</summary>
            <p className="scb-effect-who"><b>{d.people[0]?.name}</b> {d.native}</p>
            {d.chain.length > 0 && (
              <ul className="scb-edges">
                {d.chain.map(e => <li key={e.id}>{e.fromName} → {e.toName}, {kindName(e.kind)}: {e.label}</li>)}
              </ul>
            )}
          </details>
        </div>
      ))}
    </section>
  )
}
