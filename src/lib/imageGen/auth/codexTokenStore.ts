// In-process Codex OAuth access_token cache with a refresh mutex.
//
// - `getAccessToken()` returns the cached token if still fresh (exp - 60s);
//   otherwise triggers `refresh()` and awaits the result.
// - Concurrent callers share a single refresh promise (mutex) so we never
//   burn multiple refresh_token uses at once; Codex invalidates a
//   refresh_token after a single successful rotation, so racing is fatal.
// - `refresh()` calls POST https://auth.openai.com/oauth/token with
//   grant_type=refresh_token and the public Codex CLI client_id.
// - On invalid_grant / 4xx the store throws `CodexReauthRequiredError`
//   carrying a user-visible "run `codex login`" hint. The store never
//   touches Codex-managed auth.json; callers may persist refreshed tokens to
//   their own cache via `persistRotatedTokens`.
//
// This module is framework-agnostic and uses global `fetch`. Tests inject a
// mock fetch via the constructor to avoid network.

import { getAccessTokenStatus, TOKEN_EXPIRY_SAFETY_MARGIN_SEC } from './codexAuthFile';

/** Public PKCE client registered by the OpenAI Codex CLI. */
export const CODEX_CLI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const CODEX_OAUTH_SCOPE = 'openid profile email';
const CODEX_CLI_USER_AGENT = 'codex-cli/0.91.0';

export class CodexReauthRequiredError extends Error {
  constructor(message = 'Codex refresh token is invalid. Run `codex login` and restart.') {
    super(message);
    this.name = 'CodexReauthRequiredError';
  }
}

export interface CodexTokenStoreOptions {
  /** Initial access_token (usually from auth.json `tokens.access_token`). */
  accessToken: string;
  /** Initial refresh_token (from auth.json `tokens.refresh_token`). */
  refreshToken: string;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Override token endpoint for tests. */
  tokenUrl?: string;
  /** Override client_id (for Codex variants/enterprise). */
  clientId?: string;
  /** Override safety margin (seconds). Default 60s. */
  safetyMarginSec?: number;
  /** Persist refreshed tokens to app-owned storage. */
  persistRotatedTokens?: (tokens: { accessToken: string; refreshToken: string }) => Promise<void>;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export class CodexTokenStore {
  private accessToken: string;
  private refreshToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenUrl: string;
  private readonly clientId: string;
  private readonly safetyMarginSec: number;
  private readonly persistRotatedTokens?: CodexTokenStoreOptions['persistRotatedTokens'];
  /** In-flight refresh, shared across concurrent getAccessToken() callers. */
  private refreshInflight: Promise<string> | null = null;

  constructor(opts: CodexTokenStoreOptions) {
    if (!opts.accessToken) throw new Error('CodexTokenStore: accessToken is required.');
    if (!opts.refreshToken) throw new Error('CodexTokenStore: refreshToken is required.');
    this.accessToken = opts.accessToken;
    this.refreshToken = opts.refreshToken;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.tokenUrl = opts.tokenUrl ?? CODEX_OAUTH_TOKEN_URL;
    this.clientId = opts.clientId ?? CODEX_CLI_CLIENT_ID;
    this.safetyMarginSec = opts.safetyMarginSec ?? TOKEN_EXPIRY_SAFETY_MARGIN_SEC;
    this.persistRotatedTokens = opts.persistRotatedTokens;
  }

  /** Return a currently-valid access_token, refreshing if needed. */
  async getAccessToken(): Promise<string> {
    const status = getAccessTokenStatus(this.accessToken, this.safetyMarginSec);
    if (!status.expired) return this.accessToken;
    return this.doRefreshShared();
  }

  /** Force a refresh, skipping the cached-token check. Used for 401 retry. */
  async forceRefresh(): Promise<string> {
    return this.doRefreshShared();
  }

  /** For tests / introspection. */
  get currentAccessToken(): string {
    return this.accessToken;
  }

  /** For tests. */
  get currentRefreshToken(): string {
    return this.refreshToken;
  }

  private doRefreshShared(): Promise<string> {
    if (this.refreshInflight) return this.refreshInflight;
    const p = this.doRefresh().finally(() => {
      this.refreshInflight = null;
    });
    this.refreshInflight = p;
    return p;
  }

  private async doRefresh(): Promise<string> {
    const form = new URLSearchParams();
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', this.refreshToken);
    form.set('client_id', this.clientId);
    form.set('scope', CODEX_OAUTH_SCOPE);

    let res: Response;
    try {
      res = await this.fetchImpl(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': CODEX_CLI_USER_AGENT,
        },
        body: form.toString(),
      });
    } catch (err) {
      throw new Error(
        `Codex OAuth refresh network error: ${(err as Error).message}. Check connectivity to auth.openai.com.`,
      );
    }

    const bodyText = await res.text().catch(() => '');
    let parsed: OAuthTokenResponse | null = null;
    if (bodyText) {
      try {
        parsed = JSON.parse(bodyText) as OAuthTokenResponse;
      } catch {
        parsed = null;
      }
    }

    if (!res.ok) {
      const errCode = parsed?.error;
      if (errCode === 'invalid_grant' || errCode === 'invalid_request') {
        throw new CodexReauthRequiredError(
          `Codex refresh rejected (${errCode}${parsed?.error_description ? ': ' + parsed.error_description : ''}). Run \`codex login\` and restart.`,
        );
      }
      throw new Error(
        `Codex OAuth refresh failed (${res.status}): ${bodyText.slice(0, 300) || '<empty body>'}.`,
      );
    }

    if (!parsed || !parsed.access_token) {
      throw new Error(
        `Codex OAuth refresh returned no access_token. Response: ${bodyText.slice(0, 300) || '<empty>'}.`,
      );
    }

    this.accessToken = parsed.access_token;
    if (parsed.refresh_token && parsed.refresh_token.trim() !== '') {
      this.refreshToken = parsed.refresh_token;
    }
    if (this.persistRotatedTokens) {
      await this.persistRotatedTokens({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
      }).catch((err: unknown) => {
        throw new Error(
          `Codex OAuth refresh succeeded but SpriteBrew could not persist the rotated tokens: ${(err as Error).message}.`,
        );
      });
    }
    return this.accessToken;
  }
}
