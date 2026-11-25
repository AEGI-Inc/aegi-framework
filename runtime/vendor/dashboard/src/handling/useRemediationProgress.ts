import type { ExceptionDataset } from '../model/exception'
import {
  applyProgressChange,
  progressKey,
  type RemediationProgressChange,
  type RemediationProgressRecord,
} from '../model/remediationProgress'
import { useTeamStore, type TeamBackend, type TeamStore } from './teamStore'

/**
 * 조치 진행 상태 저장소. 위협(지문)과 조치의 짝마다 한 기록이다.
 * 배포본의 실측 데이터는 팀 공용 D1(server/remediationProgress.ts), 그 밖에는 이 브라우저에 둔다.
 */
export type RemediationProgressApi = TeamStore<RemediationProgressRecord, RemediationProgressChange>

const keyOf = (record: RemediationProgressRecord) => progressKey(record.fingerprint, record.remediationId)
const changeKey = (change: RemediationProgressChange) => progressKey(change.fingerprint, change.remediationId)

export function useRemediationProgress(dataset: ExceptionDataset, backend: TeamBackend): RemediationProgressApi {
  return useTeamStore<RemediationProgressRecord, RemediationProgressChange>({
    dataset,
    backend,
    endpoint: '/api/measured/remediation-progress',
    localKey: 'aegi.remediation-progress.v1',
    keyOf,
    changeKey,
    apply: applyProgressChange,
    fallback: '팀 공용 조치 진행 저장소가 아직 준비되지 않아, 조치 진행을 이 브라우저에만 저장합니다.',
    conflict: '다른 사람이 먼저 이 조치의 진행 상태를 바꿨습니다. 최신 상태를 다시 불러왔습니다.',
  })
}
