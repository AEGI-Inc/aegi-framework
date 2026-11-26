import ts from 'typescript'
import {workerModules} from './worker-source'

export interface RelayRoute {
  route: string
  handler: string
  provider: 'github'|'okta'
  operation: 'contents.update'|'users.reset_factors'
  method: 'PUT'|'POST'
  bindings: Record<string,string>
}
const visit=(n:ts.Node,fn:(n:ts.Node)=>void)=>{fn(n);ts.forEachChild(n,c=>visit(c,fn))}
const unwrap=(e:ts.Expression):ts.Expression=>ts.isCallExpression(e)&&ts.isIdentifier(e.expression)&&e.expression.text==='__name'?e.arguments[0]:e
const prop=(n:ts.Node|undefined,name:string):ts.Expression|undefined=>{
  if(!n||!ts.isObjectLiteralExpression(n))return undefined
  const p=n.properties.find(p=>(ts.isPropertyAssignment(p)||ts.isShorthandPropertyAssignment(p))&&p.name.getText().replace(/^['"]|['"]$/g,'')===name)
  return p&&ts.isPropertyAssignment(p)?p.initializer:p&&ts.isShorthandPropertyAssignment(p)?p.name:undefined
}
const text=(n:ts.Node|undefined)=>n?.getText().replace(/\s+/g,'')??''
const envBinding=(n:ts.Node|undefined,env:string)=>n&&ts.isPropertyAccessExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text===env?n.name.text:undefined
const calls=(n:ts.Node)=>{const list:ts.CallExpression[]=[];visit(n,m=>{if(ts.isCallExpression(m))list.push(m)});return list}
const declarations=(n:ts.Node)=>{const vars=new Map<string,ts.Expression>();visit(n,m=>{if(ts.isVariableDeclaration(m)&&ts.isIdentifier(m.name)&&m.initializer)vars.set(m.name.text,m.initializer)});return vars}
const named=(c:ts.CallExpression,name:string)=>text(c.expression)===name

/** Bounded recognizers for configured code paths, never an execution or authorization claim. */
export function summarizeWorkerRelayRoutes(body:unknown,admittedRoutes:string[]):RelayRoute[] {
  const results:RelayRoute[]=[]
  for(const source of workerModules(body)){
    const file=ts.createSourceFile('worker.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
    const functions=new Map<string,ts.FunctionLikeDeclaration>(),classes=new Map<string,ts.ClassLikeDeclaration>()
    visit(file,n=>{
      if(ts.isFunctionDeclaration(n)&&n.name)functions.set(n.name.text,n)
      if(ts.isClassDeclaration(n)&&n.name)classes.set(n.name.text,n)
      if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer){const v=unwrap(n.initializer);if(ts.isArrowFunction(v)||ts.isFunctionExpression(v))functions.set(n.name.text,v);if(ts.isClassExpression(v))classes.set(n.name.text,v)}
    })
    const githubHelper=(fn:ts.FunctionLikeDeclaration)=>{
      const opts=fn.parameters[0]?.name.getText(),vars=declarations(fn)
      return calls(fn).some(c=>{
        if(!named(c,'fetch')||!c.arguments[0]||!ts.isIdentifier(c.arguments[0]))return false
        const u=vars.get(c.arguments[0].text),method=prop(c.arguments[1],'method')
        return method&&ts.isStringLiteral(method)&&method.text==='PUT'&&text(u)===`\`https://api.github.com/repos/\${${opts}.repo}/contents/\${${opts}.path}\``
      })
    }
    const oktaClient=(name:string)=>{
      const cl=classes.get(name);if(!cl)return false
      const request=cl.members.find((m):m is ts.MethodDeclaration=>ts.isMethodDeclaration(m)&&text(m.name)==='request')
      if(!request)return false
      const [method,path]=request.parameters.map(p=>p.name.getText()),vars=declarations(request)
      return calls(request).some(c=>named(c,'fetch')&&c.arguments[0]&&ts.isIdentifier(c.arguments[0])&&text(vars.get(c.arguments[0].text))===`\`\${this.app.orgUrl}\${${path}}\``&&text(prop(c.arguments[1],'method'))===method)
    }
    visit(file,n=>{
      if(!ts.isCaseClause(n)||!ts.isStringLiteral(n.expression)||!admittedRoutes.includes(n.expression.text))return
      for(const dispatch of calls(n)){
        if(!ts.isIdentifier(dispatch.expression)||dispatch.arguments.length!==5||!ts.isIdentifier(dispatch.arguments[4]))continue
        const wrapper=functions.get(dispatch.expression.text),callback=functions.get(dispatch.arguments[4].text)
        if(!wrapper||!callback)continue
        const run=wrapper.parameters[4]?.name.getText()
        if(!calls(wrapper).some(c=>named(c,run)&&c.arguments.length>=2))continue
        const env=callback.parameters[1]?.name.getText();if(!env)continue
        const vars=declarations(callback)
        for(const c of calls(callback)){
          if(ts.isIdentifier(c.expression)){
            const helper=functions.get(c.expression.text),arg=c.arguments[0]
            const repo=envBinding(prop(arg,'repo'),env),fileBinding=envBinding(prop(arg,'path'),env)
            if(helper&&repo&&fileBinding&&githubHelper(helper))results.push({route:n.expression.text,handler:dispatch.arguments[4].text,provider:'github',operation:'contents.update',method:'PUT',bindings:{repository:repo,file:fileBinding}})
          }
          if(ts.isPropertyAccessExpression(c.expression)&&c.expression.name.text==='request'&&ts.isIdentifier(c.expression.expression)&&c.arguments.length>=2){
            const client=vars.get(c.expression.expression.text),method=c.arguments[0],pathArg=c.arguments[1]
            if(!client||!ts.isNewExpression(client)||!ts.isIdentifier(client.expression)||!oktaClient(client.expression.text)||!ts.isStringLiteral(method)||method.text!=='POST'||!ts.isIdentifier(pathArg))continue
            const path=vars.get(pathArg.text),origin=envBinding(prop(client.arguments?.[0],'orgUrl'),env)
            if(!origin||!path||!ts.isTemplateExpression(path)||path.head.text!=='/api/v1/users/'||path.templateSpans.length!==1||path.templateSpans[0].literal.text!=='/lifecycle/reset_factors')continue
            const user=envBinding(path.templateSpans[0].expression,env)
            if(user)results.push({route:n.expression.text,handler:dispatch.arguments[4].text,provider:'okta',operation:'users.reset_factors',method:'POST',bindings:{origin,user}})
          }
        }
      }
    })
  }
  return results.filter((r,i,a)=>a.findIndex(x=>JSON.stringify(x)===JSON.stringify(r))===i)
}

export const RELAY_PUBLIC_BINDINGS=new Set(['DEVBOT_REPO','DEVBOT_FILE','OKTA_ORG_URL','OKTA_TARGET_USER_ID','DEVBOT_CHANNEL_ID','HELPDESK_CHANNEL_ID','SLACK_TEAM_ID'])

export interface SlashInvokerGate {
  route: string
  handler: string
  /** 요청이 온 채널(Slack 슬래시 명령의 channel_id)이 바인딩 값과 다르면 일을 하기 전에 돌려보낸다 */
  kind: 'request_channel'
  binding: string
  /** 바인딩이 비었을 때: deny(전부 거부, `!env.X || ...` 또는 조건 없이 비교) · allow(검사 안 함, `env.X && ...`) */
  when_unset: 'deny'|'allow'
}
const strip=(e:ts.Expression):ts.Expression=>ts.isParenthesizedExpression(e)?strip(e.expression):e
const isOp=(e:ts.Expression,op:ts.SyntaxKind):e is ts.BinaryExpression=>ts.isBinaryExpression(e)&&e.operatorToken.kind===op
const returns=(s:ts.Statement)=>ts.isReturnStatement(s)||(ts.isBlock(s)&&s.statements.length>0&&ts.isReturnStatement(s.statements[s.statements.length-1])&&s.statements.every(x=>ts.isReturnStatement(x)||ts.isExpressionStatement(x)))
/**
 * 슬래시 명령 콜백 첫머리의 채널 거름(guard)을 읽는다. 실행하지 않고, 아래 모양만 인정한다(그 밖은 모름으로 남는다).
 * - 디스패치: case 'POST /x' 에서 wrapper(request, env, ctx, secret, callback) 를 부르고, wrapper 가 secret 을 다른 호출에 넘긴다(서명 확인)
 * - 콜백 본문의 맨 앞 if 문들(모두 return 으로 끝나는 거름) 가운데 `cmd.channel_id !== env.X`, `env.X && cmd.channel_id !== env.X`,
 *   `!env.X || cmd.channel_id !== env.X` (비교 양쪽 순서와 != 도 같다)
 */
export function summarizeWorkerSlashGates(body:unknown,admittedRoutes:string[]):SlashInvokerGate[] {
  const results:SlashInvokerGate[]=[]
  for(const source of workerModules(body)){
    const file=ts.createSourceFile('worker.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
    const functions=new Map<string,ts.FunctionLikeDeclaration>()
    visit(file,n=>{
      if(ts.isFunctionDeclaration(n)&&n.name)functions.set(n.name.text,n)
      if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer){const v=unwrap(n.initializer);if(ts.isArrowFunction(v)||ts.isFunctionExpression(v))functions.set(n.name.text,v)}
    })
    visit(file,n=>{
      if(!ts.isCaseClause(n)||!ts.isStringLiteral(n.expression)||!admittedRoutes.includes(n.expression.text))return
      for(const dispatch of calls(n)){
        if(!ts.isIdentifier(dispatch.expression)||dispatch.arguments.length!==5||!ts.isIdentifier(dispatch.arguments[4]))continue
        const wrapper=functions.get(dispatch.expression.text),callback=functions.get(dispatch.arguments[4].text)
        if(!wrapper||!callback||!callback.body||!ts.isBlock(callback.body))continue
        const secret=wrapper.parameters[3]?.name.getText(),run=wrapper.parameters[4]?.name.getText()
        if(!secret||!run||!calls(wrapper).some(c=>named(c,run)&&c.arguments.length>=2))continue
        if(!calls(wrapper).some(c=>!named(c,run)&&c.arguments.some(a=>ts.isIdentifier(a)&&a.text===secret)))continue
        const cmd=callback.parameters[0]?.name.getText(),env=callback.parameters[1]?.name.getText()
        if(!cmd||!env)continue
        const compared=(e:ts.Expression)=>{
          e=strip(e)
          if(!isOp(e,ts.SyntaxKind.ExclamationEqualsEqualsToken)&&!isOp(e,ts.SyntaxKind.ExclamationEqualsToken))return undefined
          for(const [a,b] of [[e.left,e.right],[e.right,e.left]]){
            const x=strip(a)
            if(ts.isPropertyAccessExpression(x)&&ts.isIdentifier(x.expression)&&x.expression.text===cmd&&x.name.text==='channel_id')return envBinding(strip(b),env)
          }
          return undefined
        }
        const gateOf=(cond:ts.Expression):{binding:string,when_unset:'deny'|'allow'}|undefined=>{
          cond=strip(cond)
          const direct=compared(cond);if(direct)return{binding:direct,when_unset:'deny'}
          if(isOp(cond,ts.SyntaxKind.AmpersandAmpersandToken)){const b=compared(cond.right);if(b&&envBinding(strip(cond.left),env)===b)return{binding:b,when_unset:'allow'}}
          if(isOp(cond,ts.SyntaxKind.BarBarToken)){
            const b=compared(cond.right),l=strip(cond.left)
            if(b&&ts.isPrefixUnaryExpression(l)&&l.operator===ts.SyntaxKind.ExclamationToken&&envBinding(strip(l.operand),env)===b)return{binding:b,when_unset:'deny'}
          }
          return undefined
        }
        for(const s of callback.body.statements){
          if(!ts.isIfStatement(s)||s.elseStatement||!returns(s.thenStatement))break
          const g=gateOf(s.expression)
          if(g)results.push({route:n.expression.text,handler:dispatch.arguments[4].text,kind:'request_channel',...g})
        }
      }
    })
  }
  return results.filter((r,i,a)=>a.findIndex(x=>JSON.stringify(x)===JSON.stringify(r))===i)
}
