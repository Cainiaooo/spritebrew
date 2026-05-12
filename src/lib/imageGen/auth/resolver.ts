// resolveCredential(mode) → ResolvedCredential
//
// Maps an AuthMode to a runnable credential shape.
//   api-key     — env OPENAI_API_KEY + OPENAI_BASE_URL
//   codex-key   — ~/.codex/auth.json `OPENAI_API_KEY` field
//                 + ~/.codex/config.toml `model_providers.<model_provider>.base_url`
//                 (falls back to env OPENAI_BASE_URL, then api.openai.com)
//   codex-oauth — ~/.codex/auth.json `tokens.*` → chatgpt.com/backend-api/codex
//   codex-auto  — env → auth.json api-key → auth.json oauth
//                 (auth.json api-key path also reads config.toml base_url)
//
// Rationale for the codex-key base-url precedence: codex users typically
// configure their provider (including relay URLs) via `~/.codex/config.toml`,
// and the api-image Python reference does the same. Mirroring that avoids
// a footgun where SpriteBrew silently hits api.openai.com with a relay key.
//
// For codex-oauth / codex-auto(-oauth path) the returned credential carries
// a `fetchBearer` closure bound to a module-level CodexTokenStore cache keyed
// by codexHome, so multiple adapters share the same refresh mutex.

import {
  type AuthMode,
  type ResolvedCredential,
  CredentialResolutionError,
} from './types';
import {
  CodexAuthFileError,
  type CodexAuthRecord,
  readAuthRecord,
  resolveCodexHome,
  type CodexAuthTokens,
} from './codexAuthFile';
import {
  CodexConfigTomlError,
  resolveCodexProviderConfig,
} from './codexConfigToml';
import { readCachedTokenPair, writeCachedTokenPair } from './codexTokenCache';
import { CodexTokenStore, CodexReauthRequiredError } from './codexTokenStore';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';
const CODEX_BACKEND_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CODEX_TUI_USER_AGENT =
  'codex-tui/0.118.0 (Mac OS 26.3.1; arm64) iTerm.app/3.6.9 (codex-tui; 0.118.0)';

/** Module-level token-store cache, keyed by resolved Codex home. */
const tokenStoreCache = new Map<
  string,
  { sourceRefreshToken: string; store: CodexTokenStore }
>();

export async function resolveCredential(mode: AuthMode): Promise<ResolvedCredential> {
  switch (mode) {
    case 'api-key':
      return resolveApiKey();
    case 'codex-key':
      return resolveCodexKey();
    case 'codex-oauth':
      return resolveCodexOAuth();
    case 'codex-auto':
      return resolveCodexAuto();
    default: {
      const exhaustive: never = mode;
      throw new CredentialResolutionError(
        `Unknown IMAGE_GEN_AUTH_MODE: ${exhaustive as string}`,
        mode,
      );
    }
  }
}

/** Test-only: clear cached token stores so a fresh `auth.json` read happens. */
export function resetResolverCache(): void {
  tokenStoreCache.clear();
}

function resolveApiKey(): ResolvedCredential {
  const bearer = process.env.OPENAI_API_KEY;
  if (!bearer || bearer.trim() === '') {
    throw new CredentialResolutionError(
      'OPENAI_API_KEY is not set. Set it in your environment or switch IMAGE_GEN_AUTH_MODE.',
      'api-key',
    );
  }
  // `api-key` mode is the pure env path; we intentionally do NOT read
  // ~/.codex/config.toml here even if it exists — the assumption is that
  // the user chose this mode because they want env-driven configuration.
  return buildStaticCredential('api-key', bearer.trim());
}

