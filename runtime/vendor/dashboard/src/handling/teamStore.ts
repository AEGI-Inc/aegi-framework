import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExceptionDataset } from '../model/exception'

/**
 * 팀이 함께 쓰는 기록 저장소 (위협 처리 상태, 조치 진행 상태).
 *
 * 배포본의 실측 데이터는 팀 공용 D1, 개발 서버와 합성 데이터는 이 브라우저(localStorage)에 둔다.
 * 서버 저장소가 아직 없으면(테이블을 만들기 전) 이 브라우저에 저장하고 그 사실을 알린다. 예외 저장소와 같은 방식이다.
 * 같은 기록을 두 사람이 동시에 바꾸면 서버가 409 로 거절하고, 화면은 최신 기록을 다시 불러온다.
 */

export type TeamBackend = 'local' | 'remote'
export type TeamStorage = TeamBackend | 'local-fallback'

export interface TeamStoreOptions<R, C> {
  dataset: ExceptionDataset
  backend: TeamBackend
  /** 서버 주소 (`/api/measured/handling`) */
  endpoint: string
  /** 브라우저 저장 키 접두어 (`aegi.handling.v1`) */
  localKey: string
  keyOf: (record: R) => string
  changeKey: (change: C) => string
  apply: (previous: R | undefined, change: C, dataset: ExceptionDataset, at: string) => R
  /** 서버 저장소가 없을 때 알림 */
  fallback: string
  /** 그사이 다른 사람이 바꿨을 때 알림 */
  conflict: string
}

export interface TeamStore<R, C> {
  items: R[]
  byKey: Map<string, R>
  /** 저장에 성공하면 true */
  save: (change: C) => Promise<boolean>
  notice?: { id: number; text: string }
  storage: TeamStorage
}

class TeamRemoteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export function useTeamStore<R, C>(options: TeamStoreOptions<R, C>): TeamStore<R, C> {
  const { dataset, backend, endpoint, localKey, keyOf, changeKey, apply, fallback, conflict } = options
  const storageKey = `${localKey}:${dataset}`

  const loadLocal = useCallback((): R[] => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown
      return Array.isArray(parsed) ? (parsed as R[]) : []
    } catch {
      return []
    }
  }, [storageKey])

  const [storage, setStorage] = useState<TeamStorage>(backend)
  const [items, setItems] = useState<R[]>(() => (backend === 'local' ? loadLocal() : []))
  const [notice, setNotice] = useState<TeamStore<R, C>['notice']>()
  const storageRef = useRef(storage)
  storageRef.current = storage
  const say = useCallback((text: string) => setNotice({ id: Date.now(), text }), [])

  const call = useCallback(async <T,>(method: 'GET' | 'POST', query: string, body?: unknown): Promise<T> => {
    let res: Response
    try {
      res = await fetch(`${endpoint}${query}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new TeamRemoteError(0, '서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
    }
    // Function 이 없는 배포본은 index.html 이 온다
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) throw new TeamRemoteError(503, fallback)
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok) return data as T
    if (res.status === 401) throw new TeamRemoteError(401, '로그인 시간이 끝났습니다. 새로고침한 뒤 팀 비밀번호로 다시 로그인해 주세요.')
    if (res.status === 503) throw new TeamRemoteError(503, fallback)
    if (res.status === 409) throw new TeamRemoteError(409, conflict)
    throw new TeamRemoteError(res.status, typeof data.message === 'string' ? `저장하지 못했습니다 (${data.message}).` : '저장하지 못했습니다.')
  }, [endpoint, fallback, conflict])

  const useLocal = useCallback((text?: string) => {
    storageRef.current = 'local-fallback'
    setStorage('local-fallback')
    setItems(loadLocal())
    if (text) say(text)
  }, [loadLocal, say])

  const refresh = useCallback(async () => {
    if (storageRef.current !== 'remote') return
    try {
      const { items: fresh } = await call<{ items: R[] }>('GET', `?dataset=${encodeURIComponent(dataset)}`)
      setItems(fresh)
    } catch (err) {
      if (err instanceof TeamRemoteError && err.status === 503) useLocal(err.message)
    }
  }, [call, dataset, useLocal])

  useEffect(() => {
    if (backend === 'local') {
      const reload = () => setItems(loadLocal())
      reload()
      const onStorage = (event: StorageEvent) => event.key === storageKey && reload()
      window.addEventListener('storage', onStorage)
      return () => window.removeEventListener('storage', onStorage)
    }
    void refresh()
    // 다른 사람이 바꾼 것을 받는다: 탭으로 돌아올 때와 1분마다
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => void refresh(), 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [backend, loadLocal, refresh, storageKey])

  const save = useCallback(async (change: C): Promise<boolean> => {
    const key = changeKey(change)
    if (storageRef.current === 'remote') {
      try {
        const { item } = await call<{ item: R }>('POST', '', { dataset, change })
        setItems(list => [...list.filter(r => keyOf(r) !== key), item])
        return true
      } catch (err) {
        if (err instanceof TeamRemoteError && err.status === 503) {
          useLocal(err.message)
        } else {
          if (err instanceof TeamRemoteError && err.status === 409) void refresh()
          say(err instanceof Error ? err.message : String(err))
          return false
        }
      }
    }
    const list = loadLocal()
    const previous = list.find(r => keyOf(r) === key)
    const next = apply(previous, change, dataset, new Date().toISOString())
    const saved = [...list.filter(r => keyOf(r) !== key), next]
    setItems(saved)
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(saved))
    } catch {
      say('이 브라우저에서는 저장할 수 없어, 새로고침하면 사라집니다.')
    }
    return true
  }, [apply, call, changeKey, dataset, keyOf, loadLocal, refresh, say, storageKey, useLocal])

  const byKey = useMemo(() => new Map(items.map(r => [keyOf(r), r])), [items, keyOf])
  return { items, byKey, save, notice, storage }
}
