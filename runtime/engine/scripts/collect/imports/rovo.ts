import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {CollectStore, type Envelope, type RunRecord} from '../lib/store'
import {sha256Hex} from '../lib/sanitize'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SERVICES=new Set(['github','gws','salesforce','slack'])
export function projectRovoUiEvidence(input:any) {
  if(input?.format!=='aegi-rovo-ui-evidence/1'||input.source!=='browser_ui'||!UUID.test(input.organization_id??'')||!Number.isFinite(Date.parse(input.captured_at)))throw new Error('Invalid Rovo UI evidence header')
  if(!Array.isArray(input.connectors)||input.connectors.length>1000)throw new Error('Invalid connector list')
  const org=input.organization_id.toLowerCase(),seen=new Set<string>()
  const connectors=input.connectors.map((r:any)=>{
    if(!UUID.test(r.id??'')||!SERVICES.has(r.service))throw new Error('Invalid connector identity')
    const id=r.id.toLowerCase();if(seen.has(id))throw new Error('Duplicate connector identity');seen.add(id)
    const source=new URL(r.source_url)
    if(source.protocol!=='https:'||source.hostname!=='admin.atlassian.com'||source.port||source.username||source.password||source.search||source.hash||source.pathname.toLowerCase()!==`/o/${org}/connectors/${id}`)throw new Error('Connector source does not match organization and identity')
    let domain:string|undefined
    if(r.target_domain!==undefined){
      if(r.service!=='salesforce'||typeof r.target_domain!=='string')throw new Error('Unsupported target field')
      const target=new URL(r.target_domain.includes('://')?r.target_domain:`https://${r.target_domain}`)
      if(target.protocol!=='https:'||target.username||target.password||target.port||target.search||target.hash||target.pathname!=='/'||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(target.hostname))throw new Error('Invalid target domain')
      domain=target.hostname.toLowerCase()
    }
    if(!Array.isArray(r.tools)||r.tools.length>2000)throw new Error('Invalid tool list')
    const tools=r.tools.map((t:any)=>{
      if(typeof t.name!=='string'||!t.name.trim()||t.name.length>200)throw new Error('Invalid tool name')
      return {name:t.name,operation:['read','write'].includes(t.operation)?t.operation:'unknown',state:['enabled','disabled'].includes(t.state)?t.state:'unknown'}
    })
    const oauthClient=r.service==='gws'&&typeof r.oauth_client_id==='string'&&/^[0-9]{10,30}$/.test(r.oauth_client_id)?r.oauth_client_id:undefined
    const scopes=r.service==='gws'&&Array.isArray(r.oauth_scopes)?r.oauth_scopes.filter((s:unknown)=>typeof s==='string'&&/^https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._-]+$/.test(s)):undefined
    const workspaceLabel=r.service==='slack'&&typeof r.workspace_label==='string'?r.workspace_label.slice(0,200):undefined
    return {id,service:r.service,indexing:['enabled','disabled'].includes(r.indexing)?r.indexing:'unknown',operational_state:'unknown',source_url:source.href,target_salesforce_domain:domain,oauth_client_id:oauthClient,oauth_scopes:scopes,workspace_label:workspaceLabel,tools}
  })
  return {organization_id:org,captured_at:new Date(input.captured_at).toISOString(),source:'browser_ui',connectors}
}

/** Import measured browser evidence, explicitly without pretending an API request was made. */
export function importRovoUiEvidence(input:any,store:CollectStore):Envelope {
  const payload=projectRovoUiEvidence(input),at=payload.captured_at,hash=sha256Hex(JSON.stringify(payload))
  const env:Envelope={provider:'atlassian',call_id:'AT-UI-01',page:1,method:'BROWSER_UI',endpoint:`https://admin.atlassian.com/o/${payload.organization_id}/connectors`,request_params:{kind:'rovo_connector_ui',collection_method:'browser_ui',organization:payload.organization_id},collected_at:at,http_status:0,response_sha256:sha256Hex(JSON.stringify(input)),payload_sha256:hash,collector_version:'rovo-ui-import/1',credential_ref:'BROWSER_SESSION',sanitization:{secrets:0,content_fields:0,dropped_fields:0,correlation_ids:0},payload}
  const record:RunRecord={run_id:store.runId,collector_version:env.collector_version,started_at:at,finished_at:at,args:{import:'browser_ui',not_api_inventory:true},period:{since:at,until:at},calls:[{run_id:store.runId,call_id:env.call_id,provider:'atlassian',title:'Measured Rovo connector UI evidence',started_at:at,finished_at:at,pages:1,record_count:payload.connectors.length,completeness:'best_effort',reasons:['ui_snapshot_not_api_inventory'],notes:['http_status=0 means no HTTP response claimed; original source and capture time are retained']}]}
  store.writeRaw(env);store.writeRun(record);return env
}

export function isRovoUiEnvelope(env:any):boolean {
  try {
    if(env?.provider!=='atlassian'||env.call_id!=='AT-UI-01'||env.method!=='BROWSER_UI'||env.http_status!==0||env.collector_version!=='rovo-ui-import/1'||env.credential_ref!=='BROWSER_SESSION'||env.request_params?.kind!=='rovo_connector_ui'||env.request_params?.collection_method!=='browser_ui')return false
    const p=env.payload
    const projected=projectRovoUiEvidence({format:'aegi-rovo-ui-evidence/1',...p,connectors:p.connectors.map((c:any)=>({...c,target_domain:c.target_salesforce_domain}))})
    return env.endpoint===`https://admin.atlassian.com/o/${projected.organization_id}/connectors`&&env.request_params.organization===projected.organization_id&&env.collected_at===projected.captured_at&&env.payload_sha256===sha256Hex(JSON.stringify(p))&&JSON.stringify(projected)===JSON.stringify(p)
  }catch{return false}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [input,root,run]=process.argv.slice(2)
  if(!input||!root||!run)throw new Error('Usage: tsx scripts/collect/imports/rovo.ts <evidence.json> <raw-root> <new-run-id>')
  if(!/^[A-Za-z0-9_-]+$/.test(run)||fs.existsSync(path.join(root,'runs',run+'.json'))||fs.existsSync(path.join(root,'raw',run)))throw new Error('New run ID required')
  const env=importRovoUiEvidence(JSON.parse(fs.readFileSync(input,'utf8')),new CollectStore(root,run))
  console.log(JSON.stringify({run,source:'browser_ui',connectors:(env.payload as any).connectors.length,completeness:'best_effort'}))
}
