import { useSyncExternalStore } from 'react'

/**
 * 커서를 올린 칸(또는 선) 하나를 담는 작은 저장소.
 *
 * 그래프(UnifiedFullGraph)는 칸과 선 수백 개를 한 컴포넌트에서 그린다. 커서 자리를 그 컴포넌트의 상태로 두면
 * 커서가 칸을 드나들 때마다 전부 다시 그려, 한 번에 50~110ms 걸렸다(09-28 측정, 칸 60개에 차례로 올림).
 * 커서 자리는 여기에 두고, 그것을 쓰는 작은 조각('보는 중' 줄 · 멀리서 본 이름표 · Effective Access 선 강조)만
 * `useHovered` 로 구독해 다시 그린다.
 */
export interface HoverStore {
  get(): string | null
  set(id: string | null): void
  /** 지금 값이 id 일 때만 지운다 — 다른 칸으로 옮겨 간 뒤 늦게 온 mouseleave 가 새 값을 지우지 않게 */
  clear(id: string): void
  subscribe(listener: () => void): () => void
}

export function createHoverStore(): HoverStore {
  let current: string | null = null
  const listeners = new Set<() => void>()
  const set = (id: string | null) => {
    if (id === current) return
    current = id
    for (const listener of listeners) listener()
  }
  return {
    get: () => current,
    set,
    clear: id => {
      if (current === id) set(null)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function useHovered(store: HoverStore): string | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
