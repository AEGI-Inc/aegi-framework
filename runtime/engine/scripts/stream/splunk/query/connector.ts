import { pathToFileURL } from 'node:url'
export { runConnector, CONNECTOR_VERSION, type ConnectorOptions } from './connectorLoop.ts'
export { controlBase, claimJobDir, servicesFromEnv, serviceFromEnv, graphIndexFrom, readEnvFile, loadConnectorEnv } from './services.ts'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  import('./runtime.ts').then(m => m.startRuntime('connector')).catch(e => { console.error('[connector] stopped:', e.message); process.exitCode = 1 })
}
