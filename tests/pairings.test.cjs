const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

// Load the real request handler in isolation so collisions can be deterministic.
function loadWorker() {
  let digit = 0;
  function load(file) {
    const module = { exports: {} };
    const source = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(source, {
      module, exports: module.exports, Request, Response, URL,
      crypto: { getRandomValues: (bytes) => bytes.fill(digit++) },
      require: (name) => name === 'cloudflare:workers'
        ? { DurableObject: class {} }
        : load(resolve(dirname(file), name + '.ts')),
    });
    return module.exports;
  }
  return load(resolve('src/index.ts')).default;
}

const sponsor = {
  sponsorDeviceId: 'test-device', sponsorDeviceName: 'Test Device',
  sponsorEndpointId: 'test-endpoint', sponsorTicket: 'test-ticket',
};

function fixture(statuses = [200]) {
  const worker = loadWorker();
  const attempts = [];
  const env = { PAIRING_SESSION: {
    idFromName: (code) => code,
    get: (code) => ({ fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.code, code);
      attempts.push(body);
      const status = statuses[Math.min(attempts.length - 1, statuses.length - 1)];
      return Response.json(status === 200 ? { code } : {
        error: { code: status === 409 ? 'pairing_code_already_exists' : 'unavailable' },
      }, { status });
    } }),
  } };
  return { attempts, create: (extra = {}) => worker.fetch(new Request('https://test/v1/pairings', {
    method: 'POST', body: JSON.stringify({ ...sponsor, ...extra }),
  }), env) };
}

for (const length of [undefined, 8, 6]) {
  test(`generates requested length ${length ?? 'default'} and preserves leading zeros`, async () => {
    const { create } = fixture();
    const response = await create(length === undefined ? {} : { codeLength: length });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).code, length === 6 ? '000-000' : '0000-0000');
  });
}

for (const codeLength of [null, 0, 7, 9, -6, 6.5, '6', true, [], {}]) {
  test(`rejects invalid length ${JSON.stringify(codeLength)}`, async () => {
    const { create, attempts } = fixture();
    const response = await create({ codeLength });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_code_length');
    assert.equal(attempts.length, 0);
  });
}

test('rejects a proposed code combined with a length', async () => {
  const { create, attempts } = fixture();
  const response = await create({ proposedCode: 'A7K3-P9Q2', codeLength: 6 });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'conflicting_code_options');
  assert.equal(attempts.length, 0);
});

for (const codeLength of [6, 8]) {
  test(`retries a generated ${codeLength}-digit collision with a new code`, async () => {
    const { create, attempts } = fixture([409, 200]);
    const response = await create({ codeLength });
    assert.equal(response.status, 200);
    assert.equal(attempts.length, 2);
    assert.equal((await response.json()).code, codeLength === 6 ? '111-111' : '1111-1111');
    assert.equal(attempts[1].sponsorTicket, sponsor.sponsorTicket);
  });
}

test('stops after five generated collision attempts', async () => {
  const { create, attempts } = fixture([409]);
  const response = await create({ codeLength: 6 });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'pairing_code_already_exists');
  assert.equal(attempts.length, 5);
});

test('does not retry other failures', async () => {
  const { create, attempts } = fixture([500]);
  assert.equal((await create({ codeLength: 6 })).status, 500);
  assert.equal(attempts.length, 1);
});

test('preserves proposed codes and never retries their collisions', async () => {
  const { create, attempts } = fixture([409, 200]);
  assert.equal((await create({ proposedCode: 'A7K3-P9Q2' })).status, 409);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].code, 'A7K3-P9Q2');
});

test('preserves proposed code validation', async () => {
  const { create, attempts } = fixture();
  const response = await create({ proposedCode: '123456' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'invalid_proposed_code');
  assert.equal(attempts.length, 0);
});

for (const proposedCode of ['122-555', '000-001']) {
  test(`accepts six-digit proposed code ${proposedCode} unchanged`, async () => {
    const { create, attempts } = fixture();
    const response = await create({ proposedCode });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).code, proposedCode);
    assert.equal(attempts[0].code, proposedCode);
  });
}

for (const proposedCode of ['12-2555', '1225-55', 'ABC-DEF', '122-555\n', '122-555 ', '123-4567']) {
  test(`rejects malformed six-digit proposed code ${JSON.stringify(proposedCode)}`, async () => {
    const { create, attempts } = fixture();
    assert.equal((await create({ proposedCode })).status, 400);
    assert.equal(attempts.length, 0);
  });
}

test('does not replace a conflicting six-digit proposed code', async () => {
  const { create, attempts } = fixture([409, 200]);
  assert.equal((await create({ proposedCode: '122-555' })).status, 409);
  assert.equal(attempts.length, 1);
});
