import type { KgToolName } from './chatProtocol'

export interface ToolProgress {
  id: string
  name: KgToolName
  status: 'running' | 'complete' | 'failed'
}

/** Display tool metadata only, never arguments or returned evidence. */
export const TOOL_LABELS: Record<KgToolName, string> = {
  "search_logs": "Splunk 로그 검색",
  "read_logs": "Splunk 검색 결과 더 읽기",
  "collection_status": "SaaS 수집 상태 확인",
  "event_context": "이벤트 관련 근거 조사",
  "investigation_status": "위협 처리 기록 확인",
  "standard_findings": "보안 기준 설정 점검 결과 조회",
  "compliance_item": "Compliance 인증기준 조회",
  "compliance_remediation_plan": "컴플라이언스 조치 계획 추천",
  "custom_criterion": "추가 기준으로 설정 판정",
  "guideline_criterion": "등록된 가이드라인으로 설정 판정",
  "dashboard_help": "대시보드 사용법 확인",
  "search_events": "이벤트 검색",
  "event_connections": "이벤트 연결 조회",
  "selection_context": "선택한 항목 확인",
  "access_gaps": "Access Gap 조회",
  "dashboard_summary": "대시보드 현황 조회",
  "kg_schema": "지식 그래프 구조 확인",
  "search_objects": "그래프 객체 검색",
  "neighbors": "객체 관계 조회",
  "identity": "동일인 계정 조회",
  "access": "접근 권한 조회",
  "paths": "객체 간 경로 탐색",
  "findings": "탐지된 위협 조회",
  "remediation": "권장 조치 조회",
  "credential_blast": "자격증명 피해범위 조회"
}
