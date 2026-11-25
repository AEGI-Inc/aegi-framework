import { useMemo, useState } from 'react'
import { Plus, Route, Trash2, X } from 'lucide-react'
import type { GraphStore, GraphStoreV2 } from '../model/graph'
import { ALLOWED_RELATION_TYPES } from '../model/relation'
import { executeGraphQueryResult, matchObjectNames, matchObjects, type ObjectCondition, type RelationshipCondition } from './graphQuery'
import { findInvestigationPaths, type InvestigationPath } from './investigationQuery'
import { relationMatchesLens, type RelationLens } from './relationLens'
import { objectDisplayName } from './objectChip'
import { providerName } from '../findings/providers'
import { getPrimaryIdentifierValue } from '../utils/identifier'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId } from '../findings/providers'
import { linkLevelCopy } from './edgeExplain'
import { groupByPerson, type PersonGroup } from './personGroups'
import { personAccessRows } from './personAccess'
import PersonAccessDialog from './PersonAccessDialog'
import type { EffectiveAccessFile } from '../detection/v2/effectiveAccess/types'

export interface QueryOutput { objectKeys: string[]; relationKeys: string[]; linkIds: string[]; path?: InvestigationPath; isNameSearch?: boolean }
interface Props { graph: GraphStore | GraphStoreV2; onQuery: (result: QueryOutput) => void; onReset: () => void; onFocusScope: () => void; onSelectObject?: (key: string) => void; focused: boolean; showHeading?: boolean; effectiveAccess?: EffectiveAccessFile }
const aliases = ['A', 'B', 'C', 'D', 'E', 'F']
const propertyOptions = [['', '선택 안 함'], ['fixture_key', 'Object Key'], ['display_name', '표시 이름'], ['email', '이메일'], ['name', '이름'], ['login', '로그인 ID']]
/* 경로 찾기는 시작과 도착을 각각 이 수까지만 짝지어 본다 */
const PATH_ENDS = 12
const conditionName = (alias: string) => `조건 ${aliases.indexOf(alias) + 1}`

/* 경로의 시작: 결과 줄에서 고른 대상, 없으면 1단계에서 찾은 결과 전체 */
interface PathStart { keys: string[]; name: string }

