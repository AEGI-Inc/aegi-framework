import { severityClass, severityLabel, type Severity } from './severity'

/**
 * Threat Analysis 밖에서 쓰는 심각도 표시. 글자 없이 심각도 색 원만 두고,
 * 이름(HIGH 등)은 커서를 올리면 뜨고 화면 읽기 프로그램이 읽는다.
 * count를 주면 원 옆에 건수를 붙인다.
 */
export default function SeverityDot({ severity, count }: { severity: Severity; count?: number }) {
  const label = severityLabel(severity)
  const dot = <i className={`severity-dot ${severityClass(severity)}`} role="img" aria-label={label} title={label} />
  if (count === undefined) return dot
  return <span className="severity-count" title={`${label} ${count}`}>{dot}{count}</span>
}
