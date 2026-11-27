import { useCallback, useEffect, useRef, useState } from 'react'
import type { FindingV2 } from '../model/findingV2'
import type {
  ExceptionDataset,
  ExceptionReasonCategory,
  ExceptionScope,
  ThreatException,
} from '../model/exception'
import { fingerprintOf } from './applyExceptions'
import { falsePositivePatternOf } from './falsePositiveHints'
import { findingTagKey } from '../findings/scenarioTags'
import { loadExceptions, MEMORY_WARNING, newDecisionId, newExceptionId, saveExceptions, subscribeExceptions } from './store'
import { remote, RemoteError } from './remote'

/** 예외 처리 창에서 새로 만드는 범위. 이번 발생, 선택 대상은 옛 위반 대상(subjects) 단위라 저장된 기록만 남는다 */
export type DraftScope = Extract<ExceptionScope, 'finding' | 'destination'>

/** 예외 처리 창에서 받은 값 */
export interface ExceptionDraft {
  scope: DraftScope
  /** scope 가 destination 이면 고른 목적지 키 */
  subjectKeys: string[]
  /** scope 가 destination 일 때 목적지 키별 이름 */
  destinationLabels?: Record<string, string>
  reasonCategory: ExceptionReasonCategory
  reason: string
  reference?: string
  actor: string
  /** 승인자 (위험 수용, 구성 전체는 필수) */
  approver?: string
  expiresAt: string | null
}

/** 등록 당시 모습. 재검토 신호(심각도 상승, 추정에서 확인)를 이것과 비교해 낸다. subjectKeys 는 저장 형식 때문에 빈 목록으로 둔다 */
export function snapshotOf(finding: FindingV2): ThreatException['snapshot'] {
  const pattern = falsePositivePatternOf(finding)
  return {
    findingId: finding.id,
    title: finding.title,
    severity: finding.severity,
    subjectKeys: [],
    checkStates: Object.fromEntries((finding.checks ?? []).map(c => [c.id, c.state])),
    ...(pattern ? { pattern } : {}),
  }
}

/** 창에서 받은 값으로 예외 레코드를 만든다. 위협 전체는 한 건, 목적지 전체는 목적지마다 한 건. */
export function buildExceptions(finding: FindingV2, draft: ExceptionDraft, dataset: ExceptionDataset, now: Date): ThreatException[] {
  const at = now.toISOString()
  const base = {
    dataset,
    scope: draft.scope,
    ruleId: finding.ruleId,
    scenarioKey: findingTagKey(finding) ?? 'other',
    fingerprint: fingerprintOf(finding),
    reasonCategory: draft.reasonCategory,
    reason: draft.reason.trim(),
    reference: draft.reference?.trim() || undefined,
    actor: draft.actor.trim(),
    ...(draft.approver?.trim() ? { approver: draft.approver.trim() } : {}),
    /* 한 창에서 여러 대상을 골라도 결정은 하나다. 목록과 개수는 이것으로 묶는다 */
    decisionId: newDecisionId(),
    createdAt: at,
    expiresAt: draft.expiresAt,
    snapshot: snapshotOf(finding),
  }
  if (draft.scope === 'finding') {
    return [{ ...base, id: newExceptionId(), history: [{ at, action: 'created', actor: base.actor }] }]
  }
  return draft.subjectKeys.map(key => ({
    ...base,
    id: newExceptionId(),
    subjectKey: key,
    subjectLabel: draft.destinationLabels?.[key] ?? key,
    history: [{ at, action: 'created' as const, actor: base.actor }],
  }))
}

export interface ExceptionEdit {
  reasonCategory?: ExceptionReasonCategory
  reason?: string
  reference?: string
}

/**
 * 어디에 저장하는가
 * - local: 이 브라우저(localStorage). 합성 데이터셋과, 실측이라도 dev 서버의 로컬 파일일 때
 * - remote: 팀 공용 D1 (server/exceptions.ts). 배포본에서 실측 · 실측 v2 를 볼 때
 * - local-fallback: remote 여야 하는데 서버 저장소가 아직 설정되지 않아 브라우저에 저장하는 중
 */
export type ExceptionBackend = 'local' | 'remote'
export type ExceptionStorage = 'local' | 'remote' | 'local-fallback'

