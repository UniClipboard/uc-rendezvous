export interface CreatePairingRequest {
  sponsorDeviceId: string;
  sponsorDeviceName: string;
  sponsorEndpointId: string;
  sponsorTicket: string;
  ttlSecs?: number;
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
