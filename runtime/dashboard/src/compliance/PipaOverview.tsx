import type { StandardResults } from '../config-findings/standardResultsStore'
import type { GraphStoreV2 } from '../model/graph'
import { buildFramework } from './frameworkModel'
import FrameworkView from './FrameworkView'
import type { ComplianceExceptionsApi } from './useComplianceExceptions'

export function PipaOverview({ results, graph, onOpenObject, exceptions }: { results: StandardResults | undefined; graph: GraphStoreV2; onOpenObject?: (key: string) => void; exceptions?: ComplianceExceptionsApi }) {
  return <FrameworkView
    framework={buildFramework('pipa')}
    results={results}
    graph={graph}
    onOpenObject={onOpenObject}
    exceptions={exceptions}
    head={<button type="button" className="ex-btn" onClick={() => { window.location.hash = '#compliance?standard=pipa' }}>PIPA 검사 설정 초안 열기</button>}
  />
}
