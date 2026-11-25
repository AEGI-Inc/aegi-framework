import type { ObservationKind } from '../model/evidence'

/** 수집 기록 종류를 화면 이름으로. agent_run 같은 내부 이름을 그대로 보이지 않는다 */
const KIND_LABEL: Record<ObservationKind, string> = {
  agent_run: '실행 기록',
  slash_request: '명령 요청',
  audit_event: '감사 로그',
  credential_use: '토큰 사용',
  content_change: '내용 변경',
  delivery: '전송 기록',
  request_log: '요청 로그',
  access_snapshot: '설정',
  correlation: '대조 결과',
}

export function observationKindLabel(kind: ObservationKind | string): string {
  return KIND_LABEL[kind as ObservationKind] ?? kind
}

/** 수집 기록 제목 괄호 안에서 값이 비어 들어간 칸. 「실행 (undefined, a@b)」의 undefined */
const EMPTY_PART = new Set(['', 'undefined', 'null'])

/**
 * 수집기가 빈 값을 문자열로 붙인 제목을 고친다.
 * 「실행 (undefined, a@b)」는 「실행 (a@b)」, 괄호 안이 모두 비면 괄호를 뗀다.
 */
export function readableObservationTitle(title: string): string {
  return title.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => {
    const parts = inner.split(',').map(part => part.trim())
    if (!parts.some(part => EMPTY_PART.has(part))) return whole
    const kept = parts.filter(part => !EMPTY_PART.has(part))
    return kept.length ? ` (${kept.join(', ')})` : ''
  }).trim()
}
