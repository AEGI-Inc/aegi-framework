import { pathToFileURL } from 'node:url'
export { createGateway, GATEWAY_VERSION } from './gateway.ts'
export { handleRequest } from './handler.ts'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  import('./runtime.ts').then(m => m.startRuntime('gateway')).catch(e => { console.error('[gateway] stopped:', e.message); process.exitCode = 1 })
}
