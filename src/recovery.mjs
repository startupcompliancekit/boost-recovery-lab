import { Wallet, serializeSwapPreview, deserializeSwapPreview, getEncodedToken } from '@cashu/cashu-ts';
import { createHash } from 'node:crypto';
import { save,read,locked } from './journal.mjs';
import {localURL,sum} from './http.mjs';
const serial=xs=>xs.map(p=>({...p,amount:String(p.amount)}));
async function walletFor(url){const w=new Wallet(localURL(url));await w.loadMint();return w}
function summary(j){return {state:j.state,amount:Number(String(j.preview.amount)),fee:Number(String(j.preview.fees)),commitment:j.commitment,sendAmount:j.result?sum(j.result.send):0,changeAmount:j.result?sum(j.result.keep):0}}
function finish(file,j,result){j.state='ready';j.result={send:serial(result.send),keep:serial(result.keep)};save(file,j);return summary(j)}
async function submitSaved(file,j,w){
  j.state='uncertain';save(file,j); // durable before the first byte is sent
  try{const result=await w.completeSwap(deserializeSwapPreview(j.preview));result.keep.push(...j.unselected);return finish(file,j,result)}
  catch{return summary(j)} // an error is NOT proof that inputs are unspent
}
export async function prepare(file,url,amount,proofs){return locked(file,async()=>{
  const wallet=await walletFor(url);
  if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('Positive integer sat amount required');
  const preview=await wallet.prepareSwapToSend(amount,proofs);
  const persisted=serializeSwapPreview(preview);
  const j={version:1,mint:localURL(url),state:'prepared',preview:persisted,unselected:serial(preview.unselectedProofs||[]),commitment:createHash('sha256').update(JSON.stringify(persisted)).digest('hex')};
  save(file,j,{exclusive:true});return summary(j);
})}
export async function send(file){return locked(file,async()=>{
  const j=read(file);if(j.state==='ready')return summary(j);
  if(j.state!=='prepared')throw new Error('Ambiguous swap: call recover, never start a new payment');
  return submitSaved(file,j,await walletFor(j.mint));
})}
export async function recover(file){return locked(file,async()=>{
  const j=read(file);if(j.state==='ready')return summary(j);
  if(!['prepared','uncertain'].includes(j.state))throw new Error('Invalid journal state');
  const w=await walletFor(j.mint),p=deserializeSwapPreview(j.preview);
  const outputs=[...(p.keepOutputs||[]),...(p.sendOutputs||[])];
  const restored=await w.mint.restore({outputs:outputs.map(o=>o.blindedMessage)});
  if(restored.outputs.length!==restored.signatures.length)throw new Error('Incomplete restore; keep journal, do not retry');
  if(restored.outputs.length===0){
    const states=await w.checkProofsStates(p.inputs);
    if(states.length!==p.inputs.length||states.some(s=>s.state!=='UNSPENT'))throw new Error('Inputs spent or pending but outputs unavailable; preserve journal');
    return submitSaved(file,j,w); // identical inputs/outputs, never freshly generated
  }
  if(restored.outputs.length!==outputs.length)throw new Error('Partial restore; preserve journal, no fresh payment');
  const byB=new Map();
  for(let i=0;i<restored.outputs.length;i++){
    const o=restored.outputs[i],s=restored.signatures[i];
    if(byB.has(o.B_)||s.id!==o.id||Number(String(s.amount))!==Number(String(o.amount)))throw new Error('Invalid restore mapping');
    byB.set(o.B_,{output:o,signature:s});
  }
  const toProof=o=>{
    const r=byB.get(o.blindedMessage.B_);
    if(!r||r.signature.id!==o.blindedMessage.id||Number(String(r.signature.amount))!==Number(String(o.blindedMessage.amount))||!r.signature.dleq)throw new Error('Restore identity, amount or DLEQ missing');
    // cashu-ts unblinds and verifies the returned DLEQ against this saved blinded output.
    return o.toProof(r.signature,w.keyChain.getKeyset(r.signature.id));
  };
  const result={keep:[...(p.keepOutputs||[]).map(toProof),...j.unselected],send:(p.sendOutputs||[]).map(toProof)};
  if(sum(result.send)!==Number(String(p.amount)))throw new Error('Restored send amount mismatch');
  return finish(file,j,result);
})}
export function status(file){return summary(read(file))}
export function creatorToken(file){const j=read(file);if(j.state!=='ready')throw new Error('No confirmed token');return getEncodedToken({mint:j.mint,unit:'sat',proofs:j.result.send})}
