const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { unstable_dev } = require('wrangler');

let worker;
before(async () => {
  worker = await unstable_dev('src/index.ts', {
    local: true, persist: false, ip: '127.0.0.1', port: 0,
    inspectorPort: 0, logLevel: 'error',
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
  });
});
after(async () => { await worker?.stop(); });

const sponsor = {
  sponsorDeviceId: 'integration-device', sponsorDeviceName: 'Integration Device',
  sponsorEndpointId: 'integration-endpoint', sponsorTicket: 'integration-ticket',
};

async function post(path, body) {
  const response = await worker.fetch(path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

for (const codeLength of [undefined, 8, 6]) {
  test(`real storage: create, resolve, consume length ${codeLength ?? 'default'}`, async () => {
    const created = await post('/v1/pairings', { ...sponsor, codeLength });
    assert.equal(created.status, 200);
    assert.match(created.body.code, codeLength === 6 ? /^\d{3}-\d{3}$/ : /^\d{4}-\d{4}$/);
    assert.ok(created.body.expiresAtMs > Date.now());
    const { code } = created.body;
    const resolved = await post('/v1/pairings/resolve', { code });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.code, code);
    assert.equal(resolved.body.sponsorTicket, sponsor.sponsorTicket);
    assert.equal(resolved.body.status, 'resolved');
    assert.equal((await post('/v1/pairings/consume', { code })).status, 200);
    const consumed = await post('/v1/pairings/resolve', { code });
    assert.equal(consumed.status, 409);
    assert.equal(consumed.body.error.code, 'pairing_already_consumed');
  });
}

test('real storage: duplicate proposed code does not overwrite its ticket', async () => {
  const proposedCode = 'A7K3-P9Q2';
  assert.equal((await post('/v1/pairings', { ...sponsor, proposedCode })).status, 200);
  const duplicate = await post('/v1/pairings', {
    ...sponsor, proposedCode, sponsorTicket: 'replacement-ticket',
  });
  assert.equal(duplicate.status, 409);
  const resolved = await post('/v1/pairings/resolve', { code: proposedCode });
  assert.equal(resolved.body.sponsorTicket, sponsor.sponsorTicket);
});

test('real requests reject invalid and conflicting length options', async () => {
  const invalid = await post('/v1/pairings', { ...sponsor, codeLength: '6' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'invalid_code_length');
  const conflicting = await post('/v1/pairings', {
    ...sponsor, codeLength: 6, proposedCode: 'A7K3-P9Q2',
  });
  assert.equal(conflicting.status, 400);
  assert.equal(conflicting.body.error.code, 'conflicting_code_options');
});

test('real storage: six-digit proposed code supports the full existing lifecycle', async () => {
  const code = '122-555';
  const created = await post('/v1/pairings', { ...sponsor, proposedCode: code });
  assert.equal(created.status, 200);
  assert.equal(created.body.code, code);
  const duplicate = await post('/v1/pairings', {
    ...sponsor, proposedCode: code, sponsorTicket: 'replacement-ticket',
  });
  assert.equal(duplicate.status, 409);
  const resolved = await post('/v1/pairings/resolve', { code });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.sponsorTicket, sponsor.sponsorTicket);
  assert.equal((await post('/v1/pairings/consume', { code })).status, 200);
  const consumed = await post('/v1/pairings/resolve', { code });
  assert.equal(consumed.status, 409);
  assert.equal(consumed.body.error.code, 'pairing_already_consumed');
  assert.equal((await post('/v1/pairings', { ...sponsor, proposedCode: code })).status, 200);
});
