/*
 * 화면 안 「←」 단추와 브라우저 방문 기록.
 *
 * 전에는 「←」가 상위 화면 주소를 새 기록으로 쌓아, 위협 3건을 열고 닫으면 Overview까지 브라우저
 * 뒤로 가기를 7번 눌러야 했다. 앱 안에서 새 기록이 생길 때마다 직전 주소를 history.state 에 적어 두고,
 * 「←」가 가려는 곳이 바로 직전 기록이면 새 기록을 쌓지 않고 브라우저 뒤로 가기를 한다.
 * 링크로 바로 들어왔거나 다른 화면에서 왔으면 전처럼 상위 화면을 연다.
 *
 * 주소만 바꾸는 replaceState 는 history.state 를 그대로 넘겨 이 표시를 지우지 않는다.
 */

type Marked = { aegiFrom: string | null }

const isMarked = (state: unknown): state is Marked =>
  typeof state === 'object' && state !== null && 'aegiFrom' in state

const objectState = (state: unknown): object => (typeof state === 'object' && state !== null ? state : {})

/** 앱이 뜰 때 한 번 건다. 돌려준 함수로 뗀다 */
export function trackInAppHistory(): () => void {
  // 처음 연 기록에는 직전 주소가 없다. 표시해 두어 나중에 뒤로 가기로 돌아와도 새 기록으로 보지 않는다
  if (!isMarked(window.history.state)) window.history.replaceState({ ...objectState(window.history.state), aegiFrom: null }, '')
  const onHash = (event: HashChangeEvent) => {
    // 표시가 있으면 뒤로, 앞으로 가기로 돌아온 기록이다
    if (isMarked(window.history.state)) return
    let from: string | null = null
    try {
      from = new URL(event.oldURL).hash
    } catch {
      from = null
    }
    window.history.replaceState({ ...objectState(window.history.state), aegiFrom: from }, '')
  }
  window.addEventListener('hashchange', onHash)
  return () => window.removeEventListener('hashchange', onHash)
}

/** 바로 직전 기록이 상위 화면(isParent)이면 뒤로 가기, 아니면 fallback 으로 상위 화면을 연다 */
export function backOr(isParent: (hash: string) => boolean, fallback: () => void) {
  const state = window.history.state
  const from = isMarked(state) ? state.aegiFrom : null
  if (from !== null && isParent(from)) window.history.back()
  else fallback()
}

/** 주소가 그 화면의 목록인지 (상세 키가 없는지) */
export const isListHash = (prefix: string, detailKey: string) => (hash: string) => {
  const lower = hash.toLowerCase()
  return (lower === prefix || lower.startsWith(`${prefix}?`)) && !new RegExp(`[?&]${detailKey}=`, 'i').test(hash)
}
