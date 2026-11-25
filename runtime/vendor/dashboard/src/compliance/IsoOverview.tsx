import iso from './iso27001.snapshot.json'
import type { StandardResults } from '../config-findings/standardResultsStore'
import type { GraphStoreV2 } from '../model/graph'
import { buildFramework } from './frameworkModel'
import FrameworkView from './FrameworkView'
import type { ComplianceExceptionsApi } from './useComplianceExceptions'

export function IsoOverview({ results, graph, onOpenObject, exceptions }: { results: StandardResults | undefined; graph: GraphStoreV2; onOpenObject?: (key: string) => void; exceptions?: ComplianceExceptionsApi }) {
  return <FrameworkView
    framework={buildFramework('iso27001')}
    results={results}
    graph={graph}
    onOpenObject={onOpenObject}
    exceptions={exceptions}
    controlExtras={() => <p className="comp-iso-note">{iso.note}</p>}
  />
}
