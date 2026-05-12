// Shared types for the rebuilt credential-resolution layer.
//
// A `ResolvedCredential` decouples *where* the bearer comes from (static env
// var, Codex auth.json api-key field, Codex OAuth access_token with refresh)
// from *which* OpenAI-compatible endpoint the adapter will hit. Adapters read
// only from a `ResolvedCredential` — they no longer touch `process.env`.

export type AuthMode =
  | 'api-key' // env OPENAI_API_KEY + OPENAI_BASE_URL (or a relay)
  | 'codex-key' // ~/.codex/auth.json OPENAI_API_KEY field
  | 'codex-oauth' // ~/.codex/auth.json tokens.access_token → chatgpt.com/backend-api/codex
  | 'codex-auto'; // env api-key → auth.json api-key → auth.json oauth

export type CredentialKind = 'static' | 'codex-oauth';

export interface ResolvedCredential {
  /** What produced this credential. Lets the adapter layer pick a compatible endpoint. */
  kind: CredentialKind;
  /** Static bearer when `kind === 'static'`. */
  bearer?: string;
  /** Lazy bearer fetcher when `kind === 'codex-oauth'` (handles cache + refresh). */
  fetchBearer?: () => Promise<string>;
  /** Endpoint root without trailing slash. Adapters append `/v1/images/generations` etc. */
  endpointBase: string;
  /** Extra headers the adapter must send on every request (e.g. `Originator: codex-tui`). */
  extraHeaders?: Record<string, string>;
  /** Override UA. Falls back to the adapter's own default when omitted. */
  userAgent?: string;
  /** Preferred adapter transport inferred from provider config (e.g. Responses-only relays). */
  preferredTransport?: 'gpt-image' | 'gpt-image-responses';
  /** The auth mode that produced this credential (for logging + auto-mode decisions). */
  resolvedFrom: AuthMode;
}

/** Thrown when `resolveCredential(mode)` cannot satisfy the requested mode. */
export class CredentialResolutionError extends Error {
  constructor(message: string, readonly mode: AuthMode) {
    super(message);
    this.name = 'CredentialResolutionError';
  }
}