async function resolveCodexKey(): Promise<ResolvedCredential> {
  const home = resolveCodexHome();
  const record = await readAuthRecordOrThrow(home, 'codex-key');
  if (!record.auth.openaiApiKey) {
    throw new CredentialResolutionError(
      `${describeCodexAuthSource(record, home)} has no OPENAI_API_KEY field. Run \`codex login --with-api-key\` or switch IMAGE_GEN_AUTH_MODE to codex-oauth.`,
      'codex-key',
    );
  }
  // Read base_url from ~/.codex/config.toml to match how the user has
  // configured Codex itself (relay, custom gateway, etc.). Env var takes
  // precedence when set.
  const providerConfig = await resolveStaticProviderConfig(home, 'codex-key');
  return buildStaticCredential('codex-key', record.auth.openaiApiKey, providerConfig);
}

async function resolveCodexOAuth(): Promise<ResolvedCredential> {
  const home = resolveCodexHome();
  const record = await readAuthRecordOrThrow(home, 'codex-oauth');
  if (!record.auth.tokens) {
    throw new CredentialResolutionError(
      `${describeCodexAuthSource(record, home)} has no \`tokens\` block. Run \`codex login\` (without --with-api-key) to authenticate via ChatGPT OAuth.`,
      'codex-oauth',
    );
  }
  const seed = await resolveOAuthSeed(home, record.auth.tokens);
  const store = ensureTokenStore(
    home,
    seed.accessToken,
    seed.refreshToken,
    record.auth.tokens.refresh_token,
  );
  return buildOAuthCredential('codex-oauth', store);
}

async function resolveCodexAuto(): Promise<ResolvedCredential> {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) {
    // Env path: pair with env base_url, not codex config. The two env vars
    // are treated as a matched set.
    return buildStaticCredential('codex-auto', envKey);
  }

  const home = resolveCodexHome();
  let record: CodexAuthRecord;
  try {
    record = await readAuthRecord(home);
  } catch (err) {
    if (err instanceof CodexAuthFileError) {
      throw new CredentialResolutionError(
        `Could not resolve any credential (env OPENAI_API_KEY missing, and ${err.message}).`,
        'codex-auto',
      );
    }
    throw err;
  }

  const auth = record.auth;
  if (auth.openaiApiKey) {
    // auth.json api-key pairs with config.toml base_url (same reasoning as
    // codex-key); env still wins when set.
    const providerConfig = await resolveStaticProviderConfig(home, 'codex-auto');
    return buildStaticCredential('codex-auto', auth.openaiApiKey, providerConfig);
  }
  if (auth.tokens) {
    const seed = await resolveOAuthSeed(home, auth.tokens);
    const store = ensureTokenStore(
      home,
      seed.accessToken,
      seed.refreshToken,
      auth.tokens.refresh_token,
    );
    return buildOAuthCredential('codex-auto', store);
  }
  throw new CredentialResolutionError(
    `${describeCodexAuthSource(record, home)} has neither OPENAI_API_KEY nor tokens. Run \`codex login\` first.`,
    'codex-auto',
  );
}

async function readAuthRecordOrThrow(home: string, mode: AuthMode): Promise<CodexAuthRecord> {
  try {
    return await readAuthRecord(home);
  } catch (err) {
    if (err instanceof CodexAuthFileError) {
      throw new CredentialResolutionError(err.message, mode);
    }
    throw err;
  }
}

function ensureTokenStore(
  codexHome: string,
  accessToken: string,
  refreshToken: string,
  sourceRefreshToken: string,
): CodexTokenStore {
  const existing = tokenStoreCache.get(codexHome);
  if (existing && existing.sourceRefreshToken === sourceRefreshToken) {
    return existing.store;
  }
  const store = new CodexTokenStore({
    accessToken,
    refreshToken,
    persistRotatedTokens: (tokens) =>
      writeCachedTokenPair(codexHome, sourceRefreshToken, tokens),
  });
  tokenStoreCache.set(codexHome, { sourceRefreshToken, store });
  return store;
}

