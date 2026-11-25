import {
  AppWindow,
  Bot,
  Building2,
  FileText,
  Fingerprint,
  FolderGit2,
  GitCommitHorizontal,
  GitPullRequest,
  Hash,
  KeyRound,
  MessageSquare,
  Plug,
  ShieldCheck,
  SquareStack,
  UserCheck,
  UserRound,
  Users,
  Webhook,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { InterfaceType } from '../model/object'
import type { SecurityScopeKind } from './types'

/* =========================================================================
   칸 하나가 무엇인지 말하는 그림

   상세 단계에서는 SaaS가 사분면으로 이미 갈라져 있다. 그래서 칸마다
   SaaS 색을 한 번 더 칠할 이유가 없고(전에는 왼쪽에 색 띠를 뒀다),
   정작 알아야 하는 "이게 사람인지, 저장소인지, 토큰인지"는 아무 데도
   적혀 있지 않았다. 색 띠를 종류 그림으로 바꾼다.

   SaaS는 묶음 머리글의 로고가 말한다.
   ========================================================================= */

const SCOPE_GLYPHS: Record<SecurityScopeKind, LucideIcon> = {
  Group: Users,
  Team: Users,
  'User Group': Users,
  Identity: UserRound,
  Repository: FolderGit2,
  Channel: Hash,
  Workspace: Building2,
  'Tenant / Administration': Building2,
  'Tenant Policy': ShieldCheck,
  'Access Role': KeyRound,
  Integration: Plug,
  'File / Resource': FileText,
  'Automation / Endpoint': Zap,
}

/* object_type은 SaaS마다 표기가 제각각이라 소문자로 맞춰 찾는다. */
const OBJECT_TYPE_GLYPHS: Record<string, LucideIcon> = {
  user: UserRound,
  'user account': UserRound,
  member: UserCheck,
  userfactor: Fingerprint,

  org: Building2,
  organization: Building2,
  customer: Building2,
  workspace: Building2,
  enterprise: Building2,

  group: Users,
  usergroup: Users,
  team: Users,

  repository: FolderGit2,
  'pull request': GitPullRequest,
  commit: GitCommitHorizontal,
  'repository ruleset': ShieldCheck,
  'organization custom repository role': KeyRound,
  'organization programmatic access grant': KeyRound,

  conversation: Hash,
  channel: Hash,
  message: MessageSquare,
  'conversation membership assignment': UserCheck,

  file: FileText,
  form: FileText,
  project: SquareStack,
  permission: ShieldCheck,
  iamrole: ShieldCheck,

  application: AppWindow,
  oauth2client: AppWindow,
  'slack app installation registration': AppWindow,
  bot: Bot,
  'bot-token': KeyRound,
  oauth2refreshtoken: KeyRound,

  'incoming-webhook': Webhook,
  'slash command request endpoint': Webhook,
  webhook: Webhook,
  workflow: Workflow,
}

/* 표에 없는 종류는 정규 모델이 붙여 둔 인터페이스로 떨어진다. */
const INTERFACE_GLYPHS: Partial<Record<InterfaceType, LucideIcon>> = {
  Tenant: Building2,
  Principal: UserRound,
  Resource: FileText,
  Policy: ShieldCheck,
  Integration: Plug,
  Credential: KeyRound,
  Endpoint: Webhook,
  Assignment: UserCheck,
  Automation: Zap,
}

export function scopeGlyph(kind?: SecurityScopeKind): LucideIcon {
  return (kind && SCOPE_GLYPHS[kind]) || SquareStack
}

export function objectGlyph(objectType?: string, interfaces?: InterfaceType[]): LucideIcon {
  const byType = objectType ? OBJECT_TYPE_GLYPHS[objectType.toLowerCase()] : undefined
  if (byType) return byType
  for (const iface of interfaces ?? []) {
    const byInterface = INTERFACE_GLYPHS[iface]
    if (byInterface) return byInterface
  }
  return SquareStack
}

/**
 * 보안 범위 이름에서 종류 접두사를 뗀다.
 *
 * hierarchy는 이름을 "Team · Engineering Core Devs"처럼 만든다. 칸에
 * 그대로 쓰면 종류를 두 번(굵은 줄 앞머리와 아랫줄) 적는 꼴이라,
 * 정작 이 범위를 가리키는 이름이 "Team · Engine…"으로 잘려 나갔다.
 */
export function splitScopeLabel(
  label: string,
  kind?: SecurityScopeKind
): { name: string; kindOnly: boolean } {
  if (!kind) return { name: label, kindOnly: false }
  if (label === kind) return { name: kind, kindOnly: true }
  const prefix = `${kind}, `
  if (label.startsWith(prefix)) return { name: label.slice(prefix.length), kindOnly: false }
  return { name: label, kindOnly: false }
}
