// Integrated gateway candidate, NOT for production deployment.
// Read-only balances + authenticated bound-claim staging; NO sendtoaddress.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createClaimRoutes } = require('./claim-routes-v2.cjs');
// Refuse to open any database or wallet until the isolated staging target is checked.
const databaseEnv = readFileSync('/opt/floofy-rpc-gateway/database.env', 'utf8');
const databaseLine = databaseEnv.split(/\r?\n/).find(x => x.startsWith('DATABASE_URL='));
if (!databaseLine) throw Error('Missing staging database configuration');
let databaseName;
try { databaseName = decodeURIComponent(new URL(databaseLine.slice('DATABASE_URL='.length)).pathname.slice(1)); }
catch { throw Error('Invalid staging database URL'); }
if (databaseName !== 'floofy_claim_test') throw Error('Refusing non-disposable PostgreSQL database');
const { pool } = require('./claim-store-v2.cjs');

const env = Object.fromEntries(readFileSync('/opt/floofy-rpc-gateway/gateway.env', 'utf8')
  .split(/\r?\n/).filter(s => s.includes('=') && !s.startsWith('#'))
  .map(s => { const i=s.indexOf('='); return [s.slice(0,i),s.slice(i+1)]; }));
if (env.PAYMENTS_ENABLED !== 'false' || env.GATEWAY_V2_STAGING !== 'true')
  throw Error('Gateway v2 refuses live payment configuration');
for (const name of ['GATEWAY_API_KEY','RPC_USER','RPC_PASS','RPC_URL'])
  if (!env[name]) throw Error('Missing '+name);
if (!/^http:\/\/127\.0\.0\.1:6664\/?$/.test(env.RPC_URL))
  throw Error('Faucet Core RPC must be loopback only');
const apiKey=Buffer.from(env.GATEWAY_API_KEY);
const db=new DatabaseSync('/var/lib/floofy-rpc-gateway/payments.sqlite', { readOnly:true });
const lookup=db.prepare('SELECT request_id,address,amount_sat,status,txid,created_at FROM payout_v2 WHERE request_id=?');
const respond=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const authorized=req=>{const v=req.headers['x-api-key'];const b=Buffer.from(typeof v==='string'?v:'');return b.length===apiKey.length&&timingSafeEqual(b,apiKey);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS=/^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;
const HASH=/^[a-f0-9]{64}$/;
const walletId=env.FAUCET_WALLET_ID;
const amountSat=Number(env.FAUCET_AMOUNT_SAT);
if (!/^[A-Za-z0-9_-]{1,64}$/.test(walletId||'')||!Number.isSafeInteger(amountSat)||amountSat<=0)
  throw Error('Trusted wallet identity and verified amount units required');
async function rpc(method,params=[]) {
  const auth=Buffer.from(env.RPC_USER+':'+env.RPC_PASS).toString('base64');
  const r=await fetch(env.RPC_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+auth},body:JSON.stringify({jsonrpc:'1.0',id:'faucet-v2',method,params}),signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('RPC HTTP '+r.status);
  const j=await r.json();if(j.error)throw Error(j.error.message||'RPC error');return j.result;
}
async function readBody(req) {
  let raw='';
  for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)throw Error('Request too large');}
  const value=JSON.parse(raw);
  if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Invalid JSON object');
  return value;
}
// Input is authenticated gateway-to-Render transport, but address must be
// validated by the dedicated faucet Core. Client-supplied amount/wallet ignored.
// Hash trust and origin binding MUST be reviewed before live deployment.
const routes=createClaimRoutes({pool,expectedWalletId:walletId,expectedAmountSat:amountSat,
  policy:{async resolveReservation({input}){
    if(!HASH.test(input.ip_hash)||!ADDRESS.test(input.address))
      throw Error('Invalid claim identity');
    const result=await rpc('validateaddress',[input.address]);
    if(!result?.isvalid)throw Error('Invalid chain address');
    return {ip_hash:input.ip_hash,address_hash:createHash('sha256').update(input.address).digest('hex'),
      address:input.address,amount_sat:amountSat,wallet_id:walletId};
  }}});
