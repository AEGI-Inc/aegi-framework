import type { GraphStoreV2 } from '../model/graph'
import type { FindingV2 } from '../model/findingV2'
import type { Provider } from '../model/object'
import AccessGapVenn, { accessProviders, byPersonOrder, directText, isGapPerson, type VennPerson } from './AccessGapVenn'
import { keyName, realKey } from './accessGapNames'
import SeverityDot from './SeverityDot'
import type { Severity } from './severity'
import { PROVIDERS_WITH_LOGO, providerLogoId } from './providers'
import ProviderLogo from '../ProviderLogo'
import type { ProviderId } from '../providerOverviewData'

export function vennPeople(f: FindingV2, graph: GraphStoreV2): VennPerson[] {
  const providerOf = (k: string) => graph.objectsByKey.get(k)?.canonical.provider
  return (f.threatAccessGap?.people ?? []).map(p => ({ ...p, name: keyName(p.person, graph), providers: accessProviders(p, providerOf) }))
}

function PeopleTable({ people, point }: { people: VennPerson[]; point: string }) {
  const rows = [...people].sort(byPersonOrder)
  return (
    <div className="agp-table">
      <table>
        <thead>
          <tr>
            <th>사람</th>
            <th>직접 권한</th>
            <th>파생 접근</th>
            <th>새로 생긴 권한</th>
            <th>연동 지점</th>
            <th>확실성</th>
            <th>제외</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.person} className={isGapPerson(p) ? 'agp-row-gap' : ''}>
              <td>{p.name}</td>
              <td>{directText(p)}</td>
              <td>{p.derived ?? '없음'}</td>
              <td>{isGapPerson(p) ? <span className="agp-side agp-side-gap">{p.gained.join(', ')}</span> : p.gained.join(', ')}</td>
              <td>{p.derived ? point : ''}</td>
              <td>{p.certainty ?? '확정'}</td>
              <td>{p.excluded ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 누구나 줄(2026-11-20 결정). Access Gap 은 누구나를 넣지 않아(엔진 명세 「넣는 위협」) 사람 표 아래 한 줄로 따로 보인다.
 * 값은 엔진 위협 사람(subjects)의 누구나 줄 그대로
 */
function EveryoneLine({ finding }: { finding: FindingV2 }) {
  const s = finding.threatSubjects?.find(x => x.person === '@everyone')
  if (!s) return null
  // 한 글 조각으로 그려야 영어 보기의 화면 글자 바꾸기가 통째로 찾는다
  return <p className="agp-everyone">{`누구나: ${s.levels?.length ? `${s.levels.join(', ')}를 새로 얻음, ` : ''}${s.certainty}`}</p>
}

/**
 * 위협 하나의 Access Gap 벤(엔진 계약 accessGap): 대상과 연동 지점, 두 수, 벤, 범례, 사람 표.
 * Access Gaps 상세와 위협 상세(embedded)가 같이 쓴다. 벤이 없는 위협(threatAccessGap, threatPath 없음)은 그리지 않는다
 */
export default function ThreatAccessGapPanel({ finding, graph, embedded = false }: { finding: FindingV2; graph: GraphStoreV2; embedded?: boolean }) {
  const gap = finding.threatAccessGap
  const path = finding.threatPath
  if (!gap || !path) return null
  const people = vennPeople(finding, graph)
  const targets = finding.threatTargets ?? []
  const target = targets.length > 1 ? `${keyName(path.target, graph)} 아래 ${targets.length}개` : keyName(path.target, graph)
  const realTarget = realKey(path.target)
  const provider = realTarget ? (graph.objectsByKey.get(realTarget)?.canonical.provider as Provider | undefined) : undefined
  return (
    <section className={`access-gap-panel ${embedded ? 'is-embedded' : ''}`} aria-label="Access Gap">
      <div className="agp-head">
        <div className="agp-title">
          <h2 className="agp-name">
            <span className="agp-name-end">
              {provider && PROVIDERS_WITH_LOGO.has(provider) && (
                <span className="agp-name-logo"><ProviderLogo provider={provider === 'gws' ? 'google-workspace' : (provider as ProviderId)} /></span>
              )}
              {target}
            </span>
          </h2>
          <dl className="agp-meta">
            <div><dt>연동 지점</dt><dd>{keyName(path.point, graph)}</dd></div>
            <div><dt>유형</dt><dd>{finding.primaryType}</dd></div>
            <div><dt>심각도</dt><dd><SeverityDot severity={finding.severity as Severity} /></dd></div>
          </dl>
        </div>
        <p className="agp-equation">
          <span className={`agp-eq-term is-gap ${gap.unauthorized ? 'has-gap' : ''}`}><b>권한 없는 접근자</b><strong>{gap.unauthorized}</strong><small>명</small></span>
          <span className={`agp-eq-term is-gap ${gap.excess ? 'has-gap' : ''}`}><b>권한 초과 접근자</b><strong>{gap.excess}</strong><small>명</small></span>
        </p>
      </div>
      <div className="agp-graph"><AccessGapVenn people={people} directCount={gap.directCount} derivedCount={gap.derivedCount} logo={pr => <ProviderLogo provider={providerLogoId(pr)} className="gv-logo" />} /></div>
      <div className="agp-legend">
        <span><i className="lg-normal" /> 직접 권한</span>
        <span><i className="lg-integration" /> 파생 접근</span>
        <span><i className="lg-gap" /> 권한 없는 접근자, 권한 초과 접근자</span>
        <span><i className="lg-approx" /> 미확정</span>
        <span><i className="lg-excluded" /> 관리자, 승인됨</span>
      </div>
      <PeopleTable people={people} point={keyName(path.point, graph)} />
      <EveryoneLine finding={finding} />
    </section>
  )
}
