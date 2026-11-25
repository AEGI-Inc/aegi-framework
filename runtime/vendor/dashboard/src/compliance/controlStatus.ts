import ismsMapping from '../config-findings/ismsMapping.snapshot.json'
import type { StandardResults } from '../config-findings/standardResultsStore'
import rawCheckLinks from './checkLinks.snapshot.json'
import { type Match, findingMatches, matchRequirements, unique } from './complianceOverviewShared'
import type { Control, Requirement } from './frameworkModel'

export type ControlState = 'auto' | 'manual' | 'out'

export interface CheckLinksSnapshot {
  version: string
  source: { repo: string; commit: string; note: string }
  findings: Record<string, { saas: string; name: string }>
  items: Record<string, string[]>
}

export const DEDICATED: Record<string, string> = {
  'ISMS-P:2.10.2-03': '관리자 인증 보호',
  'ISMS-P:2.11.3-01': '관리자 권한 부여 경고 설정',
}

export const STATE_LABEL: Record<ControlState, string> = {
  auto: '자동 검사 가능',
  manual: '직접 확인 필요',
  out: '범위 밖',
}

const defaultCheckLinks = rawCheckLinks as unknown as CheckLinksSnapshot
const ismsFindingsByReq = new Map<string, string[]>()
for (const link of ismsMapping.links) {
  const list = ismsFindingsByReq.get(link.requirement) ?? []
  if (!list.includes(link.finding)) list.push(link.finding)
  ismsFindingsByReq.set(link.requirement, list)
}

export function linkedFindings(requirementKey: string, links: CheckLinksSnapshot = defaultCheckLinks): string[] {
  const fromCheckLinks = links.items[requirementKey] ?? []
  const fromIsms = requirementKey.startsWith('ISMS-P:')
    ? (ismsFindingsByReq.get(requirementKey.slice('ISMS-P:'.length)) ?? [])
    : []
  return [...new Set([...fromCheckLinks, ...fromIsms])].sort()
}

export function requirementMatches(
  results: StandardResults | undefined,
  req: Requirement,
  links: CheckLinksSnapshot = defaultCheckLinks,
): Match[] {
  if (!results || req.tier === 'exclude') return []
  const list: Match[] = []
  const includedFindings = new Set<string>()
  if (req.key.startsWith('ISMS-P:')) {
    const ismsMatches = matchRequirements(results, [req.id]).get(req.id) ?? []
    for (const m of ismsMatches) {
      list.push(m)
      includedFindings.add(m.f.id)
    }
  }
  const extraIds = (links.items[req.key] ?? []).filter(fid => !includedFindings.has(fid))
  if (extraIds.length > 0) {
    const wanted = new Set(extraIds)
    for (const f of results.findings) {
      if (!wanted.has(f.id)) continue
      list.push(...findingMatches(f))
    }
  }
  return unique(list)
}

export function requirementState(
  req: Requirement,
  inScope = true,
  links: CheckLinksSnapshot = defaultCheckLinks,
): ControlState {
  if (req.tier === 'exclude') return 'out'
  if (linkedFindings(req.key, links).length > 0 || Boolean(DEDICATED[req.key])) return 'auto'
  return inScope ? 'manual' : 'out'
}

export function controlState(control: Control, links: CheckLinksSnapshot = defaultCheckLinks): ControlState {
  // 제외 등급 확인사항은 상태에 넣지 않는다. 모두 제외면 범위 밖
  const reqs = control.requirements.filter(r => r.tier !== 'exclude')
  if (reqs.length === 0) return 'out'
  if (reqs.some(r => linkedFindings(r.key, links).length > 0 || Boolean(DEDICATED[r.key]))) return 'auto'
  return control.inScope ? 'manual' : 'out'
}
