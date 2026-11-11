// TEST ONLY. No Lightning backend, no monetary value, ephemeral mint keys.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hashToCurve, deriveKeysetId, createDLEQProof, OutputData } from '@cashu/cashu-ts';
import { body, reply, serve, sum } from './http.mjs';
const Point=secp256k1.Point;
const hex=b=>Buffer.from(b).toString('hex');
export async function startMint({port=0,inputFeePpk=0}={}) {
  const privateKeys={},keys={};
  for(let i=0;i<20;i++){const amount=2**i;privateKeys[amount]=secp256k1.utils.randomSecretKey();keys[amount]=hex(secp256k1.getPublicKey(privateKeys[amount]));}
  const id=deriveKeysetId(keys,{unit:'sat',input_fee_ppk:inputFeePpk}), keyset={id,unit:'sat',keys,active:true,input_fee_ppk:inputFeePpk};
  const spent=new Set(), signed=new Map();const stats={swaps:0,spentInputs:0};
  function sign(o){
    if(o.id!==id || !privateKeys[o.amount])throw new Error('Unsupported output');
    const B=Point.fromHex(o.B_),key=privateKeys[o.amount],scalar=BigInt('0x'+hex(key));
    const dleq=createDLEQProof(B,key);
    return {id,amount:Number(String(o.amount)),C_:B.multiply(scalar).toHex(),dleq:{e:hex(dleq.e),s:hex(dleq.s)}};
  }
  const info={name:'Boost Recovery Lab FAKE mint — no value',version:'boost-recovery-lab/0.1',nuts:{'4':{methods:[],disabled:true},'5':{methods:[],disabled:true},'7':{supported:true},'9':{supported:true},'12':{supported:true}}};
  const service=await serve(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&path==='/v1/info')return reply(res,info);
    if(req.method==='GET'&&path==='/v1/keysets')return reply(res,{keysets:[{id,unit:'sat',active:true,input_fee_ppk:inputFeePpk}]});
    if(req.method==='GET'&&(path==='/v1/keys'||path===`/v1/keys/${id}`))return reply(res,{keysets:[keyset]});
    if(req.method!=='POST')return reply(res,{detail:'Not found'},404);
    const b=await body(req);
    if(path==='/v1/checkstate')return reply(res,{states:b.Ys.map(Y=>({Y,state:spent.has(Y)?'SPENT':'UNSPENT'}))});
    if(path==='/v1/restore'){
      const pairs=b.outputs.filter(o=>signed.has(o.B_)).map(o=>signed.get(o.B_));
      return reply(res,{outputs:pairs.map(p=>p.output),signatures:pairs.map(p=>p.signature)});
    }
    if(path!=='/v1/swap')return reply(res,{detail:'Not found'},404);
    const {inputs,outputs}=b;
    if(!Array.isArray(inputs)||!inputs.length||!Array.isArray(outputs)||!outputs.length)throw new Error('Empty swap');
    const Ys=inputs.map(p=>hashToCurve(new TextEncoder().encode(p.secret)).toHex());
    if(new Set(Ys).size!==Ys.length||Ys.some(Y=>spent.has(Y)))return reply(res,{code:11001,detail:'Proof already spent'},400);
    if(new Set(outputs.map(o=>o.B_)).size!==outputs.length||outputs.some(o=>signed.has(o.B_)))throw new Error('Output reused');
    for(const p of inputs){
      if(p.id!==id||!privateKeys[p.amount]||p.secret.startsWith('['))throw new Error('Invalid or unsupported locked proof');
      const expected=hashToCurve(new TextEncoder().encode(p.secret)).multiply(BigInt('0x'+hex(privateKeys[p.amount])));
      if(!expected.equals(Point.fromHex(p.C)))throw new Error('Invalid signature');
    }
    const fee=Math.ceil(inputs.length*inputFeePpk/1000);
    if(sum(inputs)!==sum(outputs)+fee)throw new Error('Conservation failure');
    const signatures=outputs.map(sign);
    // All validation above; commit is synchronous and atomic within this test process.
    Ys.forEach(Y=>spent.add(Y));outputs.forEach((output,i)=>signed.set(output.B_,{output,signature:signatures[i]}));
    stats.swaps++;stats.spentInputs+=inputs.length;
    reply(res,{signatures});
  },port);
  return {...service,stats,keyset,
    // Local fixture API only. No HTTP faucet and no externally funded minting.
    issue(amount){return OutputData.createRandomData(amount,keyset).map(o=>o.toProof(sign(o.blindedMessage),keyset));}
  };
}
