# Configure and Deploy

## Prerequisites

1. A Cloudflare account
2. Node.js installed locally
3. `wrangler` CLI (installed via `npm install`)

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Login to Cloudflare

```bash
npx wrangler login
```

## Step 3: Local Development

```bash
npm run dev
```

This starts a local dev server with Durable Objects support.

## Step 4: Deploy

```bash
npm run deploy
```

After deployment, the terminal will print your service URL.

## Step 5: Verify

Health check:

```bash
curl https://your-service-url/healthz
```

Create a pairing:

```bash
curl -X POST https://your-service-url/v1/pairings \
  -H "content-type: application/json" \
  -d '{
    "sponsorDeviceId": "device-123",
    "sponsorDeviceName": "Old Device",
    "sponsorEndpointId": "endpoint-abc",
    "sponsorTicket": "iroh-ticket-xxx",
    "ttlSecs": 300
  }'
```

Resolve with the returned code:

```bash
curl -X POST https://your-service-url/v1/pairings/resolve \
  -H "content-type: application/json" \
  -d '{ "code": "A7K3-P9Q2" }'
```

Consume after pairing:

```bash
curl -X POST https://your-service-url/v1/pairings/consume \
  -H "content-type: application/json" \
  -d '{ "code": "A7K3-P9Q2" }'
```
