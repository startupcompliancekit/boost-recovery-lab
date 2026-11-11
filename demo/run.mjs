import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Wallet,getDecodedToken } from '@cashu/cashu-ts';
import {startMint} from '../src/fake-mint.mjs';
import {startProxy} from '../src/fault-proxy.mjs';
import {prepare,send,recover,creatorToken} from '../src/recovery.mjs';
import {sum} from '../src/http.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boost-lab-'));const journal=path.join(dir,'boost.journal.json');
const mint=await startMint(),proxy=await startProxy(mint.url,{mode:'drop-after'});
try{
  const input=mint.issue(32);
  console.log(JSON.stringify({step:'fixture',unit:'FAKE sats',balance:sum(input),externalNetwork:false}));
  console.log(JSON.stringify({step:'prepared',...await prepare(journal,proxy.url,13,input)}));
  const lost=await send(journal);assert.equal(lost.state,'uncertain');assert.equal(mint.stats.swaps,1);
  console.log(JSON.stringify({step:'response-lost-after-commit',...lost,mintSwaps:mint.stats.swaps}));
  const restored=await recover(journal);assert.equal(restored.sendAmount,13);assert.equal(restored.changeAmount,19);assert.equal(mint.stats.swaps,1);
  console.log(JSON.stringify({step:'recovered-with-NUT09',...restored,mintSwaps:mint.stats.swaps}));
  const token=creatorToken(journal),receiver=new Wallet(proxy.url);await receiver.loadMint();
  const received=await receiver.receive(token);assert.equal(sum(received),13);
  await assert.rejects(()=>receiver.receive(token));
  const again=creatorToken(journal);assert.equal(again,token);await recover(journal);
  assert.equal(mint.stats.swaps,2);assert.equal(sum(getDecodedToken(again,[mint.keyset.id]).proofs),13);
  console.log(JSON.stringify({step:'creator-redeemed',creatorBalance:13,senderChange:19,duplicateRedemption:'rejected',paymentSwaps:1,receiverSwaps:1,secondRecovery:'same token; no new swap',result:'PASS'}));
  console.log(JSON.stringify({step:'redacted-proxy-transcript',requests:proxy.events}));
}finally{await proxy.close();await mint.close();fs.rmSync(dir,{recursive:true,force:true})}
