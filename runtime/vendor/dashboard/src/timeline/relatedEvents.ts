/**
 * 다른 화면(위협 상세, 그래프 객체)에 다는 「관련 이벤트」. 건수는 dev 데이터셋 폴더의 이벤트가 있을 때만 센다.
 * 서버(Splunk) 이벤트는 화면을 여는 것만으로 불러오지 않으므로 건수 없이 단추만 두고, 누르면 그 객체의 최근 7일을 불러온다.
 */
import { useEffect, useState } from 'react'
import { localTimeline } from './loadTimeline'
import { emptyFilter, filterEvents, withTime } from './timelineAnalysis'

const objectPins = (keys: readonly string[]) => keys.map(value => ({ kind: 'object' as const, value, label: value }))

/** 그 객체 중 하나라도 행위자, 대상, 원인으로 든 이벤트 수. 로컬 이벤트가 없으면(서버 조회) null */
export function useRelatedEventCount(objectKeys: readonly string[]): number | null {
  const joined = objectKeys.join('\n')
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    const keys = joined ? joined.split('\n') : []
    if (!keys.length) { setCount(0); return }
    const source = localTimeline()
    setCount(source ? filterEvents(withTime(source.events).timed, { ...emptyFilter(), pins: objectPins(keys) }).length : null)
  }, [joined])
  return count
}

