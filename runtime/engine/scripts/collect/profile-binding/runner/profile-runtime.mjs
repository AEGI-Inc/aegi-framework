import { dashProvider } from './provider-map.mjs'

// Distinguish an unselected switch from a missing reference value. A switch may
// depend on finding the target first, so an empty selector is not evidence that
// the original source value was absent. Never include source values in reports.
export function classifyMissingRelationTarget(spec, scope, { evalExpr, present, hasTenant }) {
  const inspect = ref => {
    if (ref === 'self' || ref === '$self') return present(scope.self) ? 'target_record_not_collected' : 'reference_value_not_provided'
    if (ref === 'tenant' || ref === '$tenant') return hasTenant ? 'target_record_not_collected' : 'reference_value_not_provided'
    if (!ref || typeof ref !== 'object') return 'reference_value_not_provided'
    if (ref.switch !== undefined) {
      const selected = evalExpr(ref.switch, scope)
      const branch = ref.cases?.[String(selected)] ?? ref.default
      return branch === undefined ? 'target_selector_unresolved' : inspect(branch)
    }
    return present(evalExpr(ref.lookup !== undefined ? ref.value : ref.key !== undefined ? ref.key : ref.id, scope))
      ? 'target_record_not_collected' : 'reference_value_not_provided'
  }
  return inspect(spec)
}

