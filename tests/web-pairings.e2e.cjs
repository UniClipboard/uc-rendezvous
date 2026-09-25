// HTTP + browser acceptance against local workerd, real SQLite DOs and the
// bundled Miniflare rate-limit binding. Never accepts an external target URL.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const { unstable_dev } = require('wrangler');
const { chromium } = require('playwright');

const { DatabaseSync } = require('node:sqlite');
const { deserialize } = require('node:v8');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, '.wrangler', 'web-pairing-e2e', new Date().toISOString().replaceAll(':', '-'));
const origin = 'http://localhost:43123';
const records = [];
const checks = [];
const running = new Set();
let ipSerial = 1;
const ip = () => `192.0.2.${ipSerial++}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let config;
async function start(name, vars = {}, overrides = {}) {
  const configPath = path.join(dir, `${name}.json`);
  await fs.writeFile(configPath, JSON.stringify({ ...config, name: `web-e2e-${name}`,
    main: path.join(root, 'src/index.ts'), vars, ...overrides }));
  const worker = await unstable_dev(path.join(root, 'src/index.ts'), {
    config: configPath, local: true, persist: true, persistTo: path.join(dir, `${name}-state`),
    ip: '127.0.0.1', port: 0, inspectorPort: 0, logLevel: 'error',
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
  });
  running.add(worker);
  return worker;
}
async function stop(worker) { await worker.stop(); running.delete(worker); }
async function terminalTicketsRemoved(name) {
  const storage = path.join(dir, `${name}-state/v3/do/web-e2e-${name}-WebPairingSessionDO`);
  let terminal = 0;
  for (const file of await fs.readdir(storage)) {
    if (!file.endsWith('.sqlite')) continue;
    const db = new DatabaseSync(path.join(storage, file), { readOnly: true });
    try {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE name = '_cf_KV'").get()) continue;
      for (const row of db.prepare('SELECT value FROM _cf_KV WHERE key = ?').all('session')) {
        const record = deserialize(row.value);
        if (record.status === 'consumed' || record.status === 'expired') {
          terminal++;
          assert.equal(record.sponsorTicket, '', 'terminal web record must not retain its ticket');
        }
      }
    } finally { db.close(); }
  }
  assert.ok(terminal > 0, 'must inspect at least one terminal record');
}

async function request(worker, route, body, options = {}) {
  const response = await fetch(`http://127.0.0.1:${worker.port}${route}`, {
    method: options.method || 'POST',
    ...(options.raw instanceof ReadableStream ? { duplex: 'half' } : {}),
    headers: { 'content-type': 'application/json', Origin: options.origin ?? origin,
      'CF-Connecting-IP': options.ip || ip(), ...options.headers },
    ...(options.method === 'OPTIONS' || options.method === 'GET' ? {} : {
      body: options.raw === undefined ? JSON.stringify(body) : options.raw,
    }),
  });
  const text = await response.text();
  const result = { status: response.status, headers: Object.fromEntries(response.headers),
    body: text ? JSON.parse(text) : null };
  records.push({ route, method: options.method || 'POST', ...result });
  if (route.startsWith('/v1/web-pairings')) {
    assert.equal(result.headers.vary, 'Origin');
    assert.equal(result.headers['access-control-allow-credentials'], undefined);
    if (options.cors !== false) assert.equal(result.headers['access-control-allow-origin'], options.origin ?? origin);
    else assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
  return result;
}
const web = '/v1/web-pairings';
const native = '/v1/pairings';
const nativeBody = code => ({ sponsorDeviceId: 'e2e', sponsorDeviceName: 'E2E',
  sponsorEndpointId: 'e2e', sponsorTicket: 'native-test-ticket', proposedCode: code });
