# Web pairing API and local website integration

The web API is separate from native `/v1/pairings/*`. It reuses the existing
pairing lifecycle in a separate `WebPairingSessionDO` storage namespace. Native
routes and storage are unchanged. No account, confirmation UI, renewal or lease
is introduced.

## Contract

All three routes use JSON. Tickets are opaque strings of **1–4096 UTF-8 bytes**;
the service does not parse their content. A code is a string in `NNN-NNN` format,
including leading zeroes.

| POST route | Request | 200 response |
| --- | --- | --- |
| `/v1/web-pairings` | `{"ticket":"test-ticket"}` | `{"code":"123-456","expiresAtMs":1790000000000}` |
| `/v1/web-pairings/resolve` | `{"code":"123-456"}` | `{"ticket":"test-ticket","expiresAtMs":1790000000000}` |
| `/v1/web-pairings/consume` | `{"code":"123-456"}` | `{"ok":true}` |

Create fixes six digits and 300 seconds, ignoring client `ttlSecs`, `codeLength`
and `proposedCode`. It retries allocation collisions at most five times.
`expiresAtMs` is an absolute server timestamp. Resolve is repeatable without
extending expiry. Consume invalidates subsequent lookups; it is **not an atomic
claim**. Anyone holding the code can consume it. Expiry and consumption do not
terminate an established browser transfer or revoke a previously disclosed
ticket. The website enforces one transfer per session. A new code after expiry
requires another create; no server renewal runs automatically.

Errors have shape `{"error":{"code":"..."}}`:

| HTTP | Code |
| --- | --- |
| 400 | `invalid_request` (JSON/body/type, wire format, ticket byte limit) |
| 404 | `pairing_not_found`, `pairing_expired` |
| 409 | `pairing_already_consumed`, `pairing_code_already_exists` (allocation exhausted its five attempts) |
| 405 | `method_not_allowed` |
| 429 | `rate_limited`, with `Retry-After: 60` |
| 503 | `service_unavailable` (including missing/failing bindings) |

Every application response, including failures, has `Vary: Origin`,
`Cache-Control: no-store`, and `Access-Control-Allow-Origin` for an allowed
origin only. Production permits exactly `https://www.uniclipboard.app` and
`https://uniclipboard.app`. No credentials/cookies are enabled. Preflight on
these exact routes returns 204, allows `POST, OPTIONS` and `content-type`, and
sets `Access-Control-Max-Age: 86400`. Disallowed origins receive no allow-origin
header; CORS is not authentication. Infrastructure failures before the Worker
runs cannot be decorated by application code.

Rate limits are independent per route and `CF-Connecting-IP`: create 10/min,
resolve 20/min, consume 20/min. Malformed bodies and wrong-code attempts count;
OPTIONS does not. Missing IP metadata uses a shared `unknown` bucket, never an
unlimited bypass. Do not add client-supplied `CF-Connecting-IP` in website code.
Cloudflare supplies it in production. Missing rate bindings fail closed with 503.

## Install and start locally

Use Node 22 or newer and this repository's locked dependencies:

```sh
cd /path/to/uc-rendezvous
npm ci
# Check availability; choose another unused port if anything is listening.
lsof -nP -iTCP:18787 -sTCP:LISTEN
WRANGLER_SEND_METRICS=false npm run dev:web -- --port 18787 --persist-to .wrangler/web-pairing-local
```

This expands to local-only Wrangler, bound to `127.0.0.1`, with an automatically
assigned inspector port and `WEB_PAIRING_ENV:development`. Use
**`http://localhost:18787`** as the API URL. No Cloudflare login, token, secrets,
remote storage or deployment is required. State is persisted under the explicit
`.wrangler/web-pairing-local` directory. Stop the foreground process with Ctrl-C;
restart with the same command to retain state. Do not run a second process with
the same port/state directory. Leave existing website preview ports untouched.

By default (`npm run dev`, absent/unknown environment, or production), localhost
origins are not allowed. Only the explicit value `WEB_PAIRING_ENV=development`
enables `http://localhost` and `http://localhost:<valid port>` origins. It does
not allow `127.0.0.1` origins, arbitrary hostnames or HTTPS localhost.

For a separate **five-second** expiry instance, choose another free port/state:

