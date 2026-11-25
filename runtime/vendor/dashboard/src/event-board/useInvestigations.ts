import type { ExceptionDataset } from '../model/exception'
import {
  applyInvestigationChange,
  type InvestigationChange,
  type InvestigationRecord,
} from '../model/investigation'
import { useTeamStore, type TeamBackend, type TeamStore } from '../handling/teamStore'

export type InvestigationsApi = TeamStore<InvestigationRecord, InvestigationChange>

const keyOf = (record: InvestigationRecord) => record.id
const changeKey = (change: InvestigationChange) => change.id

export function useInvestigations(dataset: ExceptionDataset, backend: TeamBackend): InvestigationsApi {
  return useTeamStore<InvestigationRecord, InvestigationChange>({
    dataset,
    backend,
    endpoint: '/api/measured/investigations',
    localKey: 'aegi.event-investigations.v1',
    keyOf,
    changeKey,
    apply: applyInvestigationChange,
    fallback: '팀 공용 조사 저장소가 아직 준비되지 않아, 조사를 이 브라우저에만 저장합니다.',
    conflict: '다른 사람이 먼저 이 조사를 바꿨습니다. 최신 상태를 다시 불러왔습니다.',
  })
}
