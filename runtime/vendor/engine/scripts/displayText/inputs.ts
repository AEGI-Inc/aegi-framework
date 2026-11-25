/**
 * AI 에 보내는 입력. tenant 고유값(계정 이름, 이메일, tenant 키, 객체 속성값)은 넣지 않는다.
 * 넣는 것은 SaaS 이름, 객체 종류, 인터페이스, 수집 Profile 의 필드와 참조 이름(벤더 문서 출처), 관계 종류다.
 */
import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'
import type { GraphStoreV2 } from '../../src/model/graph.ts'
import type { FixtureObject } from '../../src/model/object.ts'
import { ROOT } from './files.ts'
import { typeKey } from './compose.ts'
import { researchProvidersOf } from '../collect/profile-binding/runner/provider-map.mjs'

const PROFILE_DIR = path.join(ROOT, 'scripts', 'collect', 'profile-binding', 'profiles')
const MAX_NAMES = 40

export interface ProfileFacts { service: string | null; fields: string[]; references: string[] }

let profileIndex: Map<string, ProfileFacts> | undefined

/** `profile provider:object_type`(소문자) → 필드, 참조 이름. 처음 부를 때 한 번 읽는다 */
export function profileFacts(dir = PROFILE_DIR): Map<string, ProfileFacts> {
  if (profileIndex && dir === PROFILE_DIR) return profileIndex
  const index = new Map<string, ProfileFacts>()
  if (fs.existsSync(dir)) {
    for (const sub of fs.readdirSync(dir)) {
      const subDir = path.join(dir, sub)
      if (!fs.statSync(subDir).isDirectory()) continue
      for (const f of fs.readdirSync(subDir).filter(f => f.endsWith('.yaml'))) {
        const doc = parse(fs.readFileSync(path.join(subDir, f), 'utf8')) as { provider?: string; service?: string | null; object_type?: string; fields?: Record<string, unknown>; references?: Record<string, unknown> }
        if (!doc?.provider || !doc.object_type) continue
        const key = `${doc.provider}:${doc.object_type.toLowerCase()}`
        if (!index.has(key)) index.set(key, { service: doc.service ?? null, fields: Object.keys(doc.fields ?? {}).slice(0, MAX_NAMES), references: Object.keys(doc.references ?? {}).slice(0, MAX_NAMES) })
      }
    }
  }
  if (dir === PROFILE_DIR) profileIndex = index
  return index
}

export interface TypeInput {
  saas: string
  object_type: string
  interfaces: string[]
  service: string | null
  fields: string[]
  references: string[]
  relations: string[]
}

export function typeInput(key: string, saas: string, objects: FixtureObject[], graph: GraphStoreV2, profiles = profileFacts()): TypeInput {
  const [provider, type] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  const same = objects.filter(o => typeKey(o) === key)
  const sameKeys = new Set(same.map(o => o.fixture_key))
  const profile = researchProvidersOf(provider).map(p => profiles.get(`${p}:${type}`)).find(Boolean)
  const relations = new Set<string>()
  for (const r of graph.relationsByKey.values()) {
    if (sameKeys.has(r.sourceKey)) relations.add(`out:${r.relationType}`)
    if (sameKeys.has(r.targetKey)) relations.add(`in:${r.relationType}`)
  }
  return {
    saas,
    object_type: String(same[0]?.canonical.object_type ?? type),
    interfaces: [...new Set(same.flatMap(o => o.canonical.interfaces))].sort(),
    service: profile?.service ?? null,
    fields: profile?.fields ?? [],
    references: profile?.references ?? [],
    relations: [...relations].sort(),
  }
}

export interface ProviderInput { saas: string; provider: string; object_types: string[] }

export function providerInput(provider: string, saas: string, objects: FixtureObject[]): ProviderInput {
  return { saas, provider, object_types: [...new Set(objects.filter(o => o.canonical.provider === provider).map(o => String(o.canonical.object_type)))].sort().slice(0, MAX_NAMES) }
}
