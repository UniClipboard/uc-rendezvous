# UniClipboard Rendezvous MVP

A minimal pairing service on Cloudflare Workers + Durable Objects. It does three things:

- Old device uploads a ticket and gets a short pairing code
- New device enters the code and retrieves the ticket
- After pairing, the code is consumed and becomes invalid

## Project Structure

```
src/
├── index.ts                  # Worker entry, request routing
├── durable/
│   └── PairingSessionDO.ts   # Pairing session state machine (Durable Object)
├── lib/
│   ├── codes.ts              # Short code generator
│   └── json.ts               # JSON response helpers
└── types/
    ├── api.ts                # DTO types
    └── env.ts                # Env bindings
```

## Local Development

```bash
npm install
npm run dev
```

## Deploy

See [deployment docs](docs/configure-and-deploy.md).

## API

### `POST /v1/pairings`

Create a pairing session.

```json
{
  "sponsorDeviceId": "device-123",
  "sponsorDeviceName": "Mark's MacBook Pro",
  "sponsorEndpointId": "ep_abc123",
  "sponsorTicket": "iroh-ticket-xxx",
  "ttlSecs": 300
}
```

Response:

```json
{
  "code": "A7K3-P9Q2",
  "expiresAtMs": 1710000000000
}
```

### `POST /v1/pairings/resolve`

Resolve a pairing code to get the ticket.

```json
{ "code": "A7K3-P9Q2" }
```

### `POST /v1/pairings/consume`

Mark a pairing code as consumed.

```json
{ "code": "A7K3-P9Q2" }
```

### `GET /healthz`

Health check. Returns `{"ok": true}`.
