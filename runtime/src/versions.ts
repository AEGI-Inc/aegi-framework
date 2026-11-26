import fs from 'node:fs'
import path from 'node:path'
import { VENDOR } from './paths.ts'

/** updates: sources 의 커밋 뒤에 원본 저장소에서 골라 얹은 변경(날짜, 내용) */
export interface Versions { synced_at: string; sources: Record<string, { repo: string; ref: string; commit: string }>; updates?: Array<{ date: string; what: string }> }

export function readVersions(): Versions | null {
  const file = path.join(VENDOR, 'VERSIONS.json')
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}
