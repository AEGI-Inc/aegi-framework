/** Extract JS module parts without executing or retaining multipart headers. */
export function workerModules(body: unknown): string[] {
  if(typeof body!=='string')return []
  const first=body.split(/\r?\n/,1)[0]
  if(!first.startsWith('--'))return [body]
  return body.split(first.trim()).flatMap(part=>{
    const split=part.search(/\r?\n\r?\n/)
    if(split<0||!/(?:name|filename)="[^"]+\.(?:mjs|js|cjs)"/i.test(part.slice(0,split)))return []
    return [part.slice(split).replace(/^\r?\n\r?\n/,'').replace(/\r?\n$/,'')]
  })
}