export default function GraphQueryPanel({ graph, onQuery, onReset, onFocusScope, onSelectObject, focused, showHeading = true, effectiveAccess }: Props) {
  /* 「접근 가능 리소스 표」로 연 사람 */
  const [accessPerson, setAccessPerson] = useState<PersonGroup | null>(null)
  const [quickName, setQuickName] = useState('')
  const [resultFilter, setResultFilter] = useState('')
  const [objects, setObjects] = useState<ObjectCondition[]>([{ alias: 'A' }])
  const [relationships, setRelationships] = useState<RelationshipCondition[]>([])
  /* 1단계(대상 찾기)에서 찾은 대상. 경로 시작을 따로 고르지 않으면 이것이 시작이다 */
  const [foundKeys, setFoundKeys] = useState<string[]>([])
  const [pickedStart, setPickedStart] = useState<PathStart | null>(null)
  const [target, setTarget] = useState<ObjectCondition>({ alias: 'B', property: 'display_name' })
  const [maxHops, setMaxHops] = useState(6); const [directed, setDirected] = useState(false)
  const [includeIdentity, setIncludeIdentity] = useState(true); const [pathLens, setPathLens] = useState<RelationLens>('all')
  const [paths, setPaths] = useState<InvestigationPath[]>([]); const [selectedPath, setSelectedPath] = useState<number | null>(null)
  const [lastOutput, setLastOutput] = useState<QueryOutput | null>(null); const [message, setMessage] = useState('')
  const providers = useMemo(() => [...new Set([...graph.objectsByKey.values()].map(item => item.canonical.provider))].sort(), [graph])
  const objectTypes = useMemo(() => [...new Set([...graph.objectsByKey.values()].map(item => item.canonical.object_type))].sort(), [graph])
  const patchObject = (i: number, patch: Partial<ObjectCondition>) => setObjects(current => current.map((item, j) => i === j ? { ...item, ...patch } : item))
  const patchRelation = (i: number, patch: Partial<RelationshipCondition>) => setRelationships(current => current.map((item, j) => i === j ? { ...item, ...patch } : item))
  const resultObjects = useMemo(() => (lastOutput?.objectKeys ?? []).flatMap(key => {
    const object = graph.objectsByKey.get(key)
    return object && `${objectDisplayName(object)} ${key} ${object.canonical.provider}`.toLocaleLowerCase().includes(resultFilter.trim().toLocaleLowerCase()) ? [{ key, object }] : []
  }), [graph, lastOutput, resultFilter])
  /* 같은 사람(동일인 연결)의 계정을 한 줄로 묶는다 */
  const grouped = useMemo(() => groupByPerson(graph, resultObjects), [graph, resultObjects])
  const pathStart: PathStart | null = pickedStart ?? (foundKeys.length ? { keys: foundKeys, name: `찾은 대상 ${foundKeys.length}개` } : null)
  const showPerson = (keys: string[], linkId: string) => {
    /* 검색 결과 목록은 그대로 두고 그래프만 그 사람의 계정과 동일인 연결을 강조한다 */
    setPaths([]); setSelectedPath(null)
    onQuery({ objectKeys: keys, relationKeys: [], linkIds: [linkId], isNameSearch: false })
    /* 객체 174개 사이에서는 강조가 안 보여, 그 사람의 계정과 이웃만 남긴다. 「전체 그래프 보기」로 돌아간다 */
    if (!focused) onFocusScope()
    setMessage(`한 사람의 계정 ${keys.length}개를 그래프에 강조`)
  }
  /* 새로 찾으면 앞 결과에서 고른 경로 시작과 찾은 경로를 비운다 */
  const showFound = (output: QueryOutput, nextMessage: string) => {
    setPaths([]); setSelectedPath(null); setPickedStart(null); setFoundKeys(output.objectKeys)
    setLastOutput(output); setResultFilter(''); onQuery(output); setMessage(nextMessage)
  }
  const runName = () => {
    const value = quickName.trim()
    if (!value) { setMessage('찾을 이름이나 ID 입력 필요'); return }
    const objectKeys = matchObjectNames(graph, value)
    showFound({ objectKeys, relationKeys: [], linkIds: [], isNameSearch: true }, objectKeys.length ? '' : '이름이나 ID에 맞는 결과 없음. 수집 범위 밖의 대상일 수 있음')
  }

  const run = () => {
    // An incomplete condition is an input error, not missing collection data.
    // The structural query validator covers this too, but a plain search does not call it.
    if (objects.some(item => item.value?.trim() && !item.property)) {
      setMessage('검색할 속성 선택 필요. 이름으로 찾으려면 「표시 이름」 선택')
      return
    }
    if (objects.some(item => !item.provider && !item.objectType && !item.property && !item.value?.trim())) { setMessage('조건마다 값 하나 이상 필요'); return }
    const groups = objects.map(condition => ({ alias: condition.alias, keys: matchObjects(graph, condition) }))
    let objectKeys = [...new Set(groups.flatMap(group => group.keys))]
    if (!objectKeys.length) { showFound({ objectKeys: [], relationKeys: [], linkIds: [] }, '조건에 맞는 결과 없음. 수집 범위 밖의 대상일 수 있음'); return }
    let relationKeys: string[] = [], linkIds: string[] = [], relationMatchCount = 0
    if (relationships.length) {
      const result = executeGraphQueryResult(graph, objects, relationships, 80)
      if (result.error) { setMessage(result.error); return }
      relationKeys = [...new Set(result.matches.flatMap(match => match.relationKeys))]; linkIds = [...new Set(result.matches.flatMap(match => match.linkIds))]
      if (!result.matches.length) { showFound({ objectKeys, relationKeys: [], linkIds: [] }, '조건에 맞는 대상은 있지만 관계 조건을 만족하는 구조 없음'); return }
      objectKeys = [...new Set(result.matches.flatMap(match => Object.values(match.objects)))]
      relationMatchCount = result.matches.length
    }
    const counts = groups.map(group => `${conditionName(group.alias)} ${group.keys.length}개`).join(', ')
    showFound({ objectKeys, relationKeys, linkIds, isNameSearch: false }, `${relationships.length ? `관계 조건에 맞는 구조 ${relationMatchCount}개` : counts}. 검색 결과는 위협이 아님`)
  }

  const runPath = () => {
    if (!pathStart) { setMessage('경로 시작 없음. 대상을 먼저 찾거나 결과에서 「경로 시작」 선택'); return }
    if (target.value?.trim() && !target.property) { setMessage('도착의 속성 선택 필요. 이름으로 찾으려면 「표시 이름」 선택'); return }
    if (!target.provider && !target.objectType && !target.value?.trim()) { setMessage('도착 조건 하나 이상 필요'); return }
    const from = pathStart.keys
    const to = matchObjects(graph, target)
    if (!to.length) { setMessage('도착 조건에 맞는 대상 없음. 수집 범위 밖의 대상일 수 있음'); return }
    const relationTypes = pathLens === 'all' ? undefined : new Set([...ALLOWED_RELATION_TYPES].filter(type => relationMatchesLens(type, pathLens)))
    let nextPaths: InvestigationPath[] = []
    for (const source of from.slice(0, PATH_ENDS)) {
      for (const goal of to.slice(0, PATH_ENDS)) nextPaths.push(...findInvestigationPaths(graph, source, goal, { maxHops, directed, includeIdentityLinks: includeIdentity, relationTypes }, 4))
      if (nextPaths.length >= PATH_ENDS) break
    }
    const seen = new Set<string>()
    nextPaths = nextPaths.filter(path => { const id = path.steps.map(step => step.edgeId).join('|'); if (seen.has(id)) return false; seen.add(id); return true }).slice(0, PATH_ENDS)
    const output: QueryOutput = { objectKeys: [...new Set([...from, ...to])], relationKeys: [], linkIds: [], path: nextPaths[0], isNameSearch: false }
    setPaths(nextPaths); setSelectedPath(nextPaths.length ? 0 : null); setLastOutput(output); setResultFilter(''); onQuery(output)
    setMessage(nextPaths.length
      ? `시작 ${from.length}개, 도착 ${to.length}개. 연결 경로 ${nextPaths.length}개. 검색 결과는 위협이 아님`
      : `시작 ${from.length}개, 도착 ${to.length}개. 지금 방향, 최대 ${maxHops}단계, 수집 범위 조건에서 경로 없음`)
  }
  const clearHighlight = () => { setPaths([]); setSelectedPath(null); setLastOutput(null); onQuery({ objectKeys: [], relationKeys: [], linkIds: [] }); setMessage('검색 조건은 그대로 두고 그래프 강조만 껐습니다.') }
  const reset = () => { setQuickName(''); setResultFilter(''); setObjects([{ alias: 'A' }]); setRelationships([]); setFoundKeys([]); setPickedStart(null); setTarget({ alias: 'B', property: 'display_name' }); setPaths([]); setSelectedPath(null); setLastOutput(null); setMessage(''); onReset() }

  const conditionFields = (item: ObjectCondition, patch: (p: Partial<ObjectCondition>) => void, label: string, onRemove?: () => void) => <div className="gq-cond" key={item.alias}>
    <b className="gq-cond-label">{label}</b>
    <label>SaaS<select aria-label={`${label} SaaS`} value={item.provider || ''} onChange={event => patch({ provider: event.target.value || undefined })}><option value="">전체</option>{providers.map(value => <option key={value} value={value}>{providerName(value)}</option>)}</select></label>
    <label>종류<select aria-label={`${label} 종류`} value={item.objectType || ''} onChange={event => patch({ objectType: event.target.value || undefined })}><option value="">전체</option>{objectTypes.map(value => <option key={value}>{value}</option>)}</select></label>
    <label>속성<select aria-label={`${label} 속성`} value={item.property || ''} onChange={event => patch({ property: event.target.value || undefined })}>{propertyOptions.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
    <label>값<input aria-label={`${label} 값`} value={item.value || ''} onChange={event => patch({ value: event.target.value })}/></label>
    {onRemove && <button className="gq-icon-btn" type="button" aria-label={`${label} 삭제`} onClick={onRemove}><Trash2 size={14}/></button>}
  </div>
  const pathStartButton = (keys: string[], name: string) => <button type="button" className="gq-path-start" onClick={() => setPickedStart({ keys, name })}>경로 시작</button>

  return <section className="gq-panel gq-unified gq-steps" aria-label="Unified Query Builder">
    {showHeading && <div className="gq-head"><strong>검색, 경로</strong></div>}

    <div className="gq-step"><b className="gq-step-no">1</b><strong>대상 찾기</strong><button type="button" className="gq-step-reset" onClick={reset}>초기화</button></div>
    <form className="gq-name-search" onSubmit={event => { event.preventDefault(); runName() }}>
      <div><input id="gq-name" aria-label="이름, ID 검색" value={quickName} onChange={event => setQuickName(event.target.value)} placeholder="이름, 이메일, 로그인 ID" /><button type="submit" className="gq-run">찾기</button></div>
    </form>
    <details className="gq-builder"><summary>조건으로 좁히기</summary><div className="gq-builder-body">
      {objects.map((item, index) => conditionFields(item, patch => patchObject(index, patch), conditionName(item.alias), objects.length > 1 ? () => { setObjects(objects.filter((_, i) => i !== index).map((object, i) => ({ ...object, alias: aliases[i] }))); setRelationships([]) } : undefined))}
      <button type="button" className="gq-add" disabled={objects.length >= 6} onClick={() => setObjects(current => [...current, { alias: aliases[current.length] }])}><Plus size={13}/> 조건 추가</button>
      <details className="gq-relation-section"><summary><b>관계 조건</b></summary><div className="gq-relation-body">
        {relationships.map((item, index) => <div className="gq-relation-row" key={index}><select value={item.from} onChange={e => patchRelation(index, { from: e.target.value })}>{objects.map(o => <option key={o.alias} value={o.alias}>{conditionName(o.alias)}</option>)}</select><select value={item.kind} onChange={e => patchRelation(index, { kind: e.target.value as RelationshipCondition['kind'] })}><option value="relation">직접 관계</option><option value="identity">동일인 연결</option></select>{item.kind === 'relation' && <select value={item.type || ''} onChange={e => patchRelation(index, { type: e.target.value || undefined })}><option value="">모든 유형</option>{[...ALLOWED_RELATION_TYPES].map(type => <option key={type}>{type}</option>)}</select>}<select value={item.to} onChange={e => patchRelation(index, { to: e.target.value })}>{objects.map(o => <option key={o.alias} value={o.alias}>{conditionName(o.alias)}</option>)}</select><button className="gq-icon-btn" type="button" aria-label="관계 조건 삭제" onClick={() => setRelationships(current => current.filter((_, i) => i !== index))}><Trash2 size={14}/></button></div>)}
        <button type="button" disabled={objects.length < 2} onClick={() => setRelationships(current => [...current, { from: objects[0].alias, to: objects[1].alias, kind: 'relation' }])}><Plus size={13}/> 관계 조건 추가</button></div></details>
      <button type="button" className="gq-run" onClick={run}>조건으로 찾기</button>
    </div></details>

    <div className="gq-step"><b className="gq-step-no">2</b><strong>결과</strong></div>
    {lastOutput && <div className="gq-result-head"><b>결과 {lastOutput.objectKeys.length}개{paths.length ? `, 경로 ${paths.length}개` : ''}</b><span>
      <button type="button" onClick={onFocusScope} disabled={!lastOutput.objectKeys.length}>{focused ? '전체 그래프 보기' : '결과만 보기'}</button>
      <button type="button" onClick={clearHighlight}>강조 끄기</button>
    </span></div>}
    {message && <p className="gq-result-message" role="status">{message}</p>}
    {!!lastOutput?.objectKeys.length && onSelectObject && <div className="gq-object-results" aria-label="검색 결과 목록">
      <label>결과 내 검색<input value={resultFilter} onChange={event => setResultFilter(event.target.value)} placeholder="이름, ID, SaaS" /></label>
      {grouped.people.length > 0 && <>
        <strong className="gq-group-title">사람 {grouped.people.length}</strong>
        <ul className="gq-people">{grouped.people.map(person => <li key={person.link.link_id}>
          <div className="gq-person-head">
            <b>{person.name}</b>
            <span className={`gq-person-level is-${person.link.level}`} title={linkLevelCopy(person.link.level).meaning}>동일인 {linkLevelCopy(person.link.level).label}</span>
            <span className="gq-person-count">계정 {person.accounts.length}개</span>
          </div>
          <div className="gq-person-accounts">{person.accounts.map(({ key, object }) => <button type="button" key={key} data-result-key={key} title={getPrimaryIdentifierValue(object)} onClick={() => onSelectObject(key)}>
            <ProviderLogo provider={providerLogoId(object.canonical.provider)} />
            <b>{providerName(object.canonical.provider)}</b>
            <span>{objectDisplayName(object)}</span>
          </button>)}</div>
          <div className="gq-person-actions">
            <button type="button" className="gq-person-show" onClick={() => showPerson(person.accounts.map(account => account.key), person.link.link_id)}>사람 단위로 보기</button>
            {pathStartButton(person.accounts.map(account => account.key), person.name)}
            {'outgoingRelationsByObject' in graph && <button type="button" className="gq-person-table" onClick={() => setAccessPerson(person)}>접근 가능 리소스 표</button>}
          </div>
        </li>)}</ul>
      </>}
      {grouped.people.length > 0 && grouped.rest.length > 0 && <strong className="gq-group-title">그 밖의 항목 {grouped.rest.length}</strong>}
      {/* 내부 ID는 줄에 적지 않고 커서를 올리면 보인다. 상세의 데이터 탭에도 있다 */}
      {grouped.rest.length > 0 && <ul>{grouped.rest.map(({ key, object }) => <li key={key} className="gq-result-row"><button type="button" data-result-key={key} title={getPrimaryIdentifierValue(object)} onClick={() => onSelectObject(key)}>
        <b>{objectDisplayName(object)}</b><span>{providerName(object.canonical.provider)}, {object.catalog_ref?.provider_term ?? object.canonical.object_type}</span>
      </button>{pathStartButton([key], objectDisplayName(object))}</li>)}</ul>}
      {!resultObjects.length && <p>맞는 결과 없음</p>}
    </div>}
    {accessPerson && 'outgoingRelationsByObject' in graph && (
      <PersonAccessDialog
        name={accessPerson.name}
        rows={personAccessRows(graph as GraphStoreV2, accessPerson.accounts.map(account => account.key), effectiveAccess)}
        onClose={() => setAccessPerson(null)}
      />
    )}

    <div className="gq-step"><b className="gq-step-no">3</b><strong>경로 이어 찾기</strong></div>
    <div className="gq-path-start-row"><b>시작</b><span>{pathStart?.name ?? '없음'}</span>{pickedStart && <button type="button" className="gq-icon-btn" aria-label="고른 경로 시작 지우기" onClick={() => setPickedStart(null)}><X size={14}/></button>}</div>
    {conditionFields(target, patch => setTarget(current => ({ ...current, ...patch })), '도착')}
    <details className="gq-path-options"><summary>옵션</summary><div className="gq-path-options-body">
      <label>최대 단계<input type="number" min={1} max={12} value={maxHops} onChange={e => setMaxHops(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}/></label>
      <label>관계 범위<select value={pathLens} onChange={e => setPathLens(e.target.value as RelationLens)}><option value="all">전체</option><option value="structure">구조</option><option value="authority">권한</option><option value="trust">신뢰와 인증</option><option value="flow">실행과 전달</option></select></label>
      <label className="gq-check"><input type="checkbox" checked={directed} onChange={e => setDirected(e.target.checked)}/> 방향 적용</label>
      <label className="gq-check"><input type="checkbox" checked={includeIdentity} onChange={e => setIncludeIdentity(e.target.checked)}/> 동일인 연결 포함</label>
    </div></details>
    <button type="button" className="gq-run" disabled={!pathStart} onClick={runPath}>경로 찾기</button>
    {paths.length > 0 && <div className="gq-path-results"><strong>연결 경로</strong>{paths.map((path, index) => <button type="button" className={selectedPath === index ? 'selected' : ''} key={path.steps.map(step => step.edgeId).join('|')} onClick={() => { if (!lastOutput) return; setSelectedPath(index); onQuery({ ...lastOutput, path }) }}><Route size={13}/><span>경로 {index + 1}</span><small>{path.steps.length}단계, 중간 객체 {Math.max(0, path.objects.length - 2)}개</small></button>)}</div>}
  </section>
}
