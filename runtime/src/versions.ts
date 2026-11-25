import fs from 'node:fs'
import path from 'node:path'
import { VENDOR } from './paths.ts'

export interface Versions { synced_at: string; sources: Record<string, { repo: string; ref: string; commit: string }> }

export function readVersions(): Versions | null {
  const file = path.join(VENDOR, 'VERSIONS.json')
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}
