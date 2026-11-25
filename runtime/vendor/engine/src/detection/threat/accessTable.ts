// 게시 접근 표: 대상마다 사람별 직접 권한과 파생 접근 (2026-11-18 결정, aegi-adapter-engine#462)
//
// 대시보드 Explorer(경로 빌더)와 AI access 도구가 읽는다. 대시보드는 접근을 직접 계산하지 않는다(knowledge 규칙 R-judge-in-engine).
// 판정 값(JudgeResult.access)을 그대로 옮긴다. 직접 권한은 권한 간선이 닿는 모든 대상, 파생 접근은 판정의 파생 표 전부
import type { Acc } from './access'
import type { AccessTable, AccessTableRow } from './contract'
import type { JudgedAccess } from './judge'

const some = (a: Acc) => a[0] > 0 || a[1] > 0
const pair = (a: Acc): [number, number] => [a[0], a[1]]
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** accountsOf: 판정의 같은 사람 묶음(JudgeResult.accountsOf). 계정이 둘 이상인 사람만 accounts 칸에 싣는다 */
export function accessTable(rows: Iterable<JudgedAccess>, accountsOf?: (p: string) => readonly string[]): AccessTable {
  const by = new Map<string, AccessTableRow[]>()
  const accounts = new Map<string, string[]>()
  for (const a of rows) {
    if (accountsOf && !accounts.has(a.person)) {
      const acc = accountsOf(a.person)
      if (acc.length > 1) accounts.set(a.person, [...acc].sort(cmp))
    }
    const row: AccessTableRow = { person: a.person }
    if (some(a.direct)) row.direct = pair(a.direct)
    if (some(a.directSure)) row.directSure = pair(a.directSure)
    if (some(a.derived)) row.derived = pair(a.derived)
    if (some(a.derivedSure)) row.derivedSure = pair(a.derivedSure)
    if (Object.keys(a.points).length) row.points = { ...a.points }
    if (Object.keys(a.gained).length) row.gained = Object.fromEntries(Object.entries(a.gained).map(([l, g]) => [l, { ...g, ...(g.reasons ? { reasons: [...g.reasons] } : {}) }]))
    const list = by.get(a.target)
    if (list) list.push(row)
    else by.set(a.target, [row])
  }
  const targets: Record<string, AccessTableRow[]> = {}
  for (const t of [...by.keys()].sort(cmp)) targets[t] = by.get(t)!.sort((x, y) => cmp(x.person, y.person))
  if (!accounts.size) return { version: 1, targets }
  return { version: 1, targets, accounts: Object.fromEntries([...accounts].sort((x, y) => cmp(x[0], y[0]))) }
}