export interface ExceptionsApi {
  exceptions: ThreatException[]
  storage: ExceptionStorage
  /** 서버에서 처음 불러오는 중 */
  loading: boolean
  warning?: string
  /** 방금 한 동작이 실패한 이유. 화면이 알림으로 띄우고 clearNotice 로 지운다 */
  notice?: { id: number; text: string }
  clearNotice: () => void
  /** 서버 저장소를 쓰는데 이 브라우저에만 남아 있는 예외 수 (서버가 생기기 전에 건 것) */
  localPending: number
  uploadLocal: () => Promise<void>
  refresh: () => void
  add: (items: ThreatException[]) => void
  /** 등록 직후 되돌리기. 이력이 생기기 전이라 레코드를 지운다 (서버는 10분 안에만) */
  remove: (ids: string[]) => void
  revoke: (ids: string[], actor: string, note?: string) => void
  extend: (id: string, expiresAt: string | null, actor: string) => void
  edit: (id: string, patch: ExceptionEdit, actor: string) => void
  /** 만료·취소된 예외를 같은 내용으로 새로 만든다 */
  reapply: (
    id: string,
    patch: { reason: string; expiresAt: string | null; snapshot?: ThreatException['snapshot']; approver?: string },
    actor: string
  ) => ThreatException | undefined
  importItems: (items: ThreatException[]) => void
}

const stamp = () => new Date().toISOString()

/** 목록에 서버가 돌려준 레코드를 덮어쓴다 (없으면 붙인다) */
function upsert(list: ThreatException[], saved: ThreatException[]): ThreatException[] {
  const byId = new Map(saved.map(item => [item.id, item]))
  const out = list.map(item => byId.get(item.id) ?? item)
  for (const item of saved) if (!list.some(e => e.id === item.id)) out.push(item)
  return out
}

// 로컬 저장소에서 쓰는 변경 — 서버 모드에서는 화면을 먼저 바꾸는 데(낙관적 반영) 같은 함수를 쓴다
const revoked = (list: ThreatException[], ids: string[], actor: string, note?: string) =>
  list.map(exc =>
    ids.includes(exc.id) && !exc.revokedAt
      ? {
          ...exc,
          revokedAt: stamp(),
          revokedBy: actor,
          revokeReason: note?.trim() || undefined,
          history: [...exc.history, { at: stamp(), action: 'revoked' as const, actor, note: note?.trim() || undefined }],
        }
      : exc
  )
const extended = (list: ThreatException[], id: string, expiresAt: string | null, actor: string) =>
  list.map(exc =>
    exc.id === id
      ? {
          ...exc,
          expiresAt,
          history: [...exc.history, { at: stamp(), action: 'extended' as const, actor, note: expiresAt ? `만료 ${expiresAt.slice(0, 10)}` : '무기한' }],
        }
      : exc
  )
const edited = (list: ThreatException[], id: string, patch: ExceptionEdit, actor: string) =>
  list.map(exc =>
    exc.id === id
      ? {
          ...exc,
          reasonCategory: patch.reasonCategory ?? exc.reasonCategory,
          reason: patch.reason?.trim() ?? exc.reason,
          reference: patch.reference === undefined ? exc.reference : patch.reference.trim() || undefined,
          history: [...exc.history, { at: stamp(), action: 'edited' as const, actor, note: '사유 수정' }],
        }
      : exc
  )

const FALLBACK_WARNING = '팀 공용 예외 저장소가 아직 설정되지 않아, 지금은 이 브라우저에만 저장합니다. 서버가 설정되면 이 화면에서 서버로 올릴 수 있습니다.'
const REFRESH_MS = 60_000

