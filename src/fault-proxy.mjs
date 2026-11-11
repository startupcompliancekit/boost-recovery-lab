import { createHash } from 'node:crypto';
import { localURL, body, reply, serve } from './http.mjs';
export const MODES=['pass','drop-before','drop-after','http-503-before','truncate-after','partial-restore','bad-dleq-restore','reverse-restore','empty-restore'];
export async function startProxy(upstream,{mode='pass',port=0}={}){
  upstream=localURL(upstream);if(!MODES.includes(mode))throw new Error('Unknown fault');
  let armed=mode;const events=[];
  const service=await serve(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    const allowed=req.method==='GET'? /^\/v1\/(info|keysets|keys(?:\/[0-9a-f]+)?)$/.test(path):req.method==='POST'&&['/v1/swap','/v1/restore','/v1/checkstate'].includes(path);
    if(!allowed)return reply(res,{detail:'Test proxy route not allowed'},404);
    const data=req.method==='POST'?JSON.stringify(await body(req)):undefined;
    const target=armed.endsWith('-restore')?'/v1/restore':'/v1/swap';
    const fault=path===target?armed:'pass';if(path===target)armed='pass';
    const event={method:req.method,path,fault,requestHash:data?createHash('sha256').update(data).digest('hex'):null,forwarded:false};events.push(event);
    if(fault==='drop-before')return req.socket.destroy();
    if(fault==='http-503-before')return reply(res,{detail:'Injected pre-forward failure'},503);
    const response=await fetch(upstream+path,{method:req.method,headers:{'content-type':'application/json'},body:data,redirect:'error',signal:AbortSignal.timeout(5000)});
    const text=await response.text();event.forwarded=true;event.upstreamStatus=response.status;
    if(fault==='drop-after')return req.socket.destroy();
    if(fault.endsWith('-restore')){
      const r=JSON.parse(text);
      if(fault==='partial-restore'){r.outputs.pop();r.signatures.pop()}
      if(fault==='empty-restore'){r.outputs=[];r.signatures=[]}
      if(fault==='bad-dleq-restore'&&r.signatures.length)r.signatures[0].dleq.s='00'.repeat(32);
      if(fault==='reverse-restore'){r.outputs.reverse();r.signatures.reverse()}
      return reply(res,r,response.status);
    }
    if(fault==='truncate-after')return reply(res,{signatures:[]},response.status);
    res.writeHead(response.status,{'content-type':'application/json','cache-control':'no-store'});res.end(text);
  },port);
  return {...service,events,arm(mode){if(!MODES.includes(mode))throw new Error('Unknown fault');armed=mode}};
}
