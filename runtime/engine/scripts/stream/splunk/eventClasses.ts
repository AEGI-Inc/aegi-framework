/**
 * 이벤트 판정 표(category, outcome)와 AI 검색 공통 필드의 정본 (aegi-knowledge docs/architecture/ai-log-investigation.md D1).
 * mapper 는 이 표로 정규 이벤트의 category, outcome 을 정하고, AI 검색의 기본 검색(query/spl.ts)은 같은 표를
 * SPL `case()` 식으로 바꿔 aegi_category, aegi_outcome 을 만든다. 두 경로의 판정이 한 표에서 나온다.
 */
import type { EventCategory } from './types'

export const SF_TARGET_PERMISSION_SET_PATTERN = '^\\s*(?:변경된 )?권한 집합 (?<aegi_target_ps>.+?)(?: 만들어짐| 변경)?: '
export const SF_TARGET_FLOW_PATTERN = '고유 이름(?:이)? "(?<aegi_target_flow>(?:(?!").)+)"'
export const SF_TARGET_USER_PATTERN = '(?<!(?!_)\\w)(?<aegi_target_user>005(?:(?!_)\\w){12}(?:(?:(?!_)\\w){3})?)(?!(?!_)\\w)'
export const SF_ACTION_PERM_SET_PATTERN = '^PermSet(?!Group|License)|^SetupEntityAccessAudit_PermissionSet_'
export const SF_ACTION_FLOW_PATTERN = 'interactiondef'

export const EVENT_CATEGORIES: readonly EventCategory[] = ['auth', 'admin', 'membership', 'policy', 'token', 'data', 'mail', 'other']
export const MATCH_OUTCOMES = ['success', 'failure'] as const
/** 범주의 뜻. schema 로 나가 AI 프롬프트의 범주 설명이 된다(dashboard 는 범주 설명을 따로 쓰지 않는다) */
export const CATEGORY_DESCRIPTIONS: Record<EventCategory, string> = {
  auth: 'sign-in, sessions, SSO and MFA',
  admin: 'administrative changes: account lifecycle, admin console, org, project and repository settings, some role changes',
  membership: 'group, team, role and permission-set membership changes',
  policy: 'security, sharing and access policy settings',
  token: 'tokens, API keys, OAuth and app installs or grants',
  data: 'file, drive, git and issue data access, downloads and exports',
  mail: 'mail forwarding settings',
  other: 'not classified by the table',
}
export type MatchOutcome = typeof MATCH_OUTCOMES[number]

/** 입력 값 하나에 대한 조건. regex 는 JS 와 Splunk(PCRE)에서 같은 뜻인 식만 쓴다 */
interface Rule { input: string; op: 'eq' | 'prefix' | 'includes' | 'regex'; value: string; ignoreCase?: boolean }
/** when 의 조건이 모두 맞으면 then. 표는 위에서부터 처음 맞는 줄을 쓴다 */
interface Branch<T> { when: Rule[]; then: T }

/** AI 검색이 모든 소스에 같은 이름으로 만드는 필드. null 은 그 소스가 기록하지 않는 필드다 */
export const COMMON_FIELDS = ['aegi_event_id', 'aegi_event_type', 'aegi_outcome_reason', 'aegi_actor_id', 'aegi_actor_login', 'aegi_target_type', 'aegi_target_id', 'aegi_target_name', 'aegi_client_ip'] as const
export type CommonField = typeof COMMON_FIELDS[number]

/** 대상 배열: list 는 원소(JSON) 목록을 내는 SPL 식, type, id, name 은 원소 하나(aegi_t)에서 값을 꺼내는 식 */
interface Targets { list: string; type: string; id: string; name: string }

interface Shape {
  /** 레코드 하나에 이벤트가 여러 개 든 배열 경로. 이 배열을 펼쳐 자식 하나를 이벤트 하나로 센다 */
  children?: string
  /** 판정 전에 만드는 보조 필드(eval 한 줄 또는 파이프 목록) */
  prelude?: string | string[]
  /** 판정 입력. JS 는 mapper 가 같은 이름으로 넘긴다 */
  inputs: Record<string, string>
  category: Branch<EventCategory>[]
  categoryDefault: EventCategory
  outcome: Branch<MatchOutcome>[] | 'not_recorded'
  fields: Record<Exclude<CommonField, 'aegi_target_type' | 'aegi_target_id' | 'aegi_target_name'>, string | null>
  targets: Targets | null
  auxFields?: readonly string[]
}