function buildStaticCredential(
  resolvedFrom: Exclude<AuthMode, 'codex-oauth'>,
  bearer: string,
  providerConfig?: {
    baseUrl?: string;
    preferredTransport?: 'gpt-image-responses';
  },
): ResolvedCredential {
  // Precedence: env OPENAI_BASE_URL > codex config.toml base_url > default.
  // Env wins so operators can override codex's setting without editing it.
  const envBase = process.env.OPENAI_BASE_URL?.trim();
  const candidate =
    envBase && envBase.length > 0
      ? envBase
      : providerConfig?.baseUrl && providerConfig.baseUrl.length > 0
        ? providerConfig.baseUrl
        : DEFAULT_OPENAI_BASE_URL;
  const endpointBase = trimSlash(candidate);
  return {
    kind: 'static',
    bearer,
    endpointBase,
    preferredTransport: providerConfig?.preferredTransport,
    resolvedFrom,
  };
}

/**
 * Resolve the base_url that Codex itself would use for the active provider.
 * Never throws on missing-file / parse errors — callers always have the env
 * fallback. Hard IO errors (EACCES etc.) are wrapped as
 * `CredentialResolutionError` so the root cause surfaces instead of
 * silently falling through.
 *
 * Codex's config.toml conventionally stores `base_url = "…/v1"` (the
 * api-image reference pairs it with `/images/generations`). Our adapters
 * append `/v1/images/generations`, so we strip a trailing `/v1` here to
 * keep both conventions interoperable.
 */
async function resolveStaticProviderConfig(
  home: string,
  mode: AuthMode,
): Promise<{ baseUrl?: string; preferredTransport?: 'gpt-image-responses' } | undefined> {
  try {
    const raw = await resolveCodexProviderConfig(home);
    if (!raw) return undefined;
    return {
      baseUrl: raw.baseUrl ? normalizeCodexBaseUrl(raw.baseUrl) : undefined,
      preferredTransport: normalizePreferredTransport(raw.wireApi),
    };
  } catch (err) {
    if (err instanceof CodexConfigTomlError) {
      throw new CredentialResolutionError(err.message, mode);
    }
    throw err;
  }
}

function normalizePreferredTransport(
  wireApi?: string,
): 'gpt-image-responses' | undefined {
  if (!wireApi) return undefined;
  return wireApi.trim().toLowerCase() === 'responses' ? 'gpt-image-responses' : undefined;
}

function normalizeCodexBaseUrl(raw: string): string {
  const trimmed = trimSlash(raw.trim());
  // Only peel a single trailing `/v1`; leave `/v1beta`, `/v2`, etc. alone.
  return trimmed.replace(/\/v1$/, '');
}

function buildOAuthCredential(
  resolvedFrom: Extract<AuthMode, 'codex-oauth' | 'codex-auto'>,
  store: CodexTokenStore,
): ResolvedCredential {
  return {
    kind: 'codex-oauth',
    endpointBase: CODEX_BACKEND_BASE_URL,
    fetchBearer: () =>
      store.getAccessToken().catch((err: unknown) => {
        // Re-surface CodexReauthRequiredError unchanged; wrap anything else
        // so adapters see a consistent error type.
        if (err instanceof CodexReauthRequiredError) throw err;
        throw new Error(
          `Failed to obtain Codex access_token: ${(err as Error).message}.`,
        );
      }),
    extraHeaders: { Originator: 'codex-tui' },
    userAgent: CODEX_TUI_USER_AGENT,
    resolvedFrom,
  };
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** Exposed for adapter-layer 401 retries (Task 4). */
export function getTokenStoreForHome(codexHome?: string): CodexTokenStore | undefined {
  return tokenStoreCache.get(codexHome ?? resolveCodexHome())?.store;
}

async function resolveOAuthSeed(
  codexHome: string,
  sourceTokens: CodexAuthTokens,
): Promise<{ accessToken: string; refreshToken: string }> {
  const cached = await readCachedTokenPair(codexHome, sourceTokens.refresh_token);
  if (cached) return cached;
  return {
    accessToken: sourceTokens.access_token,
    refreshToken: sourceTokens.refresh_token,
  };
}

function describeCodexAuthSource(record: CodexAuthRecord, codexHome: string): string {
  if (record.source === 'keyring') {
    return `Codex keyring entry for ${codexHome}`;
  }
  return `Codex auth.json at ${codexHome}`;
}
