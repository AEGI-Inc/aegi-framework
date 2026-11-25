import { useSyncExternalStore } from 'react'
import type { GraphStoreV2 } from '../model/graph'
import { objectLabel } from '../blast-radius/blastLabels'
import { useStandardResults } from '../config-findings/standardResultsStore'
import { STATUS_LABEL } from '../config-findings/standardItem'
import { CHECK_STATUS_LABEL, criteriaFor, describeBasis, describeCombine, describeCondition, describeReplaced, describeSource, evaluateCheck, loadCriteria, removeCriterion, saveCriterion, subscribeCriteria } from './customCriteria'

const show = (v: unknown) => v === null || v === undefined ? '없음' : typeof v === 'object' ? JSON.stringify(v) : String(v)
const order = (p: boolean | null) => p === false ? 0 : p === null ? 1 : 2

export function useCustomCriteria() { return useSyncExternalStore(subscribeCriteria, loadCriteria) }

/* 인증기준 상세의 「추가한 기준」: 위 확인사항과 같은 모양(머리줄, 기준 문장, 관련 점검 상자)으로 회사가 더한 기준을 현재 그래프로 다시 판정해 보인다 */
export default function CustomCriteriaPanel({ criterion, graph, onOpenObject }: { criterion: string; graph: GraphStoreV2; onOpenObject?: (key: string) => void }) {
  useCustomCriteria()
  const results = useStandardResults()
  const list = criteriaFor(criterion)
  if (!list.length) return <section className="comp-requirement comp-custom" aria-label="추가한 기준">
    <div className="comp-req-head"><b>추가한 기준</b><span className="comp-review">이 브라우저에 저장</span></div>
    <p className="comp-custom-empty">새로 생기거나 바뀐 기준으로 검사하려면 그 기준 문장을 AEGI AI에 입력하세요. AI가 검사 데이터와 필드를 정해 이 항목에 초안으로 붙입니다.</p>
  </section>
  return <>{list.map(c => <section key={c.id} className="comp-requirement comp-custom" aria-label={`추가한 기준 ${c.name}`}>
    <div className="comp-req-head">
      <b>추가한 기준</b>
      <span className={`comp-state ${c.status === 'saved' ? 'is-ready' : 'is-draft'}`}><b>{c.status === 'saved' ? '회사 기준' : 'AI 초안'}</b><span>{c.status === 'saved' ? '저장됨' : '확인 필요'}</span></span>
      <span className="comp-review">이 브라우저에 저장</span>
      <span className="comp-custom-actions">
        {c.status === 'draft' && <button type="button" className="ex-btn cfg-admin-primary" onClick={() => saveCriterion(c.id)}>확인하고 저장</button>}
        <button type="button" className="ex-btn" onClick={() => removeCriterion(c.id)}>{c.status === 'draft' ? '초안 삭제' : '삭제'}</button>
      </span>
    </div>
    <p className="comp-req-text"><strong>{c.name}</strong><br />{c.sourceText}</p>
    <p className="comp-custom-source"><b>출처</b>{c.sourceTitle}</p>
    {c.checks.map(check => {
      const r = evaluateCheck(graph, check)
      const passed = r.targets.filter(t => t.passed).length, failed = r.targets.filter(t => t.passed === false).length
      const rep = check.replaces
      const before = rep && results?.findings.find(f => f.id === rep.finding)?.items.find(i => i.standard === rep.standard && i.item_id === rep.item)
      return <section key={check.id} className="comp-related comp-custom-check">
        <header>
          <span className={`cfg-status tl-badge${r.status === 'fail' ? ' is-failure' : ''}`}>{CHECK_STATUS_LABEL[r.status]}</span>
          <h5>{check.question}</h5>
          <span className="comp-legend"><span>대상 <b>{r.targets.length}</b></span>{r.status !== 'unknown' && <><span className="is-fail"><i />위반 <b>{failed}</b></span><span className="is-pass"><i />충족 <b>{passed}</b></span></>}</span>
        </header>
        <dl className="comp-custom-rules">
          {rep && <><dt>대체하는 기존 점검</dt><dd>{describeReplaced(rep)}, 지금 결과 {before ? STATUS_LABEL[before.status] : '결과 없음'}</dd></>}
          <dt>검사 데이터</dt><dd>{describeSource(check)}</dd>
          <dt>필드</dt><dd>{check.fields.join(', ')}</dd>
          <dt>요구값</dt><dd>{describeCondition(check)}</dd>
          {describeBasis(check) && <><dt>요구값 근거</dt><dd>{describeBasis(check)}</dd></>}
          <dt>결합 방식</dt><dd>{describeCombine(check)}</dd>
        </dl>
        {!!r.targets.length && <div className="comp-saas-table">
          <details className="comp-saas">
            <summary className="comp-custom-summary">대상 {r.targets.length}개 값 보기</summary>
            <ul>{[...r.targets].sort((a, b) => order(a.passed) - order(b.passed)).map(t => <li key={t.key}>
              <span className={`cfg-status tl-badge${t.passed === false ? ' is-failure' : ''}`}>{t.passed === null ? '관측' : t.passed ? '충족' : '위반'}</span>
              <span>{onOpenObject && graph.objectsByKey.has(t.key) ? <button type="button" className="cfg-link" onClick={() => onOpenObject(t.key)}>{objectLabel(t.key, graph)}</button> : <strong>{objectLabel(t.key, graph)}</strong>}</span>
              <span><small>{Object.entries(t.values).map(([k, v]) => `${k.split('.').slice(-2).join('.')}: ${show(v)}`).join(', ')}</small></span>
            </li>)}</ul>
          </details>
        </div>}
      </section>
    })}
  </section>)}</>
}