export function useExceptions(dataset: ExceptionDataset, backend: ExceptionBackend = 'local'): ExceptionsApi {
  const [storage, setStorage] = useState<ExceptionStorage>(backend)
  const [items, setItems] = useState<ThreatException[]>(() => (backend === 'local' ? loadExceptions(dataset).items : []))
  const [warning, setWarning] = useState<string | undefined>(() => (backend === 'local' ? loadExceptions(dataset).warning : undefined))
  const [loading, setLoading] = useState(backend === 'remote')
  const [notice, setNotice] = useState<ExceptionsApi['notice']>()
  const [localPending, setLocalPending] = useState(0)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const storageRef = useRef(storage)
  storageRef.current = storage
  /** 서버로 가는 요청 수. 이게 0 일 때만 주기적으로 다시 불러온다 (보낸 변경을 옛 목록으로 덮지 않게) */
  const inFlight = useRef(0)

  const setList = useCallback((update: (list: ThreatException[]) => ThreatException[]) => {
    itemsRef.current = update(itemsRef.current)
    setItems(itemsRef.current)
  }, [])

  const say = useCallback((text: string) => setNotice({ id: Date.now(), text }), [])

  const refresh = useCallback(async () => {
    if (storageRef.current !== 'remote' || inFlight.current > 0) return
    try {
      const { items: fresh } = await remote.list(dataset)
      if (inFlight.current > 0) return
      itemsRef.current = fresh
      setItems(fresh)
      setWarning(undefined)
    } catch (err) {
      if (err instanceof RemoteError && err.problem === 'not_configured') {
        // 서버 저장소가 없다 → 이 브라우저에 저장한다 (실측 데이터는 계속 보인다)
        const local = loadExceptions(dataset)
        storageRef.current = 'local-fallback'
        setStorage('local-fallback')
        itemsRef.current = local.items
        setItems(local.items)
        setWarning(local.warning ?? FALLBACK_WARNING)
      } else {
        setWarning(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setLoading(false)
      if (storageRef.current === 'remote') setLocalPending(loadExceptions(dataset).items.length)
    }
  }, [dataset])

  useEffect(() => {
    if (backend === 'local') {
      const reload = () => {
        const local = loadExceptions(dataset)
        itemsRef.current = local.items
        setItems(local.items)
        setWarning(local.warning)
      }
      reload()
      return subscribeExceptions(dataset, reload)
    }
    void refresh()
    // 다른 사람이 바꾼 것을 받는다: 탭으로 돌아올 때와 1분마다
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [dataset, backend, refresh])

  /** 이 브라우저에 저장 (local · local-fallback) */
  const commitLocal = useCallback(
    (update: (list: ThreatException[]) => ThreatException[]) => {
      setList(update)
      const saved = saveExceptions(dataset, itemsRef.current)
      setWarning(prev => (saved ? (prev === MEMORY_WARNING ? undefined : prev) : MEMORY_WARNING))
    },
    [dataset, setList]
  )

  /**
   * 서버에 저장. 화면을 먼저 바꾸고(optimistic), 서버가 돌려준 레코드로 맞춘다.
   * 실패하면 이유를 알리고 서버의 지금 목록을 다시 받는다 — 화면이 서버와 달라진 채로 남지 않게.
   */
  const commitRemote = useCallback(
    async (optimistic: (list: ThreatException[]) => ThreatException[], call: () => Promise<{ saved?: ThreatException[]; removed?: string[] }>) => {
      setList(optimistic)
      inFlight.current += 1
      let failed: unknown
      try {
        const { saved = [], removed = [] } = await call()
        setList(list => upsert(list.filter(e => !removed.includes(e.id)), saved))
      } catch (err) {
        failed = err
      } finally {
        inFlight.current -= 1
      }
      if (failed instanceof RemoteError && failed.problem === 'not_configured') {
        // 서버 저장소가 없다 → 방금 한 변경을 잃지 않게 이 브라우저 기록에 합쳐 저장하고 브라우저 저장으로 바꾼다
        const merged = upsert(loadExceptions(dataset).items, itemsRef.current)
        storageRef.current = 'local-fallback'
        setStorage('local-fallback')
        itemsRef.current = merged
        setItems(merged)
        saveExceptions(dataset, merged)
        setWarning(FALLBACK_WARNING)
        setLoading(false)
        return
      }
      if (failed) {
        say(failed instanceof Error ? failed.message : String(failed))
        await refresh()
      }
    },
    [dataset, refresh, say, setList]
  )

  const isRemote = () => storageRef.current === 'remote'

  const uploadLocal = useCallback(async () => {
    const local = loadExceptions(dataset).items.filter(e => e.dataset === dataset)
    if (!local.length || storageRef.current !== 'remote') return
    inFlight.current += 1
    try {
      let done = 0
      const problems: string[] = []
      for (let i = 0; i < local.length; i += 500) {
        const result = await remote.insert(dataset, 'import', local.slice(i, i + 500))
        done += result.inserted.length
        for (const s of result.skipped) if (s.reason !== '이미 있는 ID') problems.push(`${s.id ?? '?'}: ${s.reason}`)
        setList(list => upsert(list, result.items))
      }
      if (problems.length === 0) {
        saveExceptions(dataset, [])
        setLocalPending(0)
        say(`이 브라우저에만 있던 예외 ${done}건을 팀 공용 저장소로 올렸습니다.`)
      } else {
        say(`${done}건을 올렸고 ${problems.length}건은 받지 않았습니다. 사유: ${problems.slice(0, 3).join('; ')}. 브라우저 기록은 그대로 둡니다.`)
      }
    } catch (err) {
      say(err instanceof Error ? err.message : String(err))
    } finally {
      inFlight.current -= 1
    }
  }, [dataset, say, setList])

  return {
    exceptions: items,
    storage,
    loading,
    warning,
    notice,
    clearNotice: () => setNotice(undefined),
    localPending,
    uploadLocal,
    refresh: () => void refresh(),
    add: newItems =>
      isRemote()
        ? void commitRemote(
            list => [...list, ...newItems],
            async () => {
              const result = await remote.insert(dataset, 'create', newItems)
              // 서버가 시각을 새로 찍는다. 같은 ID 로 서버 레코드를 덮어쓴다
              return { saved: result.items }
            }
          )
        : commitLocal(list => [...list, ...newItems]),
    remove: ids =>
      isRemote()
        ? void commitRemote(
            list => list.filter(exc => !ids.includes(exc.id)),
            async () => {
              for (const id of ids) await remote.undo(dataset, id)
              return { removed: ids }
            }
          )
        : commitLocal(list => list.filter(exc => !ids.includes(exc.id))),
    revoke: (ids, actor, note) =>
      isRemote()
        ? void commitRemote(
            list => revoked(list, ids, actor, note),
            async () => {
              const saved: ThreatException[] = []
              for (const id of ids) saved.push((await remote.revoke(dataset, id, actor, note)).item)
              return { saved }
            }
          )
        : commitLocal(list => revoked(list, ids, actor, note)),
    extend: (id, expiresAt, actor) => {
      const seen = itemsRef.current.find(e => e.id === id)?.updatedAt
      return isRemote()
        ? void commitRemote(
            list => extended(list, id, expiresAt, actor),
            async () => ({ saved: [(await remote.extend(dataset, id, expiresAt, actor, seen)).item] })
          )
        : commitLocal(list => extended(list, id, expiresAt, actor))
    },
    edit: (id, patch, actor) => {
      const seen = itemsRef.current.find(e => e.id === id)?.updatedAt
      return isRemote()
        ? void commitRemote(
            list => edited(list, id, patch, actor),
            async () => ({ saved: [(await remote.edit(dataset, id, patch, actor, seen)).item] })
          )
        : commitLocal(list => edited(list, id, patch, actor))
    },
    reapply: (id, patch, actor) => {
      const old = itemsRef.current.find(exc => exc.id === id)
      if (!old) return undefined
      const at = stamp()
      const fresh: ThreatException = {
        ...old,
        id: newExceptionId(),
        reason: patch.reason.trim(),
        actor,
        /* 다시 적용은 새 결정이라 승인자도 다시 받는다 */
        approver: patch.approver?.trim() || undefined,
        decisionId: newDecisionId(),
        createdAt: at,
        expiresAt: patch.expiresAt,
        snapshot: patch.snapshot ?? old.snapshot,
        revokedAt: undefined,
        revokedBy: undefined,
        revokeReason: undefined,
        updatedAt: undefined,
        history: [{ at, action: 'created', actor, note: `${old.id} 다시 적용` }],
      }
      const optimistic = (list: ThreatException[]) => [
        ...list.map(exc =>
          exc.id === id ? { ...exc, history: [...exc.history, { at, action: 'reapplied' as const, actor, note: `${fresh.id} 로 다시 적용` }] } : exc
        ),
        fresh,
      ]
      if (isRemote()) {
        void commitRemote(optimistic, async () => {
          const result = await remote.reapply(dataset, id, fresh, actor)
          return { saved: [result.item, result.old] }
        })
      } else commitLocal(optimistic)
      return fresh
    },
    importItems: newItems => {
      if (!isRemote()) return commitLocal(list => [...list, ...newItems])
      // 화면에 먼저 붙이는 것은 목록에 없던 것만. 서버가 받지 않은 것은 그 붙인 것만 뗀다 (서버에 이미 있는 같은 ID 는 건드리지 않는다)
      const known = new Set(itemsRef.current.map(e => e.id))
      const added = newItems.filter(e => !known.has(e.id))
      void commitRemote(
        list => [...list, ...added],
        async () => {
          const saved: ThreatException[] = []
          const inserted = new Set<string>()
          let skipped = 0
          for (let i = 0; i < newItems.length; i += 500) {
            const result = await remote.insert(dataset, 'import', newItems.slice(i, i + 500))
            saved.push(...result.items)
            result.inserted.forEach(id => inserted.add(id))
            skipped += result.skipped.length
          }
          if (skipped) say(`서버가 ${skipped}건을 받지 않았습니다. 이미 있는 ID 이거나 형식 오류입니다.`)
          return { saved, removed: added.map(e => e.id).filter(id => !inserted.has(id)) }
        }
      )
    },
  }
}