const r = (input: string, op: Rule['op'], value: string, ignoreCase?: boolean): Rule => ({ input, op, value, ...(ignoreCase ? { ignoreCase } : {}) })
const any = <T>(then: T, ...rules: Rule[]): Branch<T>[] => rules.map(rule => ({ when: [rule], then }))

/** Jira, Confluence, Guard 가 같이 쓰는 표. 입력 text 는 소문자로 바꾼 「category summary」(Guard 는 「 action」) */
const atlassianCategory: Branch<EventCategory>[] = [
  ...any<EventCategory>('auth', r('text', 'regex', 'auth|login|logout|session')),
  // 옛 식 api[_\s]?key 와 같다. multisearch 의 하위 검색 괄호와 헷갈리지 않게 [ ] 를 쓰지 않는다
  ...any<EventCategory>('token', r('text', 'regex', 'token|api(_|\\s)?key|oauth')),
  ...any<EventCategory>('membership', r('text', 'regex', '그룹|user added to group|user removed from group|membership|사용자 관리|user created|user deleted')),
  ...any<EventCategory>('policy', r('text', 'regex', '권한|permission|security|보안|scheme')),
  ...any<EventCategory>('admin', r('text', 'regex', '프로젝트|project|board|워크플로|workflow|화면|screen|필드|field|이슈 유형|issue type|role|역할')),
  ...any<EventCategory>('data', r('text', 'regex', '이슈|issue|export|download|data')),
]
const atlassianText = `lower(coalesce('category',"")." ".coalesce('summary',""))`

/**
 * GWS 파라미터(name, value 쌍) 가운데 대상으로 보는 이름 → 종류. mapper 의 GWS_TARGET_PARAMS 와 같고, 토큰 앱을 더한다.
 * 토큰 이벤트에는 client_id 와 app_name 이 함께 있어 둘 다 넣으면 앱 하나를 두 번 센다. 사람이 읽는 app_name 만 쓴다
 */
const GWS_TARGET_KIND: Array<[string[], string]> = [
  [['USER_EMAIL', 'affected_email_address', 'target_user', 'user_email'], 'User'],
  [['GROUP_EMAIL', 'group_email'], 'Group'],
  [['doc_id'], 'File'],
  [['email_forwarding_destination_address'], 'ExternalAddress'],
  [['app_name'], 'Application'],
]
const gwsTargetKind = (field: string) => `case(${GWS_TARGET_KIND.map(([names, kind]) => `in(spath(${field},"name"),${names.map(n => `"${n}"`).join(',')}),"${kind}"`).join(',')})`

