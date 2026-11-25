/**
 * 다른 화면에서 데모 시연(DemoTour)을 시작한다. 공개 데모 「데모 선택」(src/tutorial)가 쓴다.
 * 시연이 있는 화면은 아직 그려지지 않았을 수 있어, 시작할 시연 id 를 이 탭에 남기고 그 화면 주소로 옮긴다.
 * 그 화면의 DemoTour 가 그려지면서 남긴 id 를 읽어 시작한다. 이미 그려져 있으면 사건으로 바로 시작한다.
 * 스타일을 불러오지 않는다(데모 선택 단위 시험이 node 에서 그린다).
 */
const PENDING_KEY = 'aegi:demo-tour:pending'
export const TOUR_EVENT = 'aegi:demo-tour'

export function requestTour(id: string, hash: string): void {
  try { window.sessionStorage.setItem(PENDING_KEY, id) } catch { /* 남기지 못하면 사건으로만 시작한다 */ }
  if (window.location.hash !== hash) window.location.hash = hash
  window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: id }))
}

/** 남겨 둔 시연이 이 id 면 지우고 참 */
export function takePendingTour(id: string): boolean {
  try {
    if (window.sessionStorage.getItem(PENDING_KEY) !== id) return false
    window.sessionStorage.removeItem(PENDING_KEY)
    return true
  } catch { return false }
}

/** 체험을 마치거나 끝내면 공개 데모 데모 선택로 돌아간다(src/tutorial/DemoTutorial.tsx 가 받아 그래프 화면의 고르기를 연다) */
export const LANDING_EVENT = 'aegi:demo-landing'
export const requestLanding = (): void => { window.dispatchEvent(new Event(LANDING_EVENT)) }