// Execute reviewed extraction rules carried by the new Profiles. No legacy normalizer is called.
export function runProfileRules(api) {
  const { root, pages, profiles, config, objects, pending, report, evalExpr, evalCond, present, getPath,
    emitRecord, objectKey, identityOf, canonType, resolveTarget, addRelation, enforcedOf, scrub, sha, stable } = api
  const list = x => Array.isArray(x) ? x : x == null ? [] : [x]
  // 종류별 객체: 정규화기가 객체를 만들 때 함께 쌓는 provider|type → 키 목록(만든 순서). 없으면(시험) 전체를 훑는다
  const ofType = (provider, type) => api.keysByTypeProvider
    ? (api.keysByTypeProvider.get(`${provider}|${type}`) ?? []).map(k => objects.get(k))
    : [...objects.values()].filter(o => o.canonical.provider === provider && o.canonical.object_type === type)
  // 종류별 속성 색인(objects 의 where_eq, where_falsy). 열쇠는 eq 속성 값 그대로(=== 비교)와 falsy 속성의 참거짓,
  // 중첩 Map 끝에 객체 목록(만든 순서). 새 객체는 뒤에서 더하고 속성을 쓴 객체는 그 자리에서 옮겨, 규칙마다 전체를 훑지 않는다
  const propIndex = new Map()
  const compsOf = (ix, o) => [...ix.eq.map(p => o.canonical.properties[p]), ...ix.falsy.map(p => !!o.canonical.properties[p])]
  const leaf = (ix, comps, create) => {
    let m = ix.map
    for (let i = 0; i < comps.length; i++) {
      if (!m.has(comps[i])) { if (!create) return undefined; m.set(comps[i], i === comps.length - 1 ? [] : new Map()) }
      m = m.get(comps[i])
    }
    return m
  }
  const insertByPos = (ix, comps, o) => {
    const arr = leaf(ix, comps, true), p = ix.pos.get(o)
    let lo = 0, hi = arr.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ix.pos.get(arr[mid]) < p) lo = mid + 1; else hi = mid }
    arr.splice(lo, 0, o)
  }
  const syncIndex = (ix, list) => {
    for (let i = ix.n; i < list.length; i++) { const o = list[i]; ix.pos.set(o, i); const c = compsOf(ix, o); ix.compsOf.set(o, c); insertByPos(ix, c, o) }
    ix.n = list.length
  }
  const byProps = (provider, type, whereEq, whereFalsy) => {
    const eq = Object.keys(whereEq ?? {}), falsy = [...(whereFalsy ?? [])]
    const k = `${provider}|${type}|${eq.join(',')}|${falsy.join(',')}`
    let ix = propIndex.get(k)
    if (!ix) { ix = { eq, falsy, props: new Set([...eq, ...falsy]), n: 0, map: new Map(), pos: new Map(), compsOf: new Map() }; propIndex.set(k, ix) }
    syncIndex(ix, ofType(provider, type))
    return [...(leaf(ix, [...eq.map(p => whereEq[p]), ...falsy.map(() => false)], false) ?? [])]
  }
  const refreshIndexed = (ix, o) => {
    const old = ix.compsOf.get(o)
    if (!old) return
    const c = compsOf(ix, o)
    if (c.every((x, i) => Object.is(x, old[i]))) return
    const arr = leaf(ix, old, false)
    arr.splice(arr.indexOf(o), 1)
    ix.compsOf.set(o, c); insertByPos(ix, c, o)
  }
  const indexesOf = o => [...propIndex.entries()].filter(([k]) => k.startsWith(`${o.canonical.provider}|${o.canonical.object_type}|`)).map(([, ix]) => ix)
  const propWritten = (o, prop) => { for (const ix of indexesOf(o)) if (ix.props.has(prop)) refreshIndexed(ix, o) }
  const objectWritten = o => { for (const ix of indexesOf(o)) refreshIndexed(ix, o) }
  const pushUnique = api.pushUnique ?? ((arr, x) => { if (arr.some(y => stable(y) === stable(x))) return false; arr.push(x); return true })
  const dash = dashProvider
  const runtimeProfiles = profiles.filter(p => p.prof.runtime_rules)
  const byFile = new Map(runtimeProfiles.map(p => [p.file.replace(/^overlays\//,''), p]))
  const aliases = new Map()
  const observations = new Map()
  const provenance = (env) => ({ api: env.endpoint, params: {call_id: env.call_id, ...(env.request_params ?? {})}, record:'measured', collected_at:env.collected_at })
  const envs = new Map()
  const usedPages = new Set()
  const ctxVars = new Map()
  const tenant = new Map()
  const deferredRefs = []
  const deferredRelations = []
  const deferredParents = []
  const indexCache = new Map()
  const indexDeps = new WeakMap()
  const indexReadsObjects = def => {
    if (!indexDeps.has(def)) indexDeps.set(def, /"(ref|has|objects|index|lookup)"|"@|tenant|ctx|self|parent_of|\bvars\b/.test(JSON.stringify(def)))
    return indexDeps.get(def)
  }
  const outcomes = new Map()
  const rulesByProvider = new Map()
  const keyPart = x => String(x).replace(/[^A-Za-z0-9._-]/g,'_')
  const normalize = (p, v) => (p.prof.runtime_identifiers?.id?.normalization ?? []).reduce((v,n)=>n==='to_18_char' ? api.sfId18(v) : n==='lowercase' ? String(v).toLowerCase() : n==='trim' ? String(v).trim() : v,v)
  const legacyKey = (p, id, parts={}, tpl) => (tpl ?? p.prof.runtime_key ?? '').replace(/\{(\w+)\}/g,(_,n)=>keyPart(n==='id' ? id : parts[n] ?? ''))
  const aliasType = (provider, type) => config.aliases?.[`${provider}:${type}`] ?? type
  function findProfile(provider, type) {
    return runtimeProfiles.find(p=>dash(p.research_provider)===provider && (p.prof.object_type===type || canonType(p).type===type))
      ?? profiles.find(p=>dash(p.research_provider)===provider && p.prof.object_type===type)
  }
  for (const p of runtimeProfiles) {
    const provider = dash(p.research_provider)
    if (!rulesByProvider.has(provider)) rulesByProvider.set(provider, [])
    rulesByProvider.get(provider).push(p)
  }
  for (const env of pages) {
    if (!envs.has(env.provider)) envs.set(env.provider, [])
    envs.get(env.provider).push(env)
  }
  // 원본 쪽은 실행 중 바뀌지 않는다. 같은 source 선언(객체)과 provider 의 결과를 기억한다
  const pagesMemo = new WeakMap()
  function pagesOf(provider, source) {
    let byProvider = pagesMemo.get(source)
    if (!byProvider) { byProvider = new Map(); pagesMemo.set(source, byProvider) }
    if (!byProvider.has(provider)) byProvider.set(provider, pagesOfUncached(provider, source))
    return byProvider.get(provider)
  }
  function pagesOfUncached(provider, source) {
    const only = source.endpoint ? new RegExp(source.endpoint) : null, not = source.not_endpoint ? new RegExp(source.not_endpoint) : null
    return (envs.get(source.provider ?? provider) ?? []).filter(env=>{
      if(env.call_id!==source.call || (env.http_status != null && env.http_status>=400)) return false
      for(const [k,w] of Object.entries(source.request ?? {})) {
        const v=env.request_params?.[k]
        if(w==='present' ? !present(v) : w==='absent' ? present(v) : Array.isArray(w) ? !w.includes(v) : v!==w) return false
      }
      return (!only || only.test(env.endpoint)) && (!not || !not.test(env.endpoint))
    })
  }
  function itemsOf(env, item) {
    const p=env.payload
    return list(item ?? '(items)').flatMap(it=>{
      if(it==='(root)') return p==null?[]:[p]
      if(it==='(root_or_list)') return list(p)
      if(it==='(items)') return Array.isArray(p)?p:[]
      if(it.startsWith('(items:')) return list(p?.[it.slice(7,-1)])
      if(it.startsWith('(array_or:')) return Array.isArray(p)?p:it.slice(10,-1).split('|').map(x=>getPath(p,x)).find(Array.isArray) ?? []
      return list(getPath(p,it))
    })
  }
  function scope(p, rec, extra={}) {
    const provider=dash(p.research_provider)
    const sc={r:rec.r,parent:rec.parent,req:rec.env?.request_params ?? {}, endpoint:rec.env?.endpoint ?? '',
      tenant:tenant.get(provider),ctx:ctxVars.get(provider) ?? {},vars:{},...extra,__env:rec.env}
    sc.has=(ref,s)=>!!resolve(p,ref,s)?.key
    sc.propOf=(ref,prop,s)=>{
      const x=ref?.name ? s.vars?.[`@${ref.name}`] : resolve(p,ref,s)
      const o=x&&objects.get(x.key); if(!o)return undefined
      if(prop==='$key')return x.key
      if(prop==='$id')return o.fixture_meta.im_profile.runtime_id ?? o.canonical.identifiers[o.canonical.identifiers.primary[0]].value
      if(prop==='$display')return o.fixture_meta.display_name
      if(prop.startsWith('identifiers.'))return o.canonical.identifiers[prop.slice(12)]?.value
      return getPath(o.canonical.properties,prop)
    }
    sc.objects=(type,whereEq,whereFalsy)=>{
      const t=aliasType(provider,type)
      const all=whereEq||whereFalsy?byProps(provider,t,whereEq,whereFalsy):ofType(provider,t)
      return all.map(o=>({key:o.fixture_key,properties:o.canonical.properties}))
    }
    sc.pageCount=src=>pagesOf(provider,src).length
    sc.index=(name,key)=>{
      const def=config.providers?.[provider]?.indexes?.[name]; if(!def)throw Error(`Missing Profile index ${provider}:${name}`)
      // Indexes may depend on objects. Invalidate after new objects have been materialized.
      // 객체, tenant, ctx, 변수를 읽지 않는 색인은 원본만으로 정해지므로 다시 만들지 않는다(객체마다 다시 만들어 2,000명에서 느려졌다)
      const ck=indexReadsObjects(def)?`${provider}:${name}:${objects.size}`:`${provider}:${name}`
      if(!indexCache.has(ck)) {
        const m=new Map();indexCache.set(ck,m)
        for(const r of records(p,def.sources)) {
          const s=scope(p,r);if(def.where&&!evalCond(def.where,s))continue
          const k=evalExpr(def.key,s);if(!present(k))continue
          const v=evalExpr(def.value,s), ks=String(k)
          if(def.mode==='first'){if(!m.has(ks))m.set(ks,v)}
          else if(def.mode==='list')m.set(ks,[...(m.get(ks)??[]),v])
          else if(def.mode==='concat')m.set(ks,[...(m.get(ks)??[]),...list(v)])
          else m.set(ks,v)
        }
      }
      return present(key)?indexCache.get(ck).get(String(key)):undefined
    }
    return sc
  }
  function records(p,sources) {
    const provider=dash(p.research_provider)
    return (sources??[]).flatMap(src=>pagesOf(provider,src).flatMap(env=>{usedPages.add(env.__file);return itemsOf(env,src.items).flatMap(item=>{
      const rows=src.each?list(getPath(item,src.each)).map(r=>({r,parent:item,env})):[{r:item,env}]
      return rows.filter(r=>!src.where||evalCond(src.where,scope(p,r)))
    })}))
  }
  function units(p,rule) {
    const rows=records(p,rule.sources).filter(r=>!rule.where||evalCond(rule.where,scope(p,r)))
    if(rule.group_by===undefined)return rows.map(rec=>({rec}))
    const groups=new Map()
    for(const rec of rows){const k=evalExpr(rule.group_by,scope(p,rec));if(present(k)){if(!groups.has(String(k)))groups.set(String(k),[]);groups.get(String(k)).push(rec)}}
    return [...groups.values()].map(g=>{
      if(rule.group_sort!==undefined)g.sort((a,b)=>{const x=evalExpr(rule.group_sort,scope(p,a)),y=evalExpr(rule.group_sort,scope(p,b));return Number(x)-Number(y)||String(x).localeCompare(String(y))})
      return {rec:rule.obs==='last'?g.at(-1):g[0],group:g.map(x=>({r:x.r,parent:x.parent,req:x.env.request_params,endpoint:x.env.endpoint}))}
    })
  }
  function withVars(p,rule,rec,group) {
    const sc=scope(p,rec,{group})
    for(const [k,x] of Object.entries(rule.vars??{}))sc.vars[k]=evalExpr(x,sc)
    return sc
  }
  function resolve(p,spec,sc,allowStub=false) {
    if(!spec)return undefined
    const provider=dash(p.research_provider)
    if(spec==='self'||spec==='$self')return objects.has(sc.self)?{key:sc.self}:undefined
    if(spec==='tenant'||spec==='$tenant')return objects.has(tenant.get(provider))?{key:tenant.get(provider)}:undefined
    if(typeof spec==='string')throw Error(`Unknown Profile reference ${spec}`)
    if(spec.switch!==undefined){const v=evalExpr(spec.switch,sc);return resolve(p,spec.cases?.[String(v)]??spec.default,sc,allowStub)}
    if(spec.key!==undefined){const k=evalExpr(spec.key,sc);return objects.has(k)?{key:k}:aliases.has(k)?{key:aliases.get(k)}:undefined}
    const q=findProfile(provider,spec.type)
    if(!q)return undefined
    let key,id,parts={}
    if(spec.lookup!==undefined){
      const val=evalExpr(spec.value,sc);if(!present(val))return undefined
      for(const field of list(spec.lookup)){
        const hits=ofType(provider,canonType(q).type).filter(o=>
          [o.canonical.identifiers[field]?.value,...list(getPath(o.canonical.properties,field))].some(x=>x!=null&&(spec.ci?String(x).toLowerCase()===String(val).toLowerCase():String(x)===String(val))))
        if(hits.length===1){key=hits[0].fixture_key;break}
        if(hits.length>1)return undefined
      }
    }else{
      id=evalExpr(spec.id,sc);if(!present(id))return undefined
      id=normalize(q,id)
      parts=Object.fromEntries(Object.entries(spec.parts??{}).map(([k,x])=>[k,evalExpr(x,sc)]))
      key=aliases.get(legacyKey(q,id,parts,spec.key_template))
      if(!key){const x=resolveTarget(p,q.prof.object_type,id);if(x.status==='resolved')key=x.key}
    }
    if(spec.create&&(spec.create.always||!key)){
      const rule=q.prof.runtime_rules?.find(r=>r.id===spec.create.rule)??q.prof.runtime_rules?.find(r=>r.kind==='object')
      if(!rule)throw Error(`Missing create rule ${spec.type}:${spec.create.rule}`)
      const r=spec.create.record!==undefined?evalExpr(spec.create.record,sc):sc.r
      key=makeObject(q,rule,{r,parent:sc.parent,env:sc.__env})?.key??key
    }
    if(!key&&allowStub&&q.prof.runtime_stub&&present(id))key=makeStub(q,id,parts,spec,sc)
    return key&&objects.has(key)?{key}:undefined
  }
  function makeStub(q,id,parts,spec,sc){
    const prim=q.prof.identity?.primary??[]
    const comps=prim.map(c=>parts[c.name]??(prim.length===1||c.name==='id'?id:undefined))
    if(comps.some(x=>!present(x)))return undefined
    const rec={};for(const [i,c]of prim.entries())rec[c.name]=comps[i]
    const stubP={...q,prof:{...q.prof,identity:{...q.prof.identity,primary:prim.map(c=>({...c,expr:c.name}))},fields:{},vars:{},references:[],relation_plans:[]}}
    const item=emitRecord(stubP,rec,{request:{},params:{},parent_id:null},provenance(sc.__env),{role:'stub'})
    if(!item)return undefined
    const o=objects.get(item.key);o.fixture_meta.stub=true;o.fixture_meta.stub_via='reference in collected response'
    // stub_tenant: 원본 행이 그 대상의 테넌트를 말할 때(예: Slack OAuth 응답의 team_id). 수집한 테넌트면 그것, 아니면 못 푼 참조로 남겨
    // 나중에 provider 의 기본 테넌트가 덮어쓰지 않게 한다 (다른 워크스페이스 채널을 이 워크스페이스 것으로 보지 않는다)
    if(spec.stub_tenant&&!o.canonical.references.tenant){
      const tid=evalExpr(spec.stub_tenant.id,sc),t=present(tid)?resolve(q,{type:spec.stub_tenant.type,id:spec.stub_tenant.id},sc):undefined
      if(t&&t.key!==item.key)o.canonical.references.tenant={kind:'tenant',targets:[ref(t.key)]}
      else if(present(tid))o.canonical.references.tenant={kind:'tenant',targets:[{provider:dash(q.research_provider),object_type:spec.stub_tenant.type,identifier_type:'native',value:String(tid),status:'unresolved',reason:'target_value_not_collected'}]}
    }
    const lk=legacyKey(q,id,parts,spec.key_template)
    aliases.set(lk,item.key)
    o.fixture_meta.im_profile.legacy_keys=[...new Set([...(o.fixture_meta.im_profile.legacy_keys??[]),lk])]
    report.relation_rules.stubs=(report.relation_rules.stubs??0)+1
    return item.key
  }
  function materialized(p,rule,rec,sc,key){
    const o=objects.get(key)
    for(const [k,x]of Object.entries(rule.ctx_set??{}))sc.ctx[k]=evalExpr(x,sc)
    const tenantSpec=rule.tenant==='none'?null:rule.tenant?resolve(p,rule.tenant,sc):resolve(p,'tenant',sc)
    if(tenantSpec&&tenantSpec.key!==key)o.canonical.references.tenant={kind:'tenant',targets:[ref(tenantSpec.key)]}
    if(rule.parent)deferredParents.push({p,rule,rec,key,sc})
    if(rule.refs)deferredRefs.push({p,rule,rec,key,sc})
    if(rule.relations?.length){
      deferredRelations.push({p,rule,rec,key,sc})
      // Explicit create rules establish dependencies immediately (e.g. a bot's app).
      for(const rel of rule.relations)if(!rel.when||evalCond(rel.when,sc)){
        for(const spec of [rel.source,rel.target])if(spec&&typeof spec==='object'&&spec.create)resolve(p,spec,sc)
      }
    }
  }
  function ref(key){const o=objects.get(key);return{provider:o.canonical.provider,object_type:o.canonical.object_type,identifier_type:'primary',value:key}}
  function makeObject(p,rule,rec,group){
    const sc=withVars(p,rule,rec,group)
    if(rule.require&&!evalCond(rule.require,sc))return undefined
    const idRaw=evalExpr(rule.id_expr??'id',sc)
    if(!present(idRaw))return undefined
    const runtimeID=normalize(p,idRaw)
    const rp={...p,prof:{...p.prof,vars:rule.vars??{},identity:{...p.prof.identity,...rule.identity},references:[],relation_plans:[],
      fields:{...p.prof.fields,...Object.fromEntries(Object.entries(rule.properties??{}).filter(([k])=>k!=='...').map(([k,expr])=>[k,{expr}]))}}}
    const ctx={request:rec.env?.request_params??{},params:{},parent:rec.parent,scope:sc}
    const item=emitRecord(rp,rec.r,ctx,provenance(rec.env),{role:'rule'})
    if(!item)return undefined
    sc.self=item.key
    const o=objects.get(item.key)
    if(o.fixture_meta.stub){delete o.fixture_meta.stub;delete o.fixture_meta.stub_via}
    o.fixture_meta.im_profile.runtime_id=runtimeID
    const parts=Object.fromEntries(Object.entries(rule.parts??{}).map(([k,x])=>[k,evalExpr(x,sc)]))
    const lk=legacyKey(p,runtimeID,parts,rule.key_template)
    aliases.set(lk,item.key)
    o.fixture_meta.im_profile.legacy_keys=[...new Set([...(o.fixture_meta.im_profile.legacy_keys??[]),lk])]
    for(const[k,x]of Object.entries(rule.mutable_ids??{})){const v=evalExpr(x,sc);if(v!==undefined)o.canonical.identifiers[k]={value:v,stability:'mutable'}}
    const extra=rule.properties?.['...']?evalExpr(rule.properties['...'],sc):null
    if(extra)Object.assign(o.canonical.properties,scrub(extra,p.prof.privacy,{secrets:0}))
    for(const[k,x]of Object.entries(rule.judged??{})){const v=evalExpr(x,sc);if(v!==undefined)o.canonical.judged[k]=v}
    if(rule.display!==undefined){const d=typeof rule.display==='string'?evalExpr({template:rule.display},sc):evalExpr(rule.display,sc);if(present(d))o.fixture_meta.display_name=String(d)}
    for(const[k,x]of Object.entries(rule.meta??{})){const v=evalExpr(x,sc);if(v!==undefined)o.fixture_meta[k]=v}
    const provider=dash(p.research_provider)
    if(config.providers?.[provider]?.root?.type===p.prof.object_type&&!tenant.has(provider))tenant.set(provider,item.key)
    // 있던 객체에 합쳐지면 객체 수가 그대로여도 속성이 바뀐다. 속성 색인에서 이 객체를 다시 놓는다
    objectWritten(o)
    materialized(p,rule,rec,sc,item.key)
    return item
  }
  function enrich(p,rule,rec,group){
    const sc=withVars(p,rule,rec,group)
    if(rule.require&&!evalCond(rule.require,sc))return
    const target=resolve(p,rule.target,sc)
    const tally=report.relation_rules.enrich[`${p.file}#${rule.id}`]??={units:0,unresolved:0}
    tally.units++
    if(!target){tally.unresolved++;return}
    sc.self=target.key
    const o=objects.get(target.key),props=o.canonical.properties
    for(const[k,x]of Object.entries(rule.set??{})){const v=evalExpr(x,sc);if(v!==undefined)props[k]=scrub(v,p.prof.privacy,{secrets:0})}
    // merge: 객체 값을 같은 속성에 얕게 합친다. 여러 규칙이 한 속성(예: permissions)의 다른 칸을 채울 때 쓴다
    for(const[k,x]of Object.entries(rule.merge??{})){const v=evalExpr(x,sc);if(v&&typeof v==='object'&&!Array.isArray(v))props[k]={...(props[k]&&typeof props[k]==='object'?props[k]:{}),...scrub(v,p.prof.privacy,{secrets:0})}}
    for(const[k,x]of Object.entries(rule.set_if_missing??{})){const v=evalExpr(x,sc);if(v!==undefined&&props[k]===undefined)props[k]=scrub(v,p.prof.privacy,{secrets:0})}
    for(const[k,x]of Object.entries(rule.append??{})){const v=evalExpr(x,sc);const seen=new Set();props[k]=[...list(props[k]),...list(v)].filter(x=>{const s=stable(x);if(seen.has(s))return false;seen.add(s);return true})}
    for(const[k,x]of Object.entries(rule.judged??{})){const v=evalExpr(x,sc);if(v!==undefined)o.canonical.judged[k]=v}
    if(rule.set_display!==undefined){const v=evalExpr(rule.set_display,sc);if(present(v))o.fixture_meta.display_name=String(v)}
    if(rule.observe)pushUnique(o.canonical.source.observations,provenance(rec.env))
    for(const w of [rule.set,rule.merge,rule.set_if_missing,rule.append])for(const k of Object.keys(w??{}))propWritten(o,k)
    materialized(p,rule,rec,sc,target.key)
  }
  report.relation_rules={rules:runtimeProfiles.reduce((n,p)=>n+p.prof.runtime_rules.length,0),units:0,relations:0,unresolved:0,unsupported:[],enrich:{}}
  report.relation_outcomes=[]
  for(const[provider,ps]of rulesByProvider){
    ctxVars.set(provider,{})
    const steps=config.providers?.[provider]?.order??ps.flatMap(p=>p.prof.runtime_rules.filter(r=>!r.on_demand).map(r=>`${p.prof.object_type}.${r.id}`))
    for(const step of steps){
      if(step==='stubs'){
        for(let i=0;i<deferredRelations.length;i++){
          const item=deferredRelations[i];if(dash(item.p.research_provider)!==provider)continue
          for(const rel of item.rule.relations??[])if(rel.stub!==false&&!rel.each&&(!rel.when||evalCond(rel.when,item.sc))){
            resolve(item.p,rel.source,item.sc,!(rel.require??[]).includes('source'))
            resolve(item.p,rel.target,item.sc,!(rel.require??[]).includes('target'))
          }
        }
        continue
      }
      if(step==='root_check'){if(config.providers?.[provider]?.root?.required&&!tenant.has(provider))break;continue}
      const split=step.lastIndexOf('.'),type=step.slice(0,split),id=step.slice(split+1)
      const file=config.profile_files?.[`${provider}:${type}`]
      const p=byFile.get(file)??findProfile(provider,aliasType(provider,type))
      const rule=p?.prof.runtime_rules?.find(r=>r.id===id)
      if(!rule)continue // model non_object and unavailable source types remain excluded
      const us=units(p,rule)
      outcomes.set(`${p.file}#${id}`,us.length)
      for(const{rec,group}of us){
        report.relation_rules.units++
        const ob=provenance(rec.env);observations.set(stable(ob),ob)
        if(rule.kind==='object')makeObject(p,rule,rec,group)
        else if(rule.kind==='enrich')enrich(p,rule,rec,group)
        else{
          const sc=withVars(p,rule,rec,group)
          if(rule.require&&!evalCond(rule.require,sc))continue
          for(const[k,x]of Object.entries(rule.ctx_set??{}))sc.ctx[k]=evalExpr(x,sc)
          deferredRelations.push({p,rule,rec,sc})
        }
      }    }
  }
  // Resolve after all object rules, so a late target does not depend on provider file ordering.
  for(let i=0;i<deferredRefs.length;i++){
    const{p,rule,rec,key,sc}=deferredRefs[i],o=objects.get(key)
    for(const[name,entries]of Object.entries(rule.refs??{})){
      const targets=[]
      for(const entry of list(entries))for(const item of entry.each!==undefined?list(evalExpr(entry.each,sc)):[undefined]){
        const s=item===undefined?sc:{...sc,item}
        if(entry.when&&!evalCond(entry.when,s))continue
        const value=entry.value!==undefined?evalExpr(entry.value,s):undefined
        const x=entry.ref?resolve(p,entry.ref,s):undefined
        if(x&&!entry.external){targets.push(ref(x.key));sc.vars[`@${name}`]=x}
        else if(present(value)&&(entry.external||entry.external_if_missing||entry.key_if_exists))targets.push({provider:dash(p.research_provider),object_type:entry.type??'unknown',identifier_type:'native',value,status:entry.external||entry.external_if_missing?'external':'uncollected'})
      }
      if(targets.length)o.canonical.references[name]={kind:targets.some(t=>t.status==='external')?'external_locator':'direct_id',targets}
    }
  }
  for(const{p,rule,rec,key,sc}of deferredParents){
    const x=resolve(p,rule.parent.ref,sc,rule.parent.when==='stub')
    if(x&&x.key!==key)objects.get(key).canonical.references.parent={kind:'parent',targets:[ref(x.key)]}
  }
  for(let i=0;i<deferredRelations.length;i++){
    const{p,rule,rec,sc}=deferredRelations[i]
    for(const rel of rule.relations??[])for(const item of rel.each!==undefined?list(evalExpr(rel.each,sc)):[undefined]){
      const s=item===undefined?sc:{...sc,item}
      if(rel.when&&!evalCond(rel.when,s))continue
      const need=rel.require??[],a=resolve(p,rel.source,s,rel.stub!==false&&!need.includes('source')),b=resolve(p,rel.target,s,rel.stub!==false&&!need.includes('target'))
      const role=rel.role?.ref?resolve(p,rel.role.ref,s,rel.role.stub===true):undefined,name=rel.role?.name!==undefined?evalExpr(rel.role.name,s):undefined
      if(!a||!b||(rel.role&&!role&&!present(name))){
        const missing=!a?'source':!b?'target':'role',spec=missing==='source'?rel.source:missing==='target'?rel.target:rel.role?.ref
        const classification=classifyMissingRelationTarget(spec,s,{evalExpr,present,hasTenant:present(tenant.get(dash(p.research_provider)))})
        const outcome={profile:p.file,rule:rule.id,type:rel.type,missing,classification}
        report.relation_outcomes.push(outcome)
        if(classification!=='reference_value_not_provided'){report.relation_rules.unresolved++;report.relations_unresolved.push(outcome)}
        continue
      }
      const props={}
      if(rel.properties&&(!rel.props_when||evalCond(rel.props_when,s)))for(const[k,x]of Object.entries(rel.properties)){const v=evalExpr(x,s);if(k==='...')Object.assign(props,v);else if(v!==undefined)props[k]=v}
      const basis=['stated','computed','flag'].includes(rel.basis)?rel.basis:evalExpr(rel.basis,s)
      addRelation(p,rel.type,a.key,b.key,provenance(rec.env),{basis,properties:{...scrub(props,p.prof.privacy,{secrets:0}),...enforcedOf(rel)},role:role?{key:role.key}:present(name)?{name:String(name)}:undefined,rule:rule.id})
      report.relation_rules.relations++
    }
  }
  return {aliases,observations:[...observations.values()],outcomes:Object.fromEntries(outcomes),usedPages:[...usedPages],totalPages:[...envs.values()].reduce((n,a)=>n+a.length,0)}
}
