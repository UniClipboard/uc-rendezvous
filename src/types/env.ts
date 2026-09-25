export interface Env {
  PAIRING_SESSION: DurableObjectNamespace;
  WEB_PAIRING_SESSION: DurableObjectNamespace;
  WEB_CREATE_LIMITER: RateLimit;
  WEB_RESOLVE_LIMITER: RateLimit;
  WEB_CONSUME_LIMITER: RateLimit;
  WEB_PAIRING_ENV?: string;
  WEB_PAIRING_TTL_SECS?: string;
}