```sh
lsof -nP -iTCP:18788 -sTCP:LISTEN
WRANGLER_SEND_METRICS=false npm run dev:web -- --port 18788 --persist-to .wrangler/web-pairing-expiry --var WEB_PAIRING_TTL_SECS:5
```

`WEB_PAIRING_TTL_SECS` is a server-side development-only override, not a request
field. It must be an integer from 1 to 300; invalid development configuration
returns 503 on create. Production ignores the override and always uses 300.
Never set `WEB_PAIRING_ENV=development` on production. The committed default is
`production`; the dev command opts in explicitly. No deployment is part of this
workflow.

## Website (t-0047) setup

In the website development environment, set both values explicitly:

```dotenv
NEXT_PUBLIC_TRY_SHORT_CODE=1
NEXT_PUBLIC_TRY_RENDEZVOUS_URL=http://localhost:18787
```

For quick-expiry scenarios use `http://localhost:18788` instead. **Restart the
frontend dev server after changing these values.** For a static build, rebuild
because `NEXT_PUBLIC_*` values are bundled. Open the website at
`http://localhost:<its existing port>`, not a 127.0.0.1 origin. Keep its existing
start command/port (do not start or rebuild a second preview in its directory).

Calls go directly from the static browser page to this API; no SSR/Vercel proxy
is needed. Inspect browser Network and confirm the host is localhost before
using the short-code feature. The website defaults to the production API if
its URL is omitted, so **never enable the flag without the local URL here**.
Do not copy the local overrides into production deployment settings.

## Copyable curl checks (test tickets only)

These commands deliberately hard-code a local base and bypass shell proxy
settings. `Origin` simulates the website for header inspection; curl itself does
not enforce CORS. Use an otherwise idle local service to avoid consuming an
existing test's IP quota.

```sh
WEB_PAIRING_BASE=http://localhost:18787
WEB_PAIRING_ORIGIN=http://localhost:3105

# Preflight: 204; echoed Origin, Vary: Origin, POST/OPTIONS, content-type.
curl --noproxy '*' -i -X OPTIONS "$WEB_PAIRING_BASE/v1/web-pairings" \
  -H "Origin: $WEB_PAIRING_ORIGIN" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'

# Create: 200 with NNN-NNN and an expiry about 300 seconds ahead.
WEB_PAIRING_CREATED=$(curl --noproxy '*' -fsS "$WEB_PAIRING_BASE/v1/web-pairings" \
  -H "Origin: $WEB_PAIRING_ORIGIN" -H 'Content-Type: application/json' \
  --data '{"ticket":"local-test-ticket"}')
WEB_PAIRING_CODE=$(printf '%s' "$WEB_PAIRING_CREATED" | node -e \
  'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).code))')
printf '%s\n' "$WEB_PAIRING_CREATED"

# Resolve: 200, ticket local-test-ticket and the original expiry; repeatable.
curl --noproxy '*' -i "$WEB_PAIRING_BASE/v1/web-pairings/resolve" \
  -H "Origin: $WEB_PAIRING_ORIGIN" -H 'Content-Type: application/json' \
  --data "{\"code\":\"$WEB_PAIRING_CODE\"}"

# Consume: 200 {"ok":true}.
curl --noproxy '*' -i "$WEB_PAIRING_BASE/v1/web-pairings/consume" \
  -H "Origin: $WEB_PAIRING_ORIGIN" -H 'Content-Type: application/json' \
  --data "{\"code\":\"$WEB_PAIRING_CODE\"}"

# Same resolve again: 409 pairing_already_consumed (until expiry, then 404).
curl --noproxy '*' -i "$WEB_PAIRING_BASE/v1/web-pairings/resolve" \
  -H "Origin: $WEB_PAIRING_ORIGIN" -H 'Content-Type: application/json' \
  --data "{\"code\":\"$WEB_PAIRING_CODE\"}"
```

For expiry, set the base to 18788, run create and resolve without consume, wait
six seconds, then resolve/consume: 404 `pairing_expired`. Create again for a new
300-second (or local five-second) record; the expired one is not renewed.

For repeatable 429 checks, send malformed bodies, which spend quota without
creating any records. This Node script refuses any remote target and uses
reserved documentation IPs only against local Wrangler. Production does not
trust this spoofed header; these are local test identities. Each run uses a new
identity to avoid interfering with browser loopback quotas:

