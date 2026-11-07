'use strict';
// Render-side orchestration for the EXISTING live VPS routes.
// This must only be wired after /internal/payment on the VPS validates
// request_id against its PostgreSQL reservation BEFORE calling sendtoaddress.
const { renderClaimPayload } = require('./claim-wire-contract.cjs');
const { toLiveReservationPayload } = require('./live-reservation-wire.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TXID = /^[a-f0-9]{64}$/i;
async function requestLiveClaim({ ip, address, secret, gatewayPost }) {
  if (typeof gatewayPost !== 'function') throw Error('Authenticated gateway required');
  const payload = toLiveReservationPayload(renderClaimPayload({ ip, address, secret }));
  let reserve;
  try { reserve = await gatewayPost('/internal/claim-reserve', payload); }
  catch { return {success:false,code:'REVIEW',message:'Reservation uncertain; check before retrying.'}; }
  if (reserve?.status === 429) return {success:false,code:'COOLDOWN',message:'One claim per IP or address every 24 hours.'};
  if (reserve?.status !== 201 || reserve.data?.allowed !== true || !UUID.test(reserve.data?.request_id || ''))
    return {success:false,code:'REVIEW',message:'Reservation uncertain; check before retrying.'};
  const request_id = reserve.data.request_id;
  let paid;
  try { paid = await gatewayPost('/internal/payment',{request_id,address,amount:10}); }
  catch { return {success:false,code:'REVIEW',request_id,message:'Payment status uncertain; do not retry.'}; }
  if (paid?.status === 200 && paid.data?.success === true && TXID.test(paid.data?.txid || ''))
    return {success:true,request_id,txid:paid.data.txid};
  return {success:false,code:'REVIEW',request_id,message:'Payment not confirmed; inspect status before retrying.'};
}
module.exports={requestLiveClaim};
