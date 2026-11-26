import ts from 'typescript'
import { sha256Hex } from './sanitize'
import {workerModules} from './worker-source'
import {summarizeWorkerRelayRoutes,summarizeWorkerSlashGates,RELAY_PUBLIC_BINDINGS} from './worker-relay'

/** Parse deployed code as data. Resolve only literal method/path switch cases; never execute source. */
export function summarizeWorkerSource(body: unknown, baseUrl: string): any {
  const scripts = workerModules(body)
  const routes = new Map<string, { method: string; path: string; url_sha256: string }>()
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') return { status: 'invalid_base_url' }
  for (const source of scripts) {
    const file = ts.createSourceFile('worker.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const declarations = new Map<ts.Node, Map<string, ts.Expression>>()
    const scope = (node: ts.Node): ts.Node => { let p = node.parent; while (p && !ts.isBlock(p) && !ts.isSourceFile(p)) p = p.parent; return p ?? file }
    const scan = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) && ts.isIdentifier(node.name) && node.initializer) {
        const parent = scope(node); if (!declarations.has(parent)) declarations.set(parent, new Map()); declarations.get(parent)!.set(node.name.text, node.initializer)
      }
      ts.forEachChild(node, scan)
    }
    scan(file)
    const walk = (node: ts.Node) => {
      if (ts.isSwitchStatement(node) && ts.isIdentifier(node.expression)) {
        let p: ts.Node | undefined = node.parent, initializer: ts.Expression | undefined
        while (p && !initializer) { initializer = declarations.get(p)?.get(node.expression.text); p = p.parent }
        const fields = new Set<string>()
        const inspect = (n: ts.Node) => { if (ts.isPropertyAccessExpression(n)) fields.add(n.name.text); ts.forEachChild(n, inspect) }
        if (initializer) inspect(initializer)
        if (initializer && ts.isTemplateExpression(initializer) && fields.has('method') && fields.has('pathname')) {
          for (const c of node.caseBlock.clauses) if (ts.isCaseClause(c) && ts.isStringLiteral(c.expression)) {
            const match = c.expression.text.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/[^\s?#]*)$/)
            if (!match || match[2].startsWith('//')) continue
            const url = new URL(match[2], base)
            if (url.origin !== base.origin) continue
            routes.set(c.expression.text, { method: match[1], path: match[2], url_sha256: sha256Hex(url.href) })
          }
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(file)
  }
  const values = [...routes.values()].sort((a,b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`))
  return { status: scripts.length ? 'parsed_literal_routes' : 'source_unavailable', source_sha256: sha256Hex(scripts.join('\n')), routes: values, ingress_post_sha256: values.filter(r => r.method === 'POST').map(r => r.url_sha256), relay_routes:summarizeWorkerRelayRoutes(body,values.map(r=>`${r.method} ${r.path}`)), invoker_gates:summarizeWorkerSlashGates(body,values.map(r=>`${r.method} ${r.path}`)), dynamic_routes: 'not_resolved' }
}

export function summarizeWorkerSettings(body: any): any {
  return { settings: { bindings: (body?.result?.bindings ?? []).map((b: any) => ({ name: b.name, type: b.type })), relay_bindings:Object.fromEntries((body?.result?.bindings??[]).filter((b:any)=>b.type==='plain_text'&&RELAY_PUBLIC_BINDINGS.has(b.name)&&typeof b.text==='string').map((b:any)=>[b.name,b.text])) } }
}