export const SHAPES: Record<string, Shape> = {
  'okta:im2:log': {
    inputs: { t: `coalesce('eventType',"")`, result: `upper(coalesce('outcome.result',""))` },
    category: [
      ...any<EventCategory>('auth', r('t', 'prefix', 'user.authentication'), r('t', 'prefix', 'user.session'), r('t', 'prefix', 'policy.evaluate')),
      ...any<EventCategory>('membership', r('t', 'includes', 'membership')),
      ...any<EventCategory>('policy', r('t', 'prefix', 'policy.'), r('t', 'prefix', 'group.rule')),
      ...any<EventCategory>('token', r('t', 'prefix', 'app.oauth2')),
      ...any<EventCategory>('admin', r('t', 'prefix', 'user.account'), r('t', 'prefix', 'group.lifecycle'), r('t', 'prefix', 'user.lifecycle')),
    ],
    categoryDefault: 'other',
    outcome: [...any<MatchOutcome>('success', r('result', 'eq', 'SUCCESS'), r('result', 'eq', 'ALLOW')), ...any<MatchOutcome>('failure', r('result', 'eq', 'FAILURE'), r('result', 'eq', 'DENY'))],
    fields: { aegi_event_id: `"okta:".'uuid'`, aegi_event_type: `'eventType'`, aegi_outcome_reason: `'outcome.reason'`, aegi_actor_id: `'actor.id'`, aegi_actor_login: `'actor.alternateId'`, aegi_client_ip: `'client.ipAddress'` },
    targets: { list: `spath(_raw,"target{}")`, type: `spath(aegi_t,"type")`, id: `spath(aegi_t,"id")`, name: `spath(aegi_t,"alternateId")` },
  },
  'gws:reports:activity': {
    children: 'events{}',
    inputs: { app: `coalesce('id.applicationName',"")`, name: `coalesce(spath(aegi_child,"name"),"")` },
    category: [
      { when: [r('app', 'eq', 'admin'), r('name', 'regex', '^ALERT_CENTER_')], then: 'other' },
      { when: [r('app', 'eq', 'admin'), r('name', 'regex', '^SECURITY_INVESTIGATION_')], then: 'other' },
      ...any<EventCategory>('mail', r('name', 'includes', 'forwarding')),
      ...any<EventCategory>('auth', r('app', 'eq', 'login')),
      ...any<EventCategory>('token', r('app', 'eq', 'token')),
      ...any<EventCategory>('data', r('app', 'eq', 'drive')),
      ...any<EventCategory>('membership', r('app', 'eq', 'groups')),
      ...any<EventCategory>('admin', r('app', 'eq', 'admin')),
    ],
    categoryDefault: 'other',
    outcome: [
      { when: [r('app', 'eq', 'login'), r('name', 'eq', 'login_failure')], then: 'failure' },
      { when: [r('app', 'eq', 'login'), r('name', 'eq', 'login_success')], then: 'success' },
      { when: [r('app', 'eq', 'login'), r('name', 'prefix', 'suspicious_')], then: 'failure' },
    ],
    // 파라미터는 name, value 쌍의 배열이다. aegi_p 에 원소(JSON)를 두고 이름으로 값을 고른다
    prelude: `eval aegi_p=spath(aegi_child,"parameters{}")`,
    fields: { aegi_event_id: `"gws:".'id.applicationName'.":".'id.time'.":".'id.uniqueQualifier'.":".aegi_child_index`,
      aegi_event_type: `'id.applicationName'.":".spath(aegi_child,"name")`,
      aegi_outcome_reason: `mvindex(mvmap(aegi_p,if(spath(aegi_p,"name")=="login_failure_type",spath(aegi_p,"value"),null())),0)`,
      aegi_actor_id: `'actor.profileId'`, aegi_actor_login: `'actor.email'`, aegi_client_ip: `'ipAddress'`,
    },
    targets: { list: `mvmap(aegi_p,if(isnotnull(${gwsTargetKind('aegi_p')}),aegi_p,null()))`, type: gwsTargetKind('aegi_t'), id: `spath(aegi_t,"value")`, name: `spath(aegi_t,"value")` },
  },
  'github:cloud:audit': {
    inputs: { action: `coalesce('action',"")` },
    category: [
      ...any<EventCategory>('auth', r('action', 'prefix', 'org.sso_response'), r('action', 'includes', 'two_factor')),
      ...any<EventCategory>('token', r('action', 'regex', 'personal_access_token|programmatic_access|oauth_|integration_installation|deploy_key|org_credential')),
      ...any<EventCategory>('membership', r('action', 'regex', 'member|collaborator|invit')),
      ...any<EventCategory>('policy', r('action', 'regex', 'protected_branch|repository_ruleset|default_repository_permission|members_can|policy|ip_allow_list|security_configuration')),
      ...any<EventCategory>('data', r('action', 'prefix', 'git.'), r('action', 'regex', 'download_zip')),
      ...any<EventCategory>('admin', r('action', 'regex', '^(org|repo|team|hook|business|enterprise|environment|actions|workflows)\\.')),
    ],
    categoryDefault: 'other',
    outcome: 'not_recorded',
    fields: { aegi_event_id: `"github:".spath(_raw,"_document_id")`, aegi_event_type: `'action'`, aegi_outcome_reason: null, aegi_actor_id: `'actor_id'`, aegi_actor_login: `'actor'`, aegi_client_ip: `'actor_ip'` },
    // 원소는 대상 종류 이름이다. 사용자, 저장소, 팀 순서(mapper 와 같음)
    targets: {
      list: `mvappend(if(isnotnull(coalesce('user_id','user')),"User",null()),if(isnotnull(coalesce('repo_id','repo')),"Repository",null()),if(isnotnull('team'),"Team",null()))`,
      type: 'aegi_t',
      id: `case(aegi_t=="User",coalesce('user_id','user'),aegi_t=="Repository",coalesce('repo_id','repo'),true(),'team')`,
      name: `case(aegi_t=="User",'user',aegi_t=="Repository",'repo',true(),'team')`,
    },
  },
  'slack:audit': {
    inputs: { action: `coalesce('action',"")` },
    category: [
      ...any<EventCategory>('auth', r('action', 'regex', 'login|logout|session')),
      ...any<EventCategory>('token', r('action', 'regex', 'token|oauth|app_installed|app_uninstalled|app_scopes|app_approved|app_restricted|app_resources')),
      ...any<EventCategory>('data', r('action', 'regex', 'file_|download|export')),
      ...any<EventCategory>('membership', r('action', 'regex', 'member|joined|left|user_added|user_removed|guest|added_to|removed_from')),
      ...any<EventCategory>('policy', r('action', 'regex', 'pref_|policy|setting|retention|barrier|restricted|mfa|sso')),
      ...any<EventCategory>('admin', r('action', 'regex', 'role|admin|owner|created|deactivated|reactivated|archive|renamed|deleted')),
    ],
    categoryDefault: 'other',
    outcome: 'not_recorded',
    fields: { aegi_event_id: `"slack:".'id'`, aegi_event_type: `'action'`, aegi_outcome_reason: null, aegi_actor_id: `'actor.user.id'`, aegi_actor_login: `'actor.user.email'`, aegi_client_ip: `'context.ip_address'` },
    // entity.<type> 아래에 대상이 있다. 종류마다 경로가 달라 entity.type 으로 경로를 만든다
    targets: { list: `spath(_raw,"entity")`, type: `spath(aegi_t,"type")`, id: `spath(aegi_t,spath(aegi_t,"type").".id")`,
      name: `coalesce(spath(aegi_t,spath(aegi_t,"type").".email"),spath(aegi_t,spath(aegi_t,"type").".name"))` },
  },
  'sfdc:setupaudittrail': {
    prelude: [
      `rex field=Display "${SF_TARGET_PERMISSION_SET_PATTERN}"`,
      `rex field=Display "${SF_TARGET_FLOW_PATTERN.replace(/"/g, '\\"')}"`,
      `rex field=Display max_match=0 "${SF_TARGET_USER_PATTERN}"`,
      `eval aegi_target_users=mvdedup(mvmap(aegi_target_user,substr(aegi_target_user,1,15)))`,
    ],
    inputs: { action: `coalesce('Action',"")`, section: `coalesce('Section',"")` },
    category: [
      ...any<EventCategory>('membership', r('action', 'regex', 'permset(group)?(un)?assign|changedprofile|changed(user)?role|assign', true)),
      ...any<EventCategory>('auth', r('action', 'regex', 'login|password|mfa|twofactor|identityverif|session|frozen', true)),
      ...any<EventCategory>('token', r('action', 'regex', 'connectedapp|oauth|token|remoteaccess|apiaccess', true)),
      ...any<EventCategory>('policy', r('section', 'regex', 'security|sharing|session settings|network access', true), r('action', 'regex', 'policy|sharing|iprange|trusted', true)),
    ],
    categoryDefault: 'admin',
    outcome: 'not_recorded',
    // 원본 CreatedById 는 18자면 앞 15자로 줄인다. 대상은 Display 문장에서 권한 집합, 플로, 사용자 ID 를 추출한다
    fields: {
      aegi_event_id: `"salesforce:".'Id'`,
      aegi_event_type: `'Action'`,
      aegi_outcome_reason: null,
      aegi_actor_id: `if(len('CreatedById')==18,substr('CreatedById',1,15),'CreatedById')`,
      aegi_actor_login: null,
      aegi_client_ip: null,
    },
    targets: {
      list: `mvappend(case((match(aegi_in_action,"${SF_ACTION_PERM_SET_PATTERN}")) AND isnotnull(aegi_target_ps),"PermissionSet\\t".aegi_target_ps,match(aegi_in_action,"(?i)${SF_ACTION_FLOW_PATTERN}") AND isnotnull(aegi_target_flow),"Flow\\t".aegi_target_flow),mvmap(aegi_target_users,"User\\t".aegi_target_users))`,
      type: `mvindex(split(aegi_t,"\\t"),0)`,
      id: `mvindex(split(aegi_t,"\\t"),1)`,
      name: `case(mvindex(split(aegi_t,"\\t"),0)=="User","",true(),mvindex(split(aegi_t,"\\t"),1))`,
    },
    auxFields: ['aegi_target_ps', 'aegi_target_flow', 'aegi_target_user', 'aegi_target_users'],
  },
  'jira:audit': {
    inputs: { text: atlassianText },
    category: atlassianCategory, categoryDefault: 'other', outcome: 'not_recorded',
    fields: { aegi_event_id: `"jira:".'id'`, aegi_event_type: `'summary'`, aegi_outcome_reason: null, aegi_actor_id: `coalesce('authorAccountId','authorKey')`, aegi_actor_login: null, aegi_client_ip: `'remoteAddress'` },
    targets: { list: `mvappend(spath(_raw,"objectItem"),spath(_raw,"associatedItems{}"))`, type: `upper(spath(aegi_t,"typeName"))`, id: `spath(aegi_t,"id")`, name: `spath(aegi_t,"name")` },
  },
  'confluence:audit': {
    inputs: { text: atlassianText },
    category: atlassianCategory, categoryDefault: 'other', outcome: 'not_recorded',
    fields: { aegi_event_id: `"confluence:".coalesce('id',"sha256:".sha256(_raw))`, aegi_event_type: `'summary'`, aegi_outcome_reason: null, aegi_actor_id: `'author.accountId'`, aegi_actor_login: null, aegi_client_ip: `'remoteAddress'` },
    targets: { list: `mvappend(spath(_raw,"affectedObject"),spath(_raw,"associatedObjects{}"))`, type: `spath(aegi_t,"objectType")`, id: `spath(aegi_t,"name")`, name: `spath(aegi_t,"name")` },
  },
  'atlassian:guard:audit': {
    children: 'data{}',
    inputs: { text: `lower(" ".coalesce(spath(aegi_child,"attributes.action"),""))` },
    category: atlassianCategory, categoryDefault: 'other', outcome: 'not_recorded',
    fields: { aegi_event_id: `"atlassian-guard:".spath(aegi_child,"id")`, aegi_event_type: `spath(aegi_child,"attributes.action")`, aegi_outcome_reason: null, aegi_actor_id: `spath(aegi_child,"attributes.actor.id")`, aegi_actor_login: null,
      aegi_client_ip: `spath(aegi_child,"attributes.location.ip")` },
    targets: null,
  },
}

