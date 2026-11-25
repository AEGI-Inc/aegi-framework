import { useCallback, useEffect, useRef, useState } from 'react'
import { applyChange, newCredential, type CollectionCredential, type CredentialChange, type CredentialFields, type CredentialStatus } from '../model/collectionCredential'
import { fetchCollectorStatus, loadLocal, remote, RemoteError, saveLocal, subscribeLocal, type CollectorStatus } from './store'

/**
 * 어디에 저장하나
 * - local: 이 브라우저 (dev 서버)
 * - remote: 팀 공용 D1 (배포본)
 * - local-fallback: 배포본인데 D1 이 아직 없어 브라우저에 저장하는 중
 * - locked: 배포본인데 팀 비밀번호 세션이 없다 — 대장을 보여 주지 않는다
 */
export type CredentialStorage = 'local' | 'remote' | 'local-fallback' | 'locked'

export type NewCredential = CredentialFields & { id: string; status: CredentialStatus }

export interface CredentialsApi {
  items: CollectionCredential[]
  storage: CredentialStorage
  loading: boolean
  warning?: string
  notice?: { id: number; text: string; ok?: boolean }
  clearNotice: () => void
  status: CollectorStatus | null
  refresh: () => void
  /** 성공하면 true (창을 닫는다) */
  create: (draft: NewCredential, actor: string) => Promise<boolean>
  importItems: (items: CollectionCredential[]) => Promise<void>
  change: (id: string, change: CredentialChange, actor: string) => Promise<boolean>
  remove: (id: string) => Promise<void>
}

const REFRESH_MS = 60_000

export function useCredentials(backend: 'local' | 'remote'): CredentialsApi {
  const [items, setItems] = useState<CollectionCredential[]>(() => (backend === 'local' ? loadLocal().items : []))
  const [storage, setStorage] = useState<CredentialStorage>(backend)
  const [loading, setLoading] = useState(backend === 'remote')
  const [warning, setWarning] = useState<string | undefined>(() => (backend === 'local' ? loadLocal().warning : undefined))
  const [notice, setNotice] = useState<CredentialsApi['notice']>()
  const [status, setStatus] = useState<CollectorStatus | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const storageRef = useRef(storage)
  storageRef.current = storage

  const say = (text: string, ok = false) => setNotice({ id: Date.now(), text, ok })

  const loadRemote = useCallback(async () => {
    try {
      const { items: list } = await remote.list()
      setItems(list)
      setStorage('remote')
      setWarning(undefined)
    } catch (err) {
      if (err instanceof RemoteError && err.problem === 'login_required') {
        setItems([])
        setStorage('locked')
      } else if (err instanceof RemoteError && err.problem === 'not_configured') {
        const local = loadLocal()
        setItems(local.items)
        setStorage('local-fallback')
        setWarning(err.message)
      } else {
        setWarning(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(() => {
    if (backend === 'remote') void loadRemote()
    else {
      const local = loadLocal()
      setItems(local.items)
      setWarning(local.warning)
    }
    void fetchCollectorStatus().then(setStatus)
  }, [backend, loadRemote])

  useEffect(() => {
    refresh()
    if (backend === 'local') return subscribeLocal(refresh)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && storageRef.current === 'remote') void loadRemote()
    }, REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && storageRef.current === 'remote') void loadRemote()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [backend, refresh, loadRemote])

  const isRemote = () => storageRef.current === 'remote'

  const writeLocal = (next: CollectionCredential[]) => {
    setItems(next)
    if (!saveLocal(next)) setWarning(loadLocal().warning)
  }

  const replace = (saved: CollectionCredential) =>
    setItems(prev => (prev.some(i => i.id === saved.id) ? prev.map(i => (i.id === saved.id ? saved : i)) : [...prev, saved]))

  const fail = (err: unknown) => {
    if (err instanceof RemoteError) {
      const latest = err.body.item as CollectionCredential | undefined
      if (latest) replace(latest)
      if (err.problem === 'login_required') setStorage('locked')
      say(err.message)
    } else say(err instanceof Error ? err.message : String(err))
    return false
  }

  const create = async (draft: NewCredential, actor: string): Promise<boolean> => {
    const id = draft.id.trim().toUpperCase()
    if (itemsRef.current.some(i => i.id === id)) return fail(new Error(`${id} 는 이미 있습니다.`))
    if (isRemote()) {
      try {
        const { item } = await remote.create(draft, actor)
        replace(item)
        say(`${item.id} 를 등록했습니다.`, true)
        return true
      } catch (err) {
        return fail(err)
      }
    }
    writeLocal([...itemsRef.current, newCredential(draft, actor, new Date().toISOString())])
    say(`${id} 를 등록했습니다.`, true)
    return true
  }

  const importItems = async (list: CollectionCredential[]) => {
    if (!list.length) return
    if (isRemote()) {
      try {
        const res = await remote.importItems(list)
        setItems(prev => [...prev, ...res.items.filter(i => !prev.some(p => p.id === i.id))])
        say(`${res.inserted.length}건을 넣었습니다${res.skipped.length ? `, ${res.skipped.length}건 생략` : ''}.`, true)
      } catch (err) {
        fail(err)
      }
      return
    }
    const fresh = list.filter(i => !itemsRef.current.some(p => p.id === i.id))
    writeLocal([...itemsRef.current, ...fresh])
    say(`${fresh.length}건을 넣었습니다.`, true)
  }

  const change = async (id: string, next: CredentialChange, actor: string): Promise<boolean> => {
    const current = itemsRef.current.find(i => i.id === id)
    if (!current) return false
    if (isRemote()) {
      try {
        const { item } = await remote.change(id, current.updatedAt, actor, next)
        replace(item)
        return true
      } catch (err) {
        return fail(err)
      }
    }
    const outcome = applyChange(current, next, actor, new Date().toISOString())
    if ('problem' in outcome) return fail(new Error(outcome.problem))
    writeLocal(itemsRef.current.map(i => (i.id === id ? outcome.item : i)))
    return true
  }

  const remove = async (id: string) => {
    const current = itemsRef.current.find(i => i.id === id)
    if (!current) return
    if (current.status !== 'planned') {
      fail(new Error('발급 전 항목만 지울 수 있습니다. 사용한 항목은 폐기 처리하세요.'))
      return
    }
    if (isRemote()) {
      try {
        await remote.remove(id, current.updatedAt)
      } catch (err) {
        fail(err)
        return
      }
      setItems(prev => prev.filter(i => i.id !== id))
    } else writeLocal(itemsRef.current.filter(i => i.id !== id))
    say(`${id} 를 지웠습니다.`, true)
  }

  return { items, storage, loading, warning, notice, clearNotice: () => setNotice(undefined), status, refresh, create, importItems, change, remove }
}
