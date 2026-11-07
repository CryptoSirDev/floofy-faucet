#!/usr/bin/env python3
"""Prepare (do not deploy or enable) a one-shot VPS server.js candidate.

Usage on a LOCAL COPY of the VPS server.js:
  python3 tools/prepare-first-payout-patch.py server.js server.first-payout.js

The generated file requires lib/first-live-payout-guard.cjs to be copied
next to server.js as first-live-payout-guard.cjs on the VPS. Payments remain
controlled by the existing PAYMENTS_ENABLED flag; this script never changes it.
"""
from pathlib import Path
import sys

if len(sys.argv) != 3:
    raise SystemExit('Usage: prepare-first-payout-patch.py INPUT OUTPUT')
src, dst = map(Path, sys.argv[1:])
if src.resolve() == dst.resolve():
    raise SystemExit('Refusing to overwrite original source')
code = src.read_text()
if 'allowedFirstPayout' in code:
    raise SystemExit('Patch already present; refusing duplicate')

# Fail closed if the known, previously audited VPS source layout changed.
anchors = [
    "const { pool } = require('./claim-store.cjs');",
    "const prior=lookup.get(request_id);",
    "db.exec('BEGIN IMMEDIATE');if(today.get().n>=limit)",
    "const txid=await rpc('sendtoaddress',[address,10]);",
]
for a in anchors:
    if code.count(a) != 1:
        raise SystemExit(f'Unexpected VPS source layout (missing/duplicate): {a}')
if "status='reserved'" not in code or 'No matching active claim reservation' not in code:
    raise SystemExit('Reservation ownership guard missing; refusing patch')

code = code.replace(anchors[0], anchors[0] + "\nconst { FIRST_ADDRESS, allowedFirstPayout, unusedPayoutJournal } = require('./first-live-payout-guard.cjs');", 1)
# Reject unauthorized destinations even when payments are enabled, before any RPC.
code = code.replace(anchors[1], "if (address !== FIRST_ADDRESS || amount !== 10) return respond(res,403,{success:false,error:'First payout destination locked'});\n" + anchors[1], 1)
# The existing reservation query must return its binding data and remain active.
old = "SELECT 1 FROM public.faucet_claim_reservations"
new = "SELECT request_id,address_hash,status,(created_at > now()-interval '24 hours') AS active FROM public.faucet_claim_reservations"
if code.count(old) != 1:
    raise SystemExit('Unexpected reservation SELECT; refusing patch')
code = code.replace(old,new,1)
old = 'if (reservation.rowCount !== 1)'
new = 'if (reservation.rowCount !== 1 || !allowedFirstPayout({request_id,address,amount},reservation.rows[0]))'
if code.count(old) != 1:
    raise SystemExit('Unexpected reservation check; refusing patch')
code = code.replace(old,new,1)
# Existing journal rows are treated as a hard stop. Check inside the existing
# BEGIN IMMEDIATE transaction so concurrent requests cannot both pass.
code = code.replace(anchors[2], "db.exec('BEGIN IMMEDIATE');if(!unusedPayoutJournal(db)){db.exec('ROLLBACK');return respond(res,409,{success:false,error:'First payout already attempted; reconcile journal'});}if(today.get().n>=limit)", 1)
# Do not change PAYMENTS_ENABLED, keys, wallet RPC, sendtoaddress, or route names.
dst.write_text(code)
print('Candidate written:', dst)
print('IMPORTANT: Not deployed; keep PAYMENTS_ENABLED=false until manual review.')
