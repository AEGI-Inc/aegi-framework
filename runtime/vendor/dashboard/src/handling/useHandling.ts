import type { ExceptionDataset } from '../model/exception'
import { applyHandlingChange, type HandlingChange, type ThreatHandling } from '../model/handling'
import { useTeamStore, type TeamBackend, type TeamStorage } from './teamStore'

/**
 * 위협 처리 상태 저장소. 배포본의 실측 데이터는 팀 공용 D1(server/handling.ts), 그 밖에는 이 브라우저에 둔다.
 * 저장 방식은 teamStore.ts 를 조치 진행 상태와 같이 쓴다.
 */

export type HandlingBackend = TeamBackend

export interface HandlingApi {
  /** 지문 → 기록 */
  byFingerprint: Map<string, ThreatHandling>
  items: ThreatHandling[]
  /** 저장에 성공하면 true */
  save: (change: HandlingChange) => Promise<boolean>
  /** 화면에 띄울 알림 (저장 실패, 서버 저장소 없음 등) */
  notice?: { id: number; text: string }
  storage: TeamStorage
}

const keyOf = (record: ThreatHandling) => record.fingerprint
const changeKey = (change: HandlingChange) => change.fingerprint

export function useHandling(dataset: ExceptionDataset, backend: HandlingBackend): HandlingApi {
  const store = useTeamStore<ThreatHandling, HandlingChange>({
    dataset,
    backend,
    endpoint: '/api/measured/handling',
    localKey: 'aegi.handling.v1',
    keyOf,
    changeKey,
    apply: applyHandlingChange,
    fallback: '팀 공용 처리 상태 저장소가 아직 준비되지 않아, 처리 상태를 이 브라우저에만 저장합니다.',
    conflict: '다른 사람이 먼저 이 위협의 처리 상태를 바꿨습니다. 최신 상태를 다시 불러왔습니다.',
  })
  return { byFingerprint: store.byKey, items: store.items, save: store.save, notice: store.notice, storage: store.storage }
}
