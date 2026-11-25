import type {GraphStore,GraphStoreV2} from '../model/graph'

/** Adapter-computed presentation records already persisted on intermediary objects in D1. */
export interface ServicePath {
  id:string
  source_object_key:string
  target_object_key:string
  operation:string
  method:string
  evidence:'stated'
  assertion:'configured_code_path'
  via:{object_key:string;route:string;source_sha256:string;handler:string}
  source_relation_keys:string[]
  conditions:{execution_status:string;workspace?:string;channel?:string}
}
export function persistedServicePaths(graph:GraphStore|GraphStoreV2):ServicePath[]{
  const paths:ServicePath[]=[],seen=new Set<string>()
  for(const o of graph.objectsByKey.values()){
    if(o.canonical.properties.presentation_role!=='intermediary')continue
    const rows=o.canonical.properties.mediated_service_paths
    if(!Array.isArray(rows))continue
    for(const p of rows){
      if(!p||typeof p!=='object'||typeof p.id!=='string'||seen.has(p.id)||p.assertion!=='configured_code_path'||p.evidence!=='stated'||p.via?.object_key!==o.fixture_key||typeof p.via?.route!=='string'||typeof p.via?.source_sha256!=='string'||!graph.objectsByKey.has(p.source_object_key)||!graph.objectsByKey.has(p.target_object_key)||typeof p.operation!=='string'||!Array.isArray(p.source_relation_keys))continue
      paths.push(p as ServicePath);seen.add(p.id)
    }
  }
  return paths
}
