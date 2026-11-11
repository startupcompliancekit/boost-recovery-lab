import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {Wallet} from '@cashu/cashu-ts';
import {startMint} from '../src/fake-mint.mjs';
import {startProxy} from '../src/fault-proxy.mjs';
import {prepare,send,recover,status,creatorToken} from '../src/recovery.mjs';
import {localURL,sum} from '../src/http.mjs';
import {read,locked} from '../src/journal.mjs';
async function fixture(t,mode='pass',mintOptions={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boost-test-')),file=path.join(dir,'tip.journal.json');
 const mint=await startMint(mintOptions),proxy=await startProxy(mint.url,{mode});
 t.after(async()=>{await proxy.close();await mint.close();fs.rmSync(dir,{recursive:true,force:true})});
 return {file,mint,proxy};
}
for(const mode of ['pass','drop-before','drop-after','http-503-before','truncate-after'])test(`${mode}: exactly one payment, change conserved, duplicate redemption rejected`,async t=>{
 const {file,mint,proxy}=await fixture(t,mode),input=mint.issue(32);
 await prepare(file,proxy.url,13,input);let r=await send(file);
 assert.equal(r.state,mode==='pass'?'ready':'uncertain');
 if(r.state==='uncertain'){await assert.rejects(()=>send(file),/Ambiguous/);r=await recover(file)}
 assert.equal(r.sendAmount,13);assert.equal(r.changeAmount,19);assert.equal(mint.stats.swaps,1);
 const token=creatorToken(file),w=new Wallet(proxy.url);await w.loadMint();assert.equal(sum(await w.receive(token)),13);
 await assert.rejects(()=>w.receive(token));assert.equal(mint.stats.swaps,2);
 assert.deepEqual(await recover(file),r);assert.equal(creatorToken(file),token);assert.equal(mint.stats.swaps,2);
 const log=JSON.stringify(proxy.events),j=read(file);
 for(const p of [...j.preview.inputs,...j.result.send,...j.result.keep]){assert.ok(!log.includes(p.secret));assert.ok(!log.includes(p.C))}
 assert.equal(fs.statSync(file).mode&0o777,0o600);
 const swaps=proxy.events.filter(e=>e.path==='/v1/swap').slice(0,mode==='drop-before'||mode==='http-503-before'?2:1);
 if(swaps.length===2)assert.equal(swaps[0].requestHash,swaps[1].requestHash);
});
for(const mode of ['partial-restore','bad-dleq-restore','empty-restore'])test(`${mode}: fail closed without replacement payment`,async t=>{
 const {file,mint,proxy}=await fixture(t,'drop-after');await prepare(file,proxy.url,13,mint.issue(32));await send(file);proxy.arm(mode);
 await assert.rejects(()=>recover(file));assert.equal(mint.stats.swaps,1);assert.equal(status(file).state,'uncertain');
 assert.equal((await recover(file)).sendAmount,13);assert.equal(mint.stats.swaps,1);
});
test('restore matches by blinded output, not response order',async t=>{
 const {file,mint,proxy}=await fixture(t,'drop-after');await prepare(file,proxy.url,13,mint.issue(32));await send(file);proxy.arm('reverse-restore');
 const r=await recover(file);assert.equal(r.sendAmount,13);assert.equal(r.changeAmount,19);assert.equal(mint.stats.swaps,1);
});
test('fee-bearing input conserves send, change and fee',async t=>{
 const {file,mint,proxy}=await fixture(t,'drop-after',{inputFeePpk:1000});await prepare(file,proxy.url,13,mint.issue(32));await send(file);
 const r=await recover(file);assert.equal(r.sendAmount+r.changeAmount+r.fee,32);assert.equal(r.fee,1);
});
for(const mode of ['pass','drop-after'])test(`${mode}: unselected proofs survive persistence`,async t=>{
 const {file,mint,proxy}=await fixture(t,mode),proofs=[...mint.issue(32),...mint.issue(64)];
 await prepare(file,proxy.url,13,proofs);await send(file);const r=await recover(file);
 assert.equal(r.sendAmount+r.changeAmount,96);assert.ok(read(file).unselected.length>0);
});
test('fresh Node process recovers persisted state after transport loss',async t=>{
 const {file,mint,proxy}=await fixture(t,'drop-after');await prepare(file,proxy.url,13,mint.issue(32));await send(file);
 const child=spawn(process.execPath,['--input-type=module','-e',"import {recover} from './src/recovery.mjs'; console.log(JSON.stringify(await recover(process.argv[1])))",file],{cwd:path.resolve(import.meta.dirname,'..'),stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
 const code=await new Promise(resolve=>child.on('exit',resolve));assert.equal(code,0,err);assert.equal(JSON.parse(out).sendAmount,13);assert.equal(mint.stats.swaps,1);
});
test('exclusive journal prevents two local writers; existing payment cannot be replaced',async t=>{
 const {file,mint,proxy}=await fixture(t);await prepare(file,proxy.url,13,mint.issue(32));
 await locked(file,async()=>{await assert.rejects(()=>send(file),/locked/)});
 await assert.rejects(()=>prepare(file,proxy.url,1,mint.issue(1)),/already exists/);assert.equal(mint.stats.swaps,0);
});
test('missing/unsafe journals fail without a request',async t=>{
 const {file,mint,proxy}=await fixture(t);await assert.rejects(()=>recover(file));
 await prepare(file,proxy.url,13,mint.issue(32));fs.chmodSync(file,0o644);await assert.rejects(()=>send(file),/owner-only/);assert.equal(mint.stats.swaps,0);
});
test('reject remote mints, redirects, credentials and non-Cashu proxy routes',async t=>{
 for(const url of ['https://mint.example','http://localhost:1234','http://127.0.0.1:1/private','http://user@127.0.0.1:1','http://127.0.0.1:1/?x=1','http://127.0.0.1:1/#x'])assert.throws(()=>localURL(url));
 const {proxy}=await fixture(t);assert.equal((await fetch(proxy.url+'/etc/passwd')).status,404);
});
test('forged proofs fail at mint with no debit',async t=>{
 const {file,mint,proxy}=await fixture(t),proofs=mint.issue(32);proofs[0].secret='not-the-issued-secret';
 await prepare(file,proxy.url,13,proofs);assert.equal((await send(file)).state,'uncertain');assert.equal(mint.stats.swaps,0);
});
