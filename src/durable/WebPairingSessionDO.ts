import { PairingSessionDO } from "./PairingSessionDO";

// Reuse the lifecycle, but give web tickets a distinct durable storage namespace.
// A name prefix alone is insufficient: native resolve accepts arbitrary names.
export class WebPairingSessionDO extends PairingSessionDO {}
