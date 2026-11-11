import http from 'node:http';
export const sum = xs => xs.reduce((n, x) => n + Number(String(x.amount)), 0);
export function localURL(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('Only explicit http://127.0.0.1:PORT test mints are allowed');
  return u.origin;
}
export async function body(req) {
  const chunks=[];let size=0;
  for await (const c of req) { size+=c.length; if(size>1024*1024) throw new Error('Body too large');chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
export function reply(res, data, status=200) {
  res.writeHead(status, {'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(data));
}
export async function serve(handler, port=0) {
  const server=http.createServer((req,res)=>Promise.resolve(handler(req,res)).catch(()=>reply(res,{code:10000,detail:'Test request rejected'},400)));
  server.requestTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})};
}
