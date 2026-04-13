import { generateCode } from "./lib/codes";
import { json, badRequest, notFound } from "./lib/json";
import type { Env } from "./types/env";
import type {
  CreatePairingRequest,
  ResolvePairingRequest,
  ConsumePairingRequest,
} from "./types/api";

export { PairingSessionDO } from "./durable/PairingSessionDO";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/v1/pairings") {
      const body = (await request.json()) as CreatePairingRequest;

      if (
        !body?.sponsorDeviceId ||
        !body?.sponsorDeviceName ||
        !body?.sponsorEndpointId ||
        !body?.sponsorTicket
      ) {
        return badRequest("invalid_request");
      }

      const code = generateCode();
      const id = env.PAIRING_SESSION.idFromName(code);
      const stub = env.PAIRING_SESSION.get(id);

      return stub.fetch("https://do/internal/create", {
        method: "POST",
        body: JSON.stringify({
          code,
          sponsorDeviceId: body.sponsorDeviceId,
          sponsorDeviceName: body.sponsorDeviceName,
          sponsorEndpointId: body.sponsorEndpointId,
          sponsorTicket: body.sponsorTicket,
          ttlSecs: body.ttlSecs ?? 300,
        }),
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/pairings/resolve") {
      const body = (await request.json()) as ResolvePairingRequest;
      if (!body?.code) return badRequest("invalid_request");

      const id = env.PAIRING_SESSION.idFromName(body.code);
      const stub = env.PAIRING_SESSION.get(id);

      return stub.fetch("https://do/internal/resolve", { method: "POST" });
    }

    if (request.method === "POST" && url.pathname === "/v1/pairings/consume") {
      const body = (await request.json()) as ConsumePairingRequest;
      if (!body?.code) return badRequest("invalid_request");

      const id = env.PAIRING_SESSION.idFromName(body.code);
      const stub = env.PAIRING_SESSION.get(id);

      return stub.fetch("https://do/internal/consume", { method: "POST" });
    }

    if (url.pathname === "/healthz") {
      return json({ ok: true });
    }

    return notFound("not_found");
  },
};