function holds(rule: Rule, inputs: Record<string, string>): boolean {
  const v = inputs[rule.input] ?? ''
  if (rule.op === 'eq') return v === rule.value
  if (rule.op === 'prefix') return v.startsWith(rule.value)
  if (rule.op === 'includes') return v.includes(rule.value)
  return new RegExp(rule.value, rule.ignoreCase ? 'i' : '').test(v)
}
const first = <T>(branches: Branch<T>[], inputs: Record<string, string>) => branches.find(b => b.when.every(rule => holds(rule, inputs)))?.then

function shape(sourcetype: string): Shape {
  const s = SHAPES[sourcetype]
  if (!s) throw new Error(`no event classes for ${sourcetype}`)
  return s
}
/** mapper 의 category. inputs 는 그 sourcetype 표의 입력 이름으로 넘긴다 */
export function categoryOf(sourcetype: string, inputs: Record<string, string>): EventCategory {
  const s = shape(sourcetype)
  return first(s.category, inputs) ?? s.categoryDefault
}
/** mapper 의 outcome. 결과를 기록하지 않는 소스는 unknown */
export function outcomeOf(sourcetype: string, inputs: Record<string, string>): 'success' | 'failure' | 'unknown' {
  const s = shape(sourcetype)
  return s.outcome === 'not_recorded' ? 'unknown' : first(s.outcome, inputs) ?? 'unknown'
}

