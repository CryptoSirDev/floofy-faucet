'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIpDiagnosticHandler } = require('../lib/render-ip-diagnostic.cjs');

const token = 'test-token-' + 'a'.repeat(40);
const secret = 'test-secret-' + 'b'.repeat(40);

function invoke(ip, providedToken, edgeIp) {
  const headers = {};
  let status = 200;
  let body;

  const req = {
    ip,
    get(name) {
      return name === 'x-staging-test-token' ? providedToken :
        name === 'cf-connecting-ip' ? edgeIp : undefined;
    }
  };

  const res = {
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    status(code) {
      status = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    }
  };

  createIpDiagnosticHandler({ token, secret })(req, res);

  return { status, body, headers };
}

test('rejects missing and invalid tokens', () => {
  assert.equal(invoke('203.0.113.10').status, 401);
  assert.equal(invoke('203.0.113.10', 'invalid').status, 401);
});

test('valid token returns only a fingerprint', () => {
  const result = invoke('203.0.113.10', token);
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, 'staging-ip-diagnostic');
  assert.match(result.body.fingerprint, /^[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(result.body).includes('203.0.113.10'), false);
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('same IP is stable; different IP changes fingerprint', () => {
  const a = invoke('203.0.113.10', token);
  const b = invoke('203.0.113.10', token);
  const c = invoke('203.0.113.11', token);

  assert.equal(a.body.fingerprint, b.body.fingerprint);
  assert.notEqual(a.body.fingerprint, c.body.fingerprint);
});

test('missing secret fails closed', () => {
  const req = { ip: '203.0.113.10', get: () => token };
  let status = 200;

  const res = {
    setHeader() {},
    status(code) { status = code; return this; },
    json() { return this; }
  };

  createIpDiagnosticHandler({ token, secret: '' })(req, res);
  assert.equal(status, 503);
});

test('edge fingerprint is independent of spoofed Express IP and never leaks raw IP', () => {
  const a = invoke('8.8.8.8', token, '203.0.113.10');
  const b = invoke('9.9.9.9', token, '203.0.113.10');
  assert.notEqual(a.body.fingerprint, b.body.fingerprint);
  assert.equal(a.body.edge_fingerprint, b.body.edge_fingerprint);
  assert.match(a.body.edge_fingerprint, /^[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(a.body).includes('203.0.113.10'), false);
  assert.equal(invoke('8.8.8.8', token, 'not-an-ip').body.edge_fingerprint, null);
});