```sh
node <<'JS'
const base = 'http://localhost:18787';
(async () => {
  if (new URL(base).hostname !== 'localhost') throw new Error('Local only');
  // Local Miniflare uses minute-aligned windows; start away from the boundary.
  if (Date.now() % 60000 > 50000) await new Promise(r => setTimeout(r, 60050 - Date.now() % 60000));
  const ip = `2001:db8::${Date.now().toString(16).slice(-4)}`;
  for (const [suffix, limit] of [['',10], ['/resolve',20], ['/consume',20]]) {
    for (let i=1; i<=limit+1; i++) {
      const r = await fetch(base+'/v1/web-pairings'+suffix, {
        method:'POST', headers:{'Content-Type':'application/json',
          Origin:'http://localhost:3105','CF-Connecting-IP':ip}, body:'{}'
      });
      const body = await r.json();
      if (i===limit+1) {
        if (r.status!==429) throw new Error(JSON.stringify(body));
        console.log(suffix||'create',r.status,body,r.headers.get('Retry-After'),r.headers.get('Access-Control-Allow-Origin'));
      } else if(r.status!==400) throw new Error(JSON.stringify(body));
    }
  }
})().catch(e=>{console.error(e);process.exitCode=1});
JS
```

Expect first 10/20/20 calls 400 and the next 429 `rate_limited`, retry-after 60,
allowed Origin. A fresh minute restores the local quota. Don't run this against
production or a shared website API.

## Automated acceptance and evidence

```sh
npm run typecheck
npm test                     # existing native regression tests
npm exec -- playwright install chromium
WRANGLER_SEND_METRICS=false npm run test:web
```

`test:web` starts only local workerd on OS-assigned ports, uses real SQLite DO
storage and the packaged rate-limit bindings, restarts the runtime to verify
persistence, and opens a separate headless Chromium to a tiny static localhost
page. It never uses an external target or an existing website process. It also
starts a local misconfigured instance without rate bindings to test 503 JSON and
CORS; no product fault injection switch exists.

It saves `assertions.json`, `browser.json`, `browser.png`, runtime configuration
and persistent state under `.wrangler/web-pairing-e2e/<timestamp>/`. Instances
started by the test stop at the end; artifacts/state remain. The handoff service
has a different state directory and is not stopped. Failure hypotheses are
covered by lifecycle, concurrent consume, byte/format boundaries, namespace
isolation (including a `web:` prefix on the native route), repeated lookups,
expiry, per-route quotas/recovery, error CORS, and default/production development
guards.

### Local limiter and deployment boundary

Wrangler 4.81.1 / Miniflare 4.20260409.0 (the current lockfile) execute the bundled
rate-limit simulation, which uses in-memory, minute-aligned buckets. It resets
on runtime restart/reload, and is not a distributed edge implementation. The
suite verifies the **actual local binding**, not a hand-written stub. Passing it
is not production rate-limit acceptance. Cloudflare's production binding is
per-location and permissive/eventually consistent, rather than a strict global
counter. This is the binding option allowed by the contract. `Retry-After:60`
is a conservative wait because the binding exposes success only, not its reset
time. [Cloudflare binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

The config assigns rate namespace IDs 231001/231002/231003 for web create,
resolve, consume and adds migration v2 for the new SQLite DO class. Before a
separately authorized deployment, confirm these account-wide rate namespace
IDs are not used by unrelated Workers. No account state was queried or changed
for local development. Do not use `--remote`, remote bindings or a deployment
command when following this guide. A deployment would also need independent
production browser/CORS and edge-limit verification.

## Production migrations

A new Durable Object class requires an ordinary `npm run deploy` deployment
from the reviewed, merged source. Cloudflare `wrangler versions upload` cannot
apply a pending DO migration and fails with API error 10211. Do not remove the
migration or switch PR preview builds to production deploy to silence that check.
After the migration is applied, subsequent version uploads can use the existing
migration tag. Verify the deployed version, migration tag, both distinct DO
namespace IDs, and all three rate-limit bindings before enabling the website.

Web terminal records retain status/timestamps for the existing error semantics,
but clear their opaque ticket in the same storage write on consume or expiry
(including lazy expiry and alarm expiry). This is logical removal from the active
record, not a claim of secure erasure from provider backups or SQLite history.
The native record lifecycle is unchanged.

The acceptance script's persisted-record checks use Node's built-in SQLite API
(Node 22.13+; tested with 22.22.1) to inspect real local DO KV values after the
runtime stops.