function error(result, status, code) {
  assert.equal(result.status, status); assert.deepEqual(result.body, { error: { code } });
}
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
(async () => {
  await fs.mkdir(dir, { recursive: true });
  config = ts.parseConfigFileTextToJson('wrangler.jsonc', await fs.readFile(path.join(root, 'wrangler.jsonc'), 'utf8')).config;
  let worker = await start('development', { WEB_PAIRING_ENV: 'development' });
  let saved;
  await check('lifecycle, repeated resolve, namespace isolation and concurrent consume', async () => {
    const ticket = 'opaque 🐈 tc_not_parsed "\n';
    const created = await request(worker, web, { ticket, ttlSecs: 1, codeLength: 8, proposedCode: '000-001' });
    assert.equal(created.status, 200); assert.match(created.body.code, /^[0-9]{3}-[0-9]{3}$/);
    assert.ok(created.body.expiresAtMs - Date.now() > 295000);
    const { code } = created.body;
    saved = { code, ticket, expiresAtMs: created.body.expiresAtMs };
    error(await request(worker, `${native}/resolve`, { code }), 404, 'pairing_not_found');
    error(await request(worker, `${native}/resolve`, { code: `web:${code}` }), 404, 'pairing_not_found');
    assert.equal((await request(worker, native, nativeBody(code))).status, 200);
    assert.equal((await request(worker, `${native}/resolve`, { code })).body.sponsorTicket, 'native-test-ticket');
    for (const r of await Promise.all([1, 2].map(() => request(worker, `${web}/resolve`, { code })))) {
      assert.equal(r.status, 200); assert.deepEqual(r.body, { ticket, expiresAtMs: saved.expiresAtMs });
    }
    const another = await request(worker, web, { ticket: 'consume-race' });
    const pair = await Promise.all([1, 2].map(() => request(worker, `${web}/consume`, { code: another.body.code })));
    assert.deepEqual(pair.map(r => r.status).sort(), [200, 409]);
    error(await request(worker, `${web}/resolve`, { code: another.body.code }), 409, 'pairing_already_consumed');
    assert.equal((await request(worker, `${native}/consume`, { code })).status, 200);
    assert.equal((await request(worker, `${web}/resolve`, { code })).body.ticket, ticket);
    assert.equal((await request(worker, native, nativeBody('000-001'))).status, 200);
    if (code !== '000-001' && another.body.code !== '000-001') {
      error(await request(worker, `${web}/resolve`, { code: '000-001' }), 404, 'pairing_not_found');
    }
  });
  await check('SQLite state survives real runtime restart', async () => {
    await stop(worker); await terminalTicketsRemoved('development'); worker = await start('development', { WEB_PAIRING_ENV: 'development' });
    const result = await request(worker, `${web}/resolve`, { code: saved.code });
    assert.deepEqual(result.body, { ticket: saved.ticket, expiresAtMs: saved.expiresAtMs });
  });
  await check('JSON types, exact wire format and UTF-8 byte boundaries', async () => {
    for (const ticket of ['', null, 1, {}, [], 'a'.repeat(4097), 'é'.repeat(2048) + 'a', '🐈'.repeat(1024) + 'a']) {
      error(await request(worker, web, { ticket }), 400, 'invalid_request');
    }
    for (const ticket of ['a', 'a'.repeat(4096), 'é'.repeat(2048), '🐈'.repeat(1024)]) {
      const made = await request(worker, web, { ticket }); assert.equal(made.status, 200);
      assert.equal((await request(worker, `${web}/resolve`, { code: made.body.code })).body.ticket, ticket);
    }
    for (const route of [web, `${web}/resolve`, `${web}/consume`]) {
      for (const raw of ['{', 'null', '[]', '"ticket"']) error(await request(worker, route, null, { raw }), 400, 'invalid_request');
    }
    for (const code of ['123456', '123 456', '１２３-４５６', '123-456\n', ' 123-456', 123456, null, 'web:123-456']) {
      for (const route of ['resolve', 'consume']) error(await request(worker, `${web}/${route}`, { code }), 400, 'invalid_request');
    }
  });
  await check('32 KiB raw JSON cap including chunked bodies and worst-case ticket escaping', async () => {
    const padded = (body, size) => { const json = JSON.stringify(body); return json + ' '.repeat(size - Buffer.byteLength(json)); };
    for (const suffix of ['', '/resolve', '/consume']) {
      const body = suffix ? { code: saved.code } : { ticket: 'body-cap-test' };
      error(await request(worker, web + suffix, null, { raw: padded(body, 32769) }), 400, 'invalid_request');
      const text = padded(body, 32769);
      const raw = new ReadableStream({ start(controller) {
        for (let offset = 0; offset < text.length; offset += 8192) controller.enqueue(new TextEncoder().encode(text.slice(offset, offset + 8192)));
        controller.close();
      } });
      error(await request(worker, web + suffix, null, { raw }), 400, 'invalid_request');
    }
    const made = await request(worker, web, null, { raw: padded({ ticket: 'exact-limit' }, 32768) });
    assert.equal(made.status, 200);
    for (const suffix of ['/resolve', '/consume']) assert.equal((await request(worker, web + suffix, null,
      { raw: padded({ code: made.body.code }, 32768) })).status, 200);
    const escaped = await request(worker, web, null, { raw: '{"ticket":"' + '\u0061'.repeat(4096) + '"}' });
    assert.equal(escaped.status, 200);
    assert.equal((await request(worker, web + '/resolve', { code: escaped.body.code })).body.ticket, 'a'.repeat(4096));
    error(await request(worker, web, { ticket: 'ok', ignored: 'é'.repeat(16384) }), 400, 'invalid_request');
  });
  await check('CORS on success/errors/preflight; strict origin allow-list', async () => {
    for (const route of [web, `${web}/resolve`, `${web}/consume`]) {
      const r = await request(worker, route, null, { method: 'OPTIONS', headers: {
        'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
      assert.equal(r.status, 204); assert.equal(r.body, null);
      assert.equal(r.headers['access-control-allow-methods'], 'POST, OPTIONS');
      assert.equal(r.headers['access-control-allow-headers'], 'content-type');
      assert.equal(r.headers['access-control-max-age'], '86400');
      assert.equal((await request(worker, route, null, { method: 'GET' })).status, 405);
    }
    for (const allowed of ['https://uniclipboard.app', 'https://www.uniclipboard.app', 'http://localhost:65535', 'http://localhost']) {
      error(await request(worker, web, {}, { origin: allowed }), 400, 'invalid_request');
    }
    for (const denied of ['null', 'http://127.0.0.1:3000', 'https://localhost:3000', 'http://localhost.evil:3000', 'https://uniclipboard.app.evil', 'http://localhost:3000/path']) {
      error(await request(worker, web, {}, { origin: denied, cors: false }), 400, 'invalid_request');
    }
  });
  await check('all three actual local rate bindings: errors count, quotas independent, new IP separate', async () => {
    // Keep all bursts within one Miniflare fixed window.
    if (Date.now() % 60000 > 50000) await delay(60050 - Date.now() % 60000);
    const client = '198.51.100.1';
    for (const [route, limit] of [[web, 10], [`${web}/resolve`, 20], [`${web}/consume`, 20]]) {
      for (let i = 0; i < limit; i++) error(await request(worker, route, {}, { ip: client }), 400, 'invalid_request');
      const blocked = await request(worker, route, {}, { ip: client });
      error(blocked, 429, 'rate_limited'); assert.equal(blocked.headers['retry-after'], '60');
      assert.equal((await request(worker, route, null, { ip: client, method: 'OPTIONS' })).status, 204);
      error(await request(worker, route, {}, { ip: '198.51.100.2' }), 400, 'invalid_request');
    }
    // Native traffic does not use web quotas.
    assert.equal((await request(worker, native, { ...nativeBody(undefined), codeLength: 6 }, { ip: client })).status, 200);
    console.log('Waiting for the local binding minute window to reset...');
    await delay(60050 - Date.now() % 60000);
    for (const route of [web, `${web}/resolve`, `${web}/consume`]) error(await request(worker, route, {}, { ip: client }), 400, 'invalid_request');
  });
  await check('real browser cross-origin fetch from a static localhost page', async () => {
    const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Web pairing CORS acceptance</title><p>Local static page</p>'); });
    await new Promise(resolve => server.listen(0, 'localhost', resolve));
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(`http://localhost:${server.address().port}`);
      const result = await page.evaluate(async base => {
        const call = async (suffix, body) => {
          const r = await fetch(base + '/v1/web-pairings' + suffix, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
          return { status: r.status, body: await r.json() };
        };
        const created = await call('', { ticket: 'browser-test-ticket' });
        const body = { code: created.body.code };
        return [created, await call('/resolve', body), await call('/consume', body), await call('/resolve', body)];
      }, `http://localhost:${worker.port}`);
      assert.deepEqual(result.map(r => r.status), [200, 200, 200, 409]);
      assert.equal(result[1].body.ticket, 'browser-test-ticket');
      await fs.writeFile(path.join(dir, 'browser.json'), JSON.stringify(result, null, 2));
      await page.screenshot({ path: path.join(dir, 'browser.png') });
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
  });
  await stop(worker);
  await check('development-only quick expiry, repeat resolve does not renew, replacement is a new create', async () => {
    const fast = await start('expiry', { WEB_PAIRING_ENV: 'development', WEB_PAIRING_TTL_SECS: '2' });
    try {
      const a = await request(fast, web, { ticket: 'expiry-test' });
      assert.equal(a.status, 200); assert.ok(a.body.expiresAtMs - Date.now() <= 2000);
      const code = a.body.code;
      assert.equal((await request(fast, `${web}/resolve`, { code })).body.expiresAtMs, a.body.expiresAtMs);
      await delay(Math.max(0, a.body.expiresAtMs - Date.now()) + 100);
      for (const route of ['resolve', 'consume']) error(await request(fast, `${web}/${route}`, { code }), 404, 'pairing_expired');
      const b = await request(fast, web, { ticket: 'replacement-test' });
      assert.equal(b.status, 200); assert.ok(b.body.expiresAtMs > a.body.expiresAtMs);
    } finally { await stop(fast); }
    await terminalTicketsRemoved('expiry');
  });
  for (const mode of ['production', 'typo', undefined]) await check(`${mode ?? 'unset'} environment: localhost denied, short TTL ignored`, async () => {
    const prod = await start(`guard-${mode || 'unset'}`, { ...(mode ? { WEB_PAIRING_ENV: mode } : {}), WEB_PAIRING_TTL_SECS: '1' });
    try {
      const r = await request(prod, web, { ticket: 'production-guard-test', ttlSecs: 1 }, { cors: false });
      assert.equal(r.status, 200); assert.ok(r.body.expiresAtMs - Date.now() > 295000);
      error(await request(prod, web, {}, { origin: 'https://uniclipboard.app' }), 400, 'invalid_request');
    } finally { await stop(prod); }
  });
  await check('caught service faults retain JSON and CORS, no limiter bypass', async () => {
    const broken = await start('missing-binding', { WEB_PAIRING_ENV: 'development' }, { ratelimits: [] });
    try {
      for (const route of [web, `${web}/resolve`, `${web}/consume`]) {
        const r = await request(broken, route, { ticket: 'fault-test', code: '123-456' });
        assert.equal(r.status, 503); assert.equal(typeof r.body.error.code, 'string');
      }
    } finally { await stop(broken); }
  });
})().then(() => { console.log(`Acceptance artifacts: ${dir}`); }, e => {
  console.error(e); records.push({ failure: String(e.stack) }); process.exitCode = 1;
}).finally(async () => {
  for (const worker of running) await worker.stop();
  await fs.writeFile(path.join(dir, 'assertions.json'), JSON.stringify({ passed: !process.exitCode, checks, records,
    rateLimitScope: 'Actual bundled Miniflare binding, in-memory fixed windows; not distributed Cloudflare edge proof' }, null, 2));
});