const allowed=new Set(['/internal/balance','/internal/reserve-balance','/internal/payment',
  '/internal/payment-status','/internal/claim-reserve','/internal/claim-consume','/internal/claim-status']);
const server=http.createServer(async(req,res)=>{
  const path=req.url?.split('?')[0];
  if(req.method==='GET'&&req.url==='/health')
    return respond(res,200,{status:'ok',payments_enabled:false,mode:'staging'});
  if(!allowed.has(path))return respond(res,404,{error:'Not found'});
  if(!authorized(req))return respond(res,401,{error:'Unauthorized'});
  if(req.method==='GET'&&path==='/internal/reserve-balance'&&req.url===path){
    try{const data=JSON.parse(readFileSync('/run/floofy-public-balance/reserve.json','utf8'));
      const updated=Date.parse(data.updated_at);
      if(typeof data.balance!=='number'||!Number.isFinite(data.balance)||data.balance<0||
        !Number.isFinite(updated)||updated>Date.now()+30000||Date.now()-updated>180000)
        throw Error('Stale balance');
      return respond(res,200,{balance:data.balance,balance_type:'main_reserve',updated_at:data.updated_at});
    }catch{return respond(res,503,{error:'Reserve balance unavailable'});}
  }
  if(req.method==='GET'&&path==='/internal/balance'&&req.url===path){
    try{return respond(res,200,{balance:await rpc('getbalance')});}
    catch{return respond(res,503,{error:'Balance unavailable'});}
  }
  if(req.method==='GET'&&path==='/internal/payment-status'){
    const u=new URL(req.url,'http://localhost');
    const id=u.searchParams.get('request_id');
    if(u.searchParams.size!==1||!id||!/^[-a-zA-Z0-9_]{12,100}$/.test(id))
      return respond(res,400,{error:'Invalid request_id'});
    const p=lookup.get(id);
    return respond(res,p?200:404,p||{error:'Not found'});
  }
  if(req.method==='GET'&&path==='/internal/claim-status'){
    const u=new URL(req.url,'http://localhost');
    const id=u.searchParams.get('request_id');
    if(u.searchParams.size!==1||!UUID.test(id||''))
      return respond(res,400,{error:'Invalid request_id'});
    try{const status=await routes.status(id);return respond(res,status?200:404,status||{error:'Not found'});}
    catch{return respond(res,503,{error:'Claim status unavailable'});}
  }
  if(req.method==='POST'&&path==='/internal/claim-reserve'&&req.url===path){
    let input;try{input=await readBody(req);}catch{return respond(res,400,{error:'Invalid request body'});}
    try{const result=await routes.reserve({input});
      return respond(res,result.allowed?201:429,result);
    }catch(e){console.error('Bound claim reservation failed:',e.message);
      return respond(res,503,{error:'Claim reservation unavailable'});}
  }
  if(req.method==='POST'&&path==='/internal/claim-consume'&&req.url===path){
    let input;try{input=await readBody(req);}catch{return respond(res,400,{error:'Invalid request body'});}
    if(!UUID.test(input.request_id||''))return respond(res,400,{error:'Invalid request_id'});
    try{const result=await routes.consume(input.request_id);
      return respond(res,result.accepted?202:409,result);
    }catch(e){console.error('Claim consume failed:',e.message);
      return respond(res,503,{error:'Claim unavailable; inspect status before retry'});}
  }
  if(path==='/internal/payment')return respond(res,503,{success:false,error:'Payments disabled',code:'PAYMENTS_PAUSED'});
  return respond(res,405,{error:'Method not allowed'});
});
server.listen(3002,'127.0.0.1',()=>console.log('Gateway v2 STAGING only on 127.0.0.1:3002; payments disabled'));
