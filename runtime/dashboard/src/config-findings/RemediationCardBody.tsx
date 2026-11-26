import type { FindingRemediation } from '../compliance/remediations'

export default function RemediationCardBody({ remediation }: { remediation: FindingRemediation }) {
  return (
    <div className="cfgd-remediation-body">
      <p className="cfgd-remediation-summary">{remediation.summary}</p>
      {remediation.where ? (
        <div className="cfgd-remediation-where">
          <span className="cfgd-label">설정 위치:</span> {remediation.where}
        </div>
      ) : null}
      <dl className="cfgd-remediation-facts">
        <div>
          <dt>변경 설정</dt>
          <dd>{remediation.change.setting}</dd>
        </div>
        <div>
          <dt>권장값</dt>
          <dd>{remediation.change.recommended}</dd>
        </div>
      </dl>
      {remediation.steps.length > 0 && (
        <div className="cfgd-remediation-section">
          <h4>조치 절차</h4>
          <ol className="cfgd-steps">
            {remediation.steps.map((step, idx) => (
              <li key={idx}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      {remediation.impact ? (
        <div className="cfgd-remediation-section">
          <h4>영향 검토</h4>
          <p>{remediation.impact}</p>
        </div>
      ) : null}
      {remediation.verify ? (
        <div className="cfgd-remediation-section">
          <h4>확인 방법</h4>
          <p>{remediation.verify}</p>
        </div>
      ) : null}
      {remediation.references && remediation.references.length > 0 && (
        <div className="cfgd-remediation-section">
          <h4>참고 자료</h4>
          <ul className="cfgd-refs">
            {remediation.references.map((ref, idx) => {
              const label = [ref.source, ref.item].filter(Boolean).join(' ') || ref.url
              return (
                <li key={idx}>
                  {ref.url ? (
                    <a href={ref.url} target="_blank" rel="noreferrer">
                      {label}
                    </a>
                  ) : (
                    <span>{label}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
