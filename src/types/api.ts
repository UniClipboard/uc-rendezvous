export interface CreatePairingRequest {
  sponsorDeviceId: string;
  sponsorDeviceName: string;
  sponsorEndpointId: string;
  sponsorTicket: string;
  ttlSecs?: number;
  /** Server-generated digit count; defaults to 8. Cannot accompany proposedCode. */
  codeLength?: 6 | 8;
  /**
   * Optional client-minted pairing code. When provided, the server stores
   * the session under this code instead of generating one. Accepts six digits
   * in `XXX-XXX` shape or the legacy `XXXX-XXXX` format (see `isValidProposedCode`).
   *
   * Enables LAN-only first pair: clients mint locally so pairing is not
   * blocked by rendezvous reachability, while the cloud entry still acts
   * as a cross-network index when WAN is available.
   *
   * Clients that omit this field get a server-minted code (8 digits by default).
   */
  proposedCode?: string;
}

export interface CreatePairingResponse {
  code: string;
  expiresAtMs: number;
}

export interface ResolvePairingRequest {
  code: string;
}

export interface ResolvePairingResponse {
  code: string;
  status: PairingStatus;
  sponsorDeviceId: string;
  sponsorDeviceName: string;
  sponsorEndpointId: string;
  sponsorTicket: string;
  expiresAtMs: number;
}

export interface ConsumePairingRequest {
  code: string;
}

export type PairingStatus = "pending" | "resolved" | "consumed" | "expired";

export interface PairingSessionRecord {
  code: string;
  status: PairingStatus;

  sponsorDeviceId: string;
  sponsorDeviceName: string;
  sponsorEndpointId: string;
  sponsorTicket: string;

  createdAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  consumedAtMs?: number;
}