// ---- SPL ----

const splString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const regexEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const inputField = (name: string) => `aegi_in_${name}`
function ruleSpl(rule: Rule): string {
  const f = inputField(rule.input)
  if (rule.op === 'eq') return `${f}==${splString(rule.value)}`
  if (rule.op === 'prefix') return `substr(${f},1,${[...rule.value].length})==${splString(rule.value)}`
  const pattern = rule.op === 'includes' ? regexEscape(rule.value) : rule.value
  return `match(${f},${splString(`${rule.ignoreCase ? '(?i)' : ''}${pattern}`)})`
}
const branchSpl = <T extends string>(b: Branch<T>) => `${b.when.map(ruleSpl).join(' AND ')},${splString(b.then)}`

/** 기본 검색에 붙일 단계: 자식 펼치기, 판정, 공통 필드. 판정 표가 없는 sourcetype 은 빈 목록 */
export function commonFieldPipes(sourcetype: string): string[] {
  const s = SHAPES[sourcetype]
  if (!s) return []
  const pipes: string[] = []
  if (s.children) {
    // 자식이 없는 레코드는 mapper 처럼 버린다. 펼치기 전에 걸러야 한다: 빈 배열에도 mvzip 이 값을 만든다(2026-11-01 Guard 450건).
    // 자식 앞에 위치 번호와 탭을 붙여 펼친다. JSON 문자열에는 날것의 탭이 없다
    pipes.push(`spath path=${s.children} output=aegi_child`, 'where isnotnull(aegi_child)', 'eval aegi_child=mvzip(mvrange(0,mvcount(aegi_child)),aegi_child,"\t")', 'mvexpand aegi_child',
      'rex field=aegi_child "^(?<aegi_child_index>\\d+)\\t(?s)(?<aegi_child>.*)$"', 'where isnotnull(aegi_child_index)')
  }
  if (s.prelude) {
    if (Array.isArray(s.prelude)) pipes.push(...s.prelude)
    else pipes.push(s.prelude)
  }
  pipes.push(`eval ${Object.entries(s.inputs).map(([k, v]) => `${inputField(k)}=${v}`).join(', ')}`)
  pipes.push(`eval aegi_category=case(${[...s.category.map(branchSpl), `true(),${splString(s.categoryDefault)}`].join(',')})`)
  pipes.push(s.outcome === 'not_recorded' ? 'eval aegi_outcome="not_recorded"' : `eval aegi_outcome=case(${[...s.outcome.map(branchSpl), 'true(),"unknown"'].join(',')})`)
  pipes.push(`eval ${Object.entries(s.fields).map(([k, v]) => `${k}=${v ?? 'null()'}`).join(', ')}`)
  if (s.targets) {
    // 원소마다 종류, ID, 이름을 꺼낸다. 값이 없는 원소는 ""로 두어 세 목록의 순서를 맞춘다
    pipes.push(`eval aegi_t=${s.targets.list}`,
      `eval aegi_target_type=mvmap(aegi_t,coalesce(${s.targets.type},"")), aegi_target_id=mvmap(aegi_t,coalesce(${s.targets.id},"")), aegi_target_name=mvmap(aegi_t,coalesce(${s.targets.name},""))`)
  } else pipes.push('eval aegi_target_type=null(), aegi_target_id=null(), aegi_target_name=null()')
  const aux = s.auxFields?.length ? ` ${s.auxFields.join(' ')}` : ''
  pipes.push(`fields - aegi_t aegi_p aegi_child ${Object.keys(s.inputs).map(inputField).join(' ')}${aux}`)
  return pipes
}

