import {sha256Hex} from '../lib/sanitize'

/** Persist display paths, without creating canonical authorization relations. */
export function attachMediatedServicePaths(objects:any[],relations:any[]) {
  const byKey=new Map(objects.map(o=>[o.fixture_key,o])),unresolved:any[]=[]
  let resolved=0
  for(const worker of objects.filter(o=>o.canonical.provider==='worker'&&o.canonical.object_type==='WorkerScript')){
    const p=worker.canonical.properties,paths:any[]=[]
    if(!Array.isArray(p.relay_routes)||!p.source_sha256)continue
    const bindings=p.relay_bindings??{}
    p.presentation_role='intermediary'
    for(const route of p.relay_routes){
      const ingress=(p.routes??[]).find((r:any)=>`${r.method} ${r.path}`===route.route)
      if(!ingress)continue
      const incoming=relations.filter(r=>r.canonical.relation_type==='triggered_by'&&r.canonical.references.source.value===worker.fixture_key)
        .map(r=>({r,source:byKey.get(r.canonical.references.target.value)}))
        .filter(({source})=>source&&source.canonical.provider!=='worker'&&source.canonical.properties.url_sha256===ingress.url_sha256)
      let targets:any[]=[]
      if(route.provider==='github'&&route.operation==='contents.update'){
        const repo=bindings[route.bindings.repository]
        if(typeof repo==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))targets=objects.filter(o=>o.canonical.provider==='github'&&o.canonical.object_type==='Repository'&&String(o.canonical.properties.full_name??'').toLowerCase()===repo.toLowerCase())
      }
      if(route.provider==='okta'&&route.operation==='users.reset_factors'){
        const user=bindings[route.bindings.user],origin=bindings[route.bindings.origin]
        try{
          const url=new URL(origin)
          if(typeof user==='string'&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&url.pathname==='/')targets=objects.filter(o=>o.canonical.provider==='okta'&&o.canonical.object_type==='User'&&String(o.canonical.properties.id??o.canonical.identifiers?.id?.value)===user&&(o.canonical.source?.observations??[]).some((obs:any)=>{try{return new URL(obs.api).origin===url.origin}catch{return false}}))
        }catch{/* unresolved origin remains unconnected */}
      }
      if(targets.length!==1||incoming.length!==1){unresolved.push({worker:worker.fixture_key,route:route.route,reason:targets.length>1||incoming.length>1?'ambiguous':'missing_source_or_target'});continue}
      const {r,source}=incoming[0],target=targets[0]
      paths.push({id:'service-path:'+sha256Hex([source.fixture_key,worker.fixture_key,route.route,target.fixture_key,route.operation].join('|')).slice(0,24),source_object_key:source.fixture_key,target_object_key:target.fixture_key,operation:route.operation,method:route.method,evidence:'stated',assertion:'configured_code_path',via:{object_key:worker.fixture_key,route:route.route,source_sha256:p.source_sha256,handler:route.handler},source_relation_keys:[r.fixture_key],conditions:{workspace:bindings.SLACK_TEAM_ID,channel:bindings[route.provider==='github'?'DEVBOT_CHANNEL_ID':'HELPDESK_CHANNEL_ID'],execution_status:'not_established_by_configuration'}})
      resolved++
    }
    p.mediated_service_paths=paths
  }
  return {resolved,unresolved}
}

/**
 * Worker 코드가 거르는 호출 채널(invoker_gates)을 그 경로를 부르는 입구(슬래시 명령 엔드포인트)에 적는다.
 * 바인딩 값이 수집된 채널 하나로 풀릴 때만 적는다. 못 풀면 적지 않아 엔진은 그대로 「호출 제한 미확인」이다.
 */
export function attachInvokerGates(objects:any[],relations:any[]) {
  const byKey=new Map(objects.map(o=>[o.fixture_key,o])),unresolved:any[]=[]
  let resolved=0
  for(const worker of objects.filter(o=>o.canonical.provider==='worker'&&o.canonical.object_type==='WorkerScript')){
    const p=worker.canonical.properties
    if(!Array.isArray(p.invoker_gates)||!p.source_sha256)continue
    const bindings=p.relay_bindings??{}
    for(const gate of p.invoker_gates){
      const ingress=(p.routes??[]).find((r:any)=>`${r.method} ${r.path}`===gate.route)
      const incoming=ingress?relations.filter(r=>r.canonical.relation_type==='triggered_by'&&r.canonical.references.source.value===worker.fixture_key)
        .map(r=>byKey.get(r.canonical.references.target.value))
        .filter(s=>s&&s.canonical.provider==='slack'&&s.canonical.properties.url_sha256===ingress.url_sha256):[]
      const value=bindings[gate.binding]
      const channels=typeof value==='string'&&value?objects.filter(o=>o.canonical.provider==='slack'&&o.canonical.object_type==='conversation'&&String(o.canonical.identifiers?.id?.value)===value&&!o.fixture_meta?.stub):[]
      if(gate.kind!=='request_channel'||!incoming.length||channels.length!==1){unresolved.push({worker:worker.fixture_key,route:gate.route,reason:!incoming.length?'no_entry_point':typeof value!=='string'||!value?'binding_unset':'channel_not_collected'});continue}
      for(const endpoint of incoming){
        endpoint.canonical.properties.invoker_gate={kind:'channel_membership',channels:[channels[0].fixture_key],basis:'code',
          via:{object_key:worker.fixture_key,route:gate.route,handler:gate.handler,binding:gate.binding,source_sha256:p.source_sha256}}
        resolved++
      }
    }
  }
  return {resolved,unresolved}
}
