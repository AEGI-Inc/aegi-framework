/**
 * 아무도 쓰지 않는 플랫폼 기본 객체 (판단표 G4-Q04, Q05. aegi-knowledge docs/decisions/OBJECT_MODEL_G4_2026-10-21.md).
 *
 * 정규화가 judged.origin 과 judged.assignment_count 를 둔다. origin 이 platform_default 이고 assignment_count 가 0 이면
 * 화면 집계와 기본 보기에서 뺀다. 객체를 지우지는 않으므로 누가 할당되면 다음 수집부터 바로 보인다.
 * 그래프 도구 막대의 「기본 객체」로 다시 켤 수 있다. 데이터는 처음 불러올 때 한 번 거르므로 켜고 끄면 다시 불러온다.
 */
import type { FixtureObject } from './object'
import type { FixtureRelation } from './relation'
import type { IdentityLink } from './link'

const STORAGE_KEY = 'aegi.showPlatformDefaults'

export function isUnusedPlatformDefault(o: FixtureObject): boolean {
  const j = o.canonical.judged as Record<string, unknown> | undefined
  return j?.origin === 'platform_default' && j?.assignment_count === 0
}

export function showPlatformDefaults(): boolean {
  try { return window.localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

export function setShowPlatformDefaults(show: boolean): void {
  try { window.localStorage.setItem(STORAGE_KEY, show ? '1' : '0') } catch { /* 저장할 수 없으면 이번 화면에서만 바뀐다 */ }
}

/** 기본 보기에서 뺄 객체와 그 객체에 닿는 관계, 링크 구성원을 거른다 */
export function withoutUnusedPlatformDefaults(objects: FixtureObject[], relations: FixtureRelation[], links: IdentityLink[]) {
  const hidden = new Set(objects.filter(isUnusedPlatformDefault).map(o => o.fixture_key))
  if (!hidden.size) return { objects, relations, links, hidden: 0 }
  const touches = (r: FixtureRelation) => {
    const ref = r.canonical.references
    return [ref.source?.value, ref.target?.value, ref.role?.value].some(v => v !== undefined && hidden.has(String(v)))
  }
  return {
    objects: objects.filter(o => !hidden.has(o.fixture_key)),
    relations: relations.filter(r => !touches(r)),
    links: links.map(l => ({ ...l, set: l.set.filter(m => !hidden.has(m.object_key)) })).filter(l => l.set.length > 1),
    hidden: hidden.size,
  }
}
