import type { FixtureObject } from '../model/object'
import type { SemanticNode } from './types'
import { measureLabel } from './labelFit'
import { getPrimaryIdentifierValue } from '../utils/identifier'

/*
 * L4(개별 항목) 칸의 이름과 폭.
 *
 * 칸에는 그 칸을 옆 칸과 가를 만큼만 적는다. 「Slack User Normal 5」는 Slack 묶음 안에서
 * 「User 5」면 충분하다. 전체 이름은 커서 이름표와 조사 패널에 그대로 있다.
 * 칸 폭은 그 이름이 가장 큰 글자(OBJECT_LABEL_SIZE)로도 다 들어가게 칸마다 잡는다.
 * 배치(containment)와 그리기가 같은 값을 써야 칸이 겹치지 않는다.
 */

export const OBJECT_LABEL_SIZE = 23
/** 왼쪽 그림 칸(칸 높이만 한 정사각형) · 이름 앞뒤 여백 · Finding 수 칸(월드). */
export const OBJECT_ICON_CELL = 48
export const OBJECT_LABEL_GAP = 10
export const OBJECT_PAD_X = 11
export const OBJECT_BADGE_W = 28

/** Finding 수 칸 폭(월드). 두 자리까지는 OBJECT_BADGE_W이고, 세 자리부터 자릿수만큼 넓힌다.
 *  전에는 28로 고정이라 100건부터 수가 빨간 칸 밖으로 나갔다. 17px 굵은 숫자 한 자는 약 11이고 양옆에 5씩 둔다. */
export function findingBadgeWidth(count: number): number {
  return count < 100 ? OBJECT_BADGE_W : Math.ceil(String(count).length * 11 + 10)
}
/** 칸 폭의 아래 · 위 한계. 위 한계를 넘는 이름만 가운데를 줄인다. */
export const OBJECT_CHIP_MIN_WIDTH = 150
export const OBJECT_CHIP_MAX_WIDTH = 480

/* 칸이 이미 SaaS 묶음 안에 있어 이름 맨 앞의 SaaS 이름은 아무것도 가르지 않는다. */
const PROVIDER_WORDS = new Set(['slack', 'github', 'gh', 'okta', 'google', 'gws', 'atlassian'])
/* 예시 데이터의 평범한 항목에 붙는 말. 이상 없는 항목이라는 뜻일 뿐 칸끼리 가르지 않는다. */
const FILLER_WORDS = new Set(['normal'])

const EMAIL = /^([^\s@]+)@[^\s@]+\.[a-z]{2,}$/i

/** L4 칸의 원래 이름(projectNodes 와 격자 배치가 같이 쓴다). */
export function objectDisplayName(obj: FixtureObject): string {
  return String(obj.fixture_meta?.display_name ??
    obj.canonical.properties?.name ??
    obj.canonical.properties?.login ??
    getPrimaryIdentifierValue(obj))
}

/** 칸 하나의 짧은 이름. 줄일 것이 없거나 다 지워지면 원래 이름. */
export function shortObjectName(label: string): string {
  const email = EMAIL.exec(label)
  const body = email ? email[1] : label
  // 낱말과 사이 기호를 번갈아 둔다: [낱말, 기호, 낱말, …]
  const parts = body.split(/([\s\-_.]+)/)
  const words: Array<{ word: string; before: string }> = []
  for (let i = 0; i < parts.length; i += 2) words.push({ word: parts[i], before: i > 0 ? parts[i - 1] : '' })
  const kept = words.filter((entry, index) => {
    const lower = entry.word.toLowerCase()
    if (FILLER_WORDS.has(lower)) return false
    if (index === 0 && PROVIDER_WORDS.has(lower)) return false
    return true
  })
  if (!kept.length || kept.every(entry => /^\d*$/.test(entry.word))) return body
  const text = kept.map((entry, index) => (index === 0 ? '' : entry.before) + entry.word).join('').trim()
  return text || body
}

/**
 * 보이는 칸들의 짧은 이름. 같은 SaaS 안에서 서로 다른 이름이 같은 짧은 이름이 되면
 * 그 칸들은 원래 이름(메일은 @ 앞)을 쓴다.
 */
export function objectShortNames(nodes: ReadonlyArray<Pick<SemanticNode, 'id' | 'label' | 'provider'>>): Map<string, string> {
  const result = new Map<string, string>()
  const owners = new Map<string, Set<string>>()
  for (const node of nodes) {
    const short = shortObjectName(node.label)
    result.set(node.id, short)
    const key = `${node.provider}|${short}`
    owners.set(key, (owners.get(key) ?? new Set()).add(node.label))
  }
  for (const node of nodes) {
    if ((owners.get(`${node.provider}|${result.get(node.id)}`)?.size ?? 0) > 1) result.set(node.id, node.label)
  }
  return result
}

/** 이름 · Finding 수 칸을 담는 칸 폭. 이름은 700 이 아닌 600 굵기로 재므로 조금 넉넉히 둔다. */
export function objectChipWidth(name: string, findingCount: number): number {
  const text = Math.ceil(measureLabel(name, OBJECT_LABEL_SIZE) * 1.04)
  const width = OBJECT_ICON_CELL + OBJECT_LABEL_GAP + text + OBJECT_PAD_X + (findingCount > 0 ? findingBadgeWidth(findingCount) + 6 : 0)
  return Math.min(OBJECT_CHIP_MAX_WIDTH, Math.max(OBJECT_CHIP_MIN_WIDTH, width))
}
