// 위협 판정의 접근 수준 계산. [읽기, 쓰기(2)/관리(3)] 한 쌍으로 센다(judge.ts, derived.ts)
import type { Level } from './judge'

export type Acc = readonly [number, number]
export const Z: Acc = [0, 0]
export const L: Record<Level, Acc> = { read: [1, 0], write: [1, 2], admin: [1, 3], post: [0, 2] }
export const mx = (a: Acc, b: Acc): Acc => [Math.max(a[0], b[0]), Math.max(a[1], b[1])]
export const mn = (a: Acc, b: Acc): Acc => [Math.min(a[0], b[0]), Math.min(a[1], b[1])]
export const eq = (a: Acc, b: Acc) => a[0] === b[0] && a[1] === b[1]
export type AccMap = Map<string, Acc>
export const get = (m: AccMap | undefined, k: string): Acc => m?.get(k) ?? Z
