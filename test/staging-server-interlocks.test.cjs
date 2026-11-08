'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const gateway=fs.readFileSync(path.join(__dirname,'../gateway/server-v2.mjs'),'utf8');
const render=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');

test('staging gateway fails closed and does not contain a payment broadcast call',()=>{
 assert.match(gateway,/env\.PAYMENTS_ENABLED !== 'false'/);
 assert.match(gateway,/env\.GATEWAY_V2_STAGING !== 'true'/);
 assert.match(gateway,/databaseName !== 'floofy_claim_test'/);
 assert.match(gateway,/server\.listen\(3002,'127\.0\.0\.1'/);
 assert.match(gateway,/if\(path==='\/internal\/payment'\)return respond\(res,503/);
 assert.doesNotMatch(gateway,/rpc\(['"]sendtoaddress['"]/);
 assert.doesNotMatch(gateway,/rpc\(['"]sendrawtransaction['"]/);
});
test('Render live payouts require explicit approval and remain paused by default',()=>{
 assert.match(render,/const PAYOUT_INTEGRATION_APPROVED = process\.env\.PAYOUT_INTEGRATION_APPROVED === 'true';/);
 assert.match(render,/const FAUCET_PAUSED = process\.env\.FAUCET_PAUSED !== 'false';/);
 assert.match(render,/const CLAIMS_INTEGRATION_ENABLED = process\.env\.CLAIMS_INTEGRATION_ENABLED === 'true';/);
 const publicRoute=render.split("app.post('/api/request', async (req, res) => {")[1];
 assert.ok(publicRoute);
 assert.match(publicRoute,/if \(FAUCET_PAUSED \|\| !CLAIMS_INTEGRATION_ENABLED \|\| !PAYOUT_INTEGRATION_APPROVED\)/);
 assert.match(publicRoute,/resolveVerifiedClientIp\(/);
 assert.match(publicRoute,/submitLiveClaim\(/);
 assert.doesNotMatch(publicRoute,/\/internal\/claim-consume/);
});

test('staging never connects to live Core or live SQLite journal',()=>{
 assert.match(gateway,/env\.RPC_URL !== 'http:\/\/127\.0\.0\.1:16664'/);
 assert.match(gateway,/staging\/database\.env/);
 assert.match(gateway,/staging\/gateway\.env/);
 assert.doesNotMatch(gateway,/new DatabaseSync\('\/var\/lib\/floofy-rpc-gateway\/payments\.sqlite'/);
 assert.doesNotMatch(gateway,/rpc\(['"]sendtoaddress['"]/);
});
