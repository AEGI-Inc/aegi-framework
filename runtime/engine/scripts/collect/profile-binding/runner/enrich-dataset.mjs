// Shared ontology/evidence processing on the already normalized new Profile output.
// This does not invoke a SaaS normalizer or create objects from legacy catalog rules.
export async function enrichDataset({ tsImport, raw, objects, relations, profiles, config }) {
  const [{DatasetV2},{NormalizeContext},{buildIdentityLinksV2},{buildObservations},{applyG4Judgments},{INTERFACE_CONTRACT_VALUES}] = await Promise.all([
    tsImport('../../shared/dataset.ts',import.meta.url),
    tsImport('../../shared/context.ts',import.meta.url),
    tsImport('../../shared/identity.ts',import.meta.url),
    tsImport('../../shared/observations.ts',import.meta.url),
    tsImport('../../shared/judgments.ts',import.meta.url),
    tsImport('../../../../src/model/object.ts',import.meta.url),
  ])
  const memlog = label => { if (!process.env.AEGI_NORMALIZE_MEMLOG) return; globalThis.gc?.(); console.error(`[mem] enrich.${label} heap ${(process.memoryUsage().heapUsed / 1e9).toFixed(2)}GB at ${Math.round(process.uptime())}s`) }
  const ds=new DatasetV2()
  const toLegacy=new Map(),toNew=new Map(),typeNames=new Map()
  for(const[k,v]of Object.entries(config.aliases??{})){const i=k.indexOf(':'),provider=k.slice(0,i),legacy=k.slice(i+1);typeNames.set(`${provider}:${v}`,legacy)}
  const direct=new Set(['expires_at','origin','activation','assignment_count'])
  for(const o of objects.values()){
    const m=o.fixture_meta.im_profile,c=o.canonical
    const key=m.legacy_keys?.[0]??o.fixture_key
    toLegacy.set(o.fixture_key,key)
    for(const alias of [key,...(m.legacy_keys??[]),o.fixture_key]){
      if(toNew.has(alias)&&toNew.get(alias)!==o.fixture_key)throw Error('Ambiguous compatibility key for two normalized objects')
      toNew.set(alias,o.fixture_key)
    }
    const copy=structuredClone(o);copy.fixture_key=key
    copy.canonical.object_type=typeNames.get(`${c.provider}:${c.object_type}`)??c.object_type
    copy.canonical.identifiers.id={value:m.runtime_id??c.identifiers[c.identifiers.primary[0]].value,stability:'stable'}
    for(const field of Object.keys(INTERFACE_CONTRACT_VALUES))if(!direct.has(field)&&copy.canonical.properties[field]!==undefined){
      const v=copy.canonical.properties[field];if(copy.canonical.judged[field]===undefined||copy.canonical.judged[field]==='unknown')copy.canonical.judged[field]=v
      delete copy.canonical.properties[field]
    }
    ds.objects.set(key,copy)
  }
  const visit=(v,fn)=>Array.isArray(v)?v.map(x=>visit(x,fn)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x,fn)])):typeof v==='string'?fn(v):v
  for(const o of ds.objects.values())o.canonical.references=visit(o.canonical.references,x=>toLegacy.get(x)??x)
  const get=ds.get.bind(ds)
  ds.get=k=>get(toLegacy.get(toNew.get(k))??k)
  ds.has=k=>!!ds.get(k)
  ds.typeOf=k=>ds.get(k)?.canonical.object_type
  for(const r of relations.values()){
    const c=r.canonical,a=toLegacy.get(c.references.source.value),b=toLegacy.get(c.references.target.value)
    const role=c.references.role
    ds.addRelation({provider:c.provider,type:c.relation_type,source:a,target:b,basis:c.properties.basis,
      ...(role?{role:objects.has(role.value)?{key:toLegacy.get(role.value)}:{name:String(role.value)}}:{}),
      properties:visit(Object.fromEntries(Object.entries(c.properties).filter(([k])=>k!=='basis')),x=>toLegacy.get(x)??x),obs:c.source})
  }
  memlog('copied')
  const ctx=new NormalizeContext({})
  // Evidence helpers consume a canonical email index, rather than re-normalizing raw users.
  const gwsUsers=[...ds.objects.values()].filter(o=>o.canonical.provider==='gws'&&o.canonical.object_type==='User')
  ctx.gws={userByEmail:new Map(gwsUsers.flatMap(o=>[o.canonical.properties.primaryEmail,...(o.canonical.properties.aliases??[])].filter(x=>typeof x==='string').map(x=>[x.toLowerCase(),o.fixture_key]))),customerKey:[...ds.objects.values()].find(o=>o.canonical.provider==='gws'&&o.canonical.object_type==='Customer')?.fixture_key}
  const all=[...ds.objects.values()]
  ctx.github={byLogin:new Map(all.filter(o=>o.canonical.provider==='github'&&o.canonical.object_type==='User Account').map(o=>[String(o.canonical.properties.login??''),o.fixture_key])),repoByName:new Map(all.filter(o=>o.canonical.provider==='github'&&o.canonical.object_type==='Repository').map(o=>[String(o.canonical.properties.name??''),o.fixture_key])),orgKey:all.find(o=>o.canonical.provider==='github'&&o.canonical.object_type==='Organization')?.fixture_key}
  ctx.slack={userByEmail:new Map(all.filter(o=>o.canonical.provider==='slack'&&o.canonical.object_type==='user'&&o.canonical.properties.email).map(o=>[String(o.canonical.properties.email).toLowerCase(),o.fixture_key])),botUserToBot:new Map(all.filter(o=>o.canonical.provider==='slack'&&o.canonical.object_type==='bot'&&o.canonical.properties.bot_user_id).map(o=>[String(o.canonical.properties.bot_user_id),o.fixture_key]))}
  ctx.okta={userByLogin:new Map(all.filter(o=>o.canonical.provider==='okta'&&o.canonical.object_type==='User').map(o=>[String(o.canonical.properties.login??''),o.fixture_key])),appsByName:new Map()}
  buildIdentityLinksV2(ds,ctx,raw)
  memlog('identity')
  applyG4Judgments(ds)
  buildObservations(raw,ds,ctx)
  memlog('observations')
  for(const [key,o]of ds.objects){
    const current=objects.get(toNew.get(key));current.canonical.judged=o.canonical.judged;current.canonical.properties=o.canonical.properties
  }
  const back=v=>visit(v,x=>toNew.get(x)??x)
  const enrichedRelations=ds.relations().map(r=>{
    r=back(r)
    for(const side of ['source','target','role']){
      const ref=r.canonical.references[side],o=ref&&objects.get(ref.value)
      if(o){ref.object_type=o.canonical.object_type;ref.provider=o.canonical.provider;ref.identifier_type='primary'}
    }
    return r
  })
  return {relations:enrichedRelations,links:back(ds.links),observations:back(ds.observations),evidenceLinks:back(ds.evidenceLinks),notes:ds.notes}
}

