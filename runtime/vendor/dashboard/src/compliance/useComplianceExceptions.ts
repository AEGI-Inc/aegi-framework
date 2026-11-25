import type { ExceptionDataset } from '../model/exception'
import {
  applyComplianceExceptionChange,
  complianceExceptionKey,
  type ComplianceException,
  type ComplianceExceptionChange,
} from '../model/complianceException'
import { useTeamStore, type TeamBackend, type TeamStore } from '../handling/teamStore'

/**
 * 컴플라이언스 예외 저장소. 배포본의 실측 데이터는 팀 공용 D1(server/complianceExceptions.ts), 그 밖에는 이 브라우저에 둔다.
 * 저장 방식은 처리 상태, 목적지 승인과 같은 teamStore.ts 다.
 */
export type ComplianceExceptionsApi = TeamStore<ComplianceException, ComplianceExceptionChange>

const keyOf = (record: ComplianceException) => record.id
const changeKey = (change: ComplianceExceptionChange) => complianceExceptionKey(change.scope, change.target)

export function useComplianceExceptions(dataset: ExceptionDataset, backend: TeamBackend): ComplianceExceptionsApi {
  return useTeamStore<ComplianceException, ComplianceExceptionChange>({
    dataset,
    backend,
    endpoint: '/api/measured/compliance-exceptions',
    localKey: 'aegi.complianceExceptions.v1',
    keyOf,
    changeKey,
    apply: applyComplianceExceptionChange,
    fallback: '팀 공용 예외 저장소가 아직 준비되지 않아, 컴플라이언스 예외를 이 브라우저에만 저장합니다.',
    conflict: '다른 사람이 먼저 이 예외를 바꿨습니다. 최신 목록을 다시 불러왔습니다.',
  })
}
