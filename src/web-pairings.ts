import { generateCode } from "./lib/codes";
import { badRequest, json, methodNotAllowed } from "./lib/json";
import type { Env } from "./types/env";
import type { ResolvePairingResponse } from "./types/api";

type Operation = "create" | "resolve" | "consume";
const routes = new Map<string, Operation>([
  ["/v1/web-pairings", "create"],
  ["/v1/web-pairings/resolve", "resolve"],
  ["/v1/web-pairings/consume", "consume"],
]);

function cors(response: Response, request: Request, env: Env): Response {
  const origin = request.headers.get("Origin");
  const headers = new Headers(response.headers);
  headers.set("Vary", "Origin");
  headers.set("Cache-Control", "no-store");
  const localhost = env.WEB_PAIRING_ENV === "development" && origin !== null &&
    /^http:\/\/localhost(?::[0-9]+)?$/.test(origin) && validOrigin(origin);
  if (origin === "https://try.uniclipboard.app" || origin === "https://www.uniclipboard.app" || origin === "https://uniclipboard.app" || localhost) {
    headers.set("Access-Control-Allow-Origin", origin!);
  }
  return new Response(response.body, { status: response.status, headers });
}

function validOrigin(origin: string): boolean {
  try { return new URL(origin).hostname === "localhost"; } catch { return false; }
}

function ttlSecs(env: Env): number {
  if (env.WEB_PAIRING_ENV !== "development" || env.WEB_PAIRING_TTL_SECS === undefined) return 300;
  const ttl = Number(env.WEB_PAIRING_TTL_SECS);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 300) throw new Error("Invalid local web pairing TTL");
  return ttl;
}

// Bound raw bytes before decoding/parsing, including requests without Content-Length.
async function readJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing JSON body");
  const reader = request.body.getReader();
  const bytes = new Uint8Array(32 * 1024);
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength > bytes.byteLength - length) {
        await reader.cancel();
        throw new Error("JSON body too large");
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
}

async function handle(request: Request, env: Env, operation: Operation): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
    } });
  }
  if (request.method !== "POST") return methodNotAllowed();

  const limiter = operation === "create" ? env.WEB_CREATE_LIMITER :
    operation === "resolve" ? env.WEB_RESOLVE_LIMITER : env.WEB_CONSUME_LIMITER;
  // Count malformed bodies and wrong codes too. Missing metadata shares a
  // bucket rather than bypassing the limiter. Cloudflare supplies the IP in production.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const { success } = await limiter.limit({ key: `uc-rendezvous:web:${operation}:${ip}` });
  if (!success) return json({ error: { code: "rate_limited" } }, {
    status: 429, headers: { "Retry-After": "60" },
  });

  let body: unknown;
  try { body = await readJson(request); } catch { return badRequest("invalid_request"); }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return badRequest("invalid_request");
  const fields = body as Record<string, unknown>;

  if (operation === "create") {
    if (typeof fields.ticket !== "string") return badRequest("invalid_request");
    const bytes = new TextEncoder().encode(fields.ticket).byteLength;
    if (bytes < 1 || bytes > 4096) return badRequest("invalid_request");
    // Client TTL, codeLength and proposedCode are deliberately ignored.
    const ttl = ttlSecs(env);
    for (let attempt = 1; ; attempt++) {
      const code = generateCode(6);
      const stub = env.WEB_PAIRING_SESSION.get(env.WEB_PAIRING_SESSION.idFromName(code));
      const response = await stub.fetch("https://do/internal/create", { method: "POST", body: JSON.stringify({
        code, sponsorDeviceId: "web", sponsorDeviceName: "Web pairing",
        sponsorEndpointId: "web", sponsorTicket: fields.ticket, ttlSecs: ttl,
      }) });
      if (response.status >= 500) throw new Error("Web pairing storage unavailable");
      if (response.status !== 409 || attempt === 5) return response;
      await response.body?.cancel();
    }
  }

  if (typeof fields.code !== "string" || fields.code.length !== 7 || !/^[0-9]{3}-[0-9]{3}$/.test(fields.code)) {
    return badRequest("invalid_request");
  }
  const stub = env.WEB_PAIRING_SESSION.get(env.WEB_PAIRING_SESSION.idFromName(fields.code));
  const response = await stub.fetch(`https://do/internal/${operation}`, { method: "POST" });
  if (response.status >= 500) throw new Error("Web pairing storage unavailable");
  if (operation !== "resolve" || !response.ok) return response;
  const record = await response.json<ResolvePairingResponse>();
  return json({ ticket: record.sponsorTicket, expiresAtMs: record.expiresAtMs });
}

/** null leaves every existing native route untouched. */
export async function webPairings(request: Request, env: Env): Promise<Response | null> {
  const operation = routes.get(new URL(request.url).pathname);
  if (!operation) return null;
  let response: Response;
  try { response = await handle(request, env, operation); } catch {
    // Do not log tickets, codes, request bodies or thrown platform payloads.
    response = json({ error: { code: "service_unavailable" } }, { status: 503 });
  }
  return cors(response, request, env);
}
