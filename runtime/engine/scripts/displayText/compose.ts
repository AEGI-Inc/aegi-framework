/**
 * 데이터셋 하나에 쓸 display_text 문서를 만든다. 검토된 정본 → AI 생성 캐시 순서로 채우고,
 * 둘 다 없는 것은 missing 에 남긴다(화면이 기계적 대체 문구를 쓴다).
 * 객체 종류 설명은 이 데이터셋에 나온 종류만 싣는다.
 * 문서 형식(대시보드 검사)이 배열을 요구해 remediations 는 빈 배열로 싣는다.
 */
import type { DisplayTextDocument, ProviderText, TypeText } from '../../src/model/displayText.ts'
import { DISPLAY_TEXT_FORMAT } from '../../src/model/displayText.ts'
import type { FixtureObject } from '../../src/model/object.ts'
import type { Cache, CacheEntry, Canonical } from './files.ts'

export const typeKey = (o: FixtureObject) => `${o.canonical.provider}:${String(o.canonical.object_type).toLowerCase()}`

/** 주제마다 가장 최근에 만든 캐시 항목 */
function latestBySubject(cache: Cache, kind: CacheEntry['kind']): Map<string, CacheEntry> {
  const out = new Map<string, CacheEntry>()
  for (const e of Object.values(cache)) {
    if (e.kind !== kind) continue
    const prev = out.get(e.subject)
    if (!prev || prev.generated_at < e.generated_at) out.set(e.subject, e)
  }
  return out
}

const mark = (e: CacheEntry) => ({ source: 'generated' as const, model: e.model, prompt_version: e.prompt_version, generated_at: e.generated_at })

export function composeDisplayText(objects: FixtureObject[], canonical: Canonical, cache: Cache = {}): DisplayTextDocument {
  const providerIds = [...new Set(objects.map(o => String(o.canonical.provider)))].sort()
  const typeKeys = [...new Set(objects.map(typeKey))].sort()
  const genProviders = latestBySubject(cache, 'provider')
  const genTypes = latestBySubject(cache, 'type')

  const providers: Record<string, ProviderText> = {}
  const missingProviders: string[] = []
  for (const p of providerIds) {
    const reviewed = canonical.providers[p]
    const gen = genProviders.get(p)
    if (reviewed?.role) providers[p] = { ...reviewed, source: 'reviewed' }
    else if (gen) providers[p] = { ...(gen.value as ProviderText), ...(reviewed?.name ? { name: reviewed.name } : {}), ...mark(gen) }
    else {
      if (reviewed?.name) providers[p] = { name: reviewed.name, source: 'reviewed' }
      missingProviders.push(p)
    }
  }

  const types: Record<string, TypeText> = {}
  const missingTypes: string[] = []
  for (const k of typeKeys) {
    const gen = genTypes.get(k)
    if (canonical.types[k]) types[k] = { meaning: canonical.types[k], source: 'reviewed' }
    else if (gen) types[k] = { meaning: (gen.value as TypeText).meaning, ...mark(gen) }
    else missingTypes.push(k)
  }

  return {
    format: DISPLAY_TEXT_FORMAT,
    providers,
    types,
    remediations: [],
    missing: { providers: missingProviders, types: missingTypes },
  }
}
