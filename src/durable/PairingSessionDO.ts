import { DurableObject } from "cloudflare:workers";
import { json, notFound, conflict } from "../lib/json";
import type { Env } from "../types/env";
import type { PairingSessionRecord } from "../types/api";

export class PairingSessionDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/internal/create") {
      return this.handleCreate(request);
    }

    if (request.method === "POST" && url.pathname === "/internal/resolve") {
      return this.handleResolve();
    }

    if (request.method === "POST" && url.pathname === "/internal/consume") {
      return this.handleConsume();
    }

    return notFound("not_found");
  }

  private async handleCreate(request: Request): Promise<Response> {
    const body = await request.json<{
      code: string;
      sponsorDeviceId: string;
      sponsorDeviceName: string;
      sponsorEndpointId: string;
      sponsorTicket: string;
      ttlSecs: number;
    }>();

    const now = Date.now();
    const expiresAtMs = now + body.ttlSecs * 1000;

    const existing = await this.ctx.storage.get<PairingSessionRecord>("session");
    if (existing && existing.status !== "expired" && existing.status !== "consumed") {
      return conflict("pairing_code_already_exists");
    }

    const record: PairingSessionRecord = {
      code: body.code,
      status: "pending",
      sponsorDeviceId: body.sponsorDeviceId,
      sponsorDeviceName: body.sponsorDeviceName,
      sponsorEndpointId: body.sponsorEndpointId,
      sponsorTicket: body.sponsorTicket,
      createdAtMs: now,
      expiresAtMs,
    };

    await this.ctx.storage.put("session", record);
    await this.ctx.storage.setAlarm(expiresAtMs);

    return json({
      code: record.code,
      expiresAtMs: record.expiresAtMs,
    });
  }

  private async handleResolve(): Promise<Response> {
    const record = await this.ctx.storage.get<PairingSessionRecord>("session");
    if (!record) return notFound("pairing_not_found");

    const now = Date.now();
    if (now >= record.expiresAtMs || record.status === "expired") {
      record.status = "expired";
      await this.ctx.storage.put("session", record);
      return notFound("pairing_expired");
    }

    if (record.status === "consumed") {
      return conflict("pairing_already_consumed");
    }

    if (record.status === "pending") {
      record.status = "resolved";
      record.resolvedAtMs = now;
      await this.ctx.storage.put("session", record);
    }

    return json({
      code: record.code,
      status: record.status,
      sponsorDeviceId: record.sponsorDeviceId,
      sponsorDeviceName: record.sponsorDeviceName,
      sponsorEndpointId: record.sponsorEndpointId,
      sponsorTicket: record.sponsorTicket,
      expiresAtMs: record.expiresAtMs,
    });
  }

  private async handleConsume(): Promise<Response> {
    const record = await this.ctx.storage.get<PairingSessionRecord>("session");
    if (!record) return notFound("pairing_not_found");

    const now = Date.now();
    if (now >= record.expiresAtMs || record.status === "expired") {
      record.status = "expired";
      await this.ctx.storage.put("session", record);
      return notFound("pairing_expired");
    }

    if (record.status === "consumed") {
      return conflict("pairing_already_consumed");
    }

    record.status = "consumed";
    record.consumedAtMs = now;
    await this.ctx.storage.put("session", record);

    return json({ ok: true });
  }

  async alarm(): Promise<void> {
    const record = await this.ctx.storage.get<PairingSessionRecord>("session");
    if (!record) return;

    if (Date.now() >= record.expiresAtMs && record.status !== "consumed") {
      record.status = "expired";
      await this.ctx.storage.put("session", record);
    }
  }
}
