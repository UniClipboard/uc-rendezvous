import type { PairingSessionRecord } from "../types/api";
import { PairingSessionDO } from "./PairingSessionDO";

// Reuse the lifecycle, but give web tickets a distinct durable storage namespace.
// A name prefix alone is insufficient: native resolve accepts arbitrary names.
export class WebPairingSessionDO extends PairingSessionDO {
  protected override async storeSession(record: PairingSessionRecord): Promise<void> {
    // Retain the lifecycle tombstone, but discard its opaque capability.
    // Sanitize the same write, never a later read-modify-write that could
    // race a replacement registration in this code slot.
    if (record.status === "consumed" || record.status === "expired") record.sponsorTicket = "";
    await super.storeSession(record);
  }
}