/** AI 가 고른 판정 필터. 그 소스가 기록하지 않는 판정이면 null(그 소스는 검색하지 않는다) */
export function matchPipe(sourcetype: string, categories: readonly string[], outcomes: readonly string[]): string | null | '' {
  const s = SHAPES[sourcetype]
  if (!categories.length && !outcomes.length) return ''
  if (!s || (outcomes.length && s.outcome === 'not_recorded')) return null
  const conds = [categories.length ? `in(aegi_category,${categories.map(splString).join(',')})` : '', outcomes.length ? `in(aegi_outcome,${outcomes.map(splString).join(',')})` : ''].filter(Boolean)
  return `where ${conds.join(' AND ')}`
}

/** schema 에 싣는 판정 표 요약: 기록하는 공통 필드, 결과 판정 여부, 세는 단위 */
export function classSummary(sourcetype: string) {
  const s = SHAPES[sourcetype]
  if (!s) return null
  const recorded = [...Object.entries(s.fields).filter(([, v]) => v !== null).map(([k]) => k), ...(s.targets ? ['aegi_target_type', 'aegi_target_id', 'aegi_target_name'] : [])]
  return {
    unit: s.children ? `child events of ${s.children}` : 'records',
    outcome: s.outcome === 'not_recorded' ? 'not_recorded' : 'success, failure, unknown',
    categories: [...new Set([...s.category.map(b => b.then), s.categoryDefault])],
    commonFields: ['aegi_category', 'aegi_outcome', ...recorded],
    notRecorded: COMMON_FIELDS.filter(f => !recorded.includes(f)),
  }
}
