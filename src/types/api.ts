export interface CreatePairingRequest {
  sponsorDeviceId: string;
  sponsorDeviceName: string;
  sponsorEndpointId: string;
  sponsorTicket: string;
  ttlSecs?: number;
  /**
   * Optional client-minted pairing code. When provided, the server stores
   * the session under this code instead of generating one. Format must
   * match the server alphabet (`XXXX-XXXX`, see `isValidProposedCode`).
   *
   * Enables LAN-only first pair: clients mint locally so pairing is not
   * blocked by rendezvous reachability, while the cloud entry still acts
   * as a cross-network index when WAN is available.
   *
   * Older clients that omit this field get the legacy server-mint flow.
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
