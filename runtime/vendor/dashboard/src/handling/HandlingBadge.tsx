import { HANDLING_LABEL, type HandlingState } from '../model/handling'

/** 처리 상태 배지. 목록, 상세, 이력이 같은 모양을 쓴다 */
export default function HandlingBadge({ state, auto = false }: { state: HandlingState; auto?: boolean }) {
  return <b className={`hd-badge ${state}`}>{auto ? 'Auto ' : ''}{HANDLING_LABEL[state]}</b>
}
