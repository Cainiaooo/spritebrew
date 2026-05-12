// Read and parse the Codex CLI credential store.
//
// The Codex CLI stores credentials under $CODEX_HOME (default ~/.codex) in
// one of three backends: `file` (plaintext auth.json), `keyring` (OS-native
// secret store), or `auto` (keyring first, then file).
//
// SpriteBrew keeps Codex-owned state read-only. We read auth.json when it
// exists, and only fall back to the OS keyring when auth.json is absent.
//
// auth.json schema (file backend, as of 2026-05):
//
//   {
//     "OPENAI_API_KEY"?: string,         // set when `codex login --with-api-key`
//     "tokens"?: {                       // set when `codex login` (OAuth)
//       "access_token": "<jwt>",
//       "refresh_token": "<opaque>",
//       "id_token"?: "<jwt>",
//       "account"?: { … }                // org/workspace hints
//     },
//     "auth_mode"?: "chatgpt" | "api-key",
//     "last_refresh"?: "<iso-8601>"
//   }

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const KEYRING_SERVICE = 'Codex Auth';
const KEYRING_LOOKUP_TIMEOUT_MS = 5000;

export class CodexAuthFileError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(hint ? `${message}\nHint: ${hint}` : message);
    this.name = 'CodexAuthFileError';
  }
}

export interface CodexAuthTokens {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  account?: Record<string, unknown>;
}

export interface CodexAuthJson {
  openaiApiKey?: string;
  tokens?: CodexAuthTokens;
  authMode?: string;
  lastRefresh?: string;
}

export type CodexAuthSource = 'file' | 'keyring';

export interface CodexAuthRecord {
  auth: CodexAuthJson;
  source: CodexAuthSource;
}

export interface AccessTokenStatus {
  /** True if the token is expired or within `safetyMarginSec` of expiring. */
  expired: boolean;
  /** Seconds until expiry. Negative when already expired. NaN when payload has no `exp`. */
  expiresInSec: number;
}

/** Safety margin added to JWT exp checks. 60s cushion covers clock skew + round-trip. */
export const TOKEN_EXPIRY_SAFETY_MARGIN_SEC = 60;

/**
 * Resolve the Codex home directory. Precedence:
 *   1. explicit argument (CLI flag)
 *   2. `CODEX_HOME` env var
 *   3. `~/.codex`
 */
export function resolveCodexHome(explicit?: string): string {
  if (explicit && explicit.trim() !== '') {
    return path.resolve(expandHome(explicit.trim()));
  }
  const envHome = process.env.CODEX_HOME?.trim();
  if (envHome) {
    return path.resolve(expandHome(envHome));
  }
  return path.resolve(os.homedir(), '.codex');
}

/**
 * Read and parse the Codex credential store for `codexHome`.
 *
 * We keep Codex-managed files read-only: auth.json is used when present; when
 * it is missing we attempt a read-only keyring lookup using the same service
 * name and account key that Codex itself uses.
 */
export async function readAuthJson(codexHome: string): Promise<CodexAuthJson> {
  return (await readAuthRecord(codexHome)).auth;
}

export async function readAuthRecord(codexHome: string): Promise<CodexAuthRecord> {
  const filePath = path.join(codexHome, 'auth.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return {
      auth: parseAuthPayload(raw, filePath),
      source: 'file',
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new CodexAuthFileError(
        `Failed to read ${filePath}: ${(err as Error).message}.`,
        'Check file permissions; auth.json should be readable by the current user.',
      );
    }
  }

  const keyringRaw = await readKeyringPayload(codexHome).catch((err: unknown) => {
    if (err instanceof CodexAuthFileError) throw err;
    throw new CodexAuthFileError(
      `Failed to read Codex keyring entry for ${codexHome}: ${(err as Error).message}.`,
      'Re-run `codex login`, or switch Codex back to file storage if your environment does not allow keyring access.',
    );
  });
  if (keyringRaw == null) {
    throw new CodexAuthFileError(
      `Codex auth file not found at ${filePath}, and no keyring entry was found for ${codexHome}.`,
      'Run `codex login` to create credentials, or set `cli_auth_credentials_store = "file"` if you want Codex to keep using auth.json.',
    );
  }
  return {
    auth: parseAuthPayload(keyringRaw, `Codex keyring entry for ${codexHome}`),
    source: 'keyring',
  };
}

function parseAuthPayload(raw: string, sourceLabel: string): CodexAuthJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CodexAuthFileError(
      `Failed to parse ${sourceLabel} as JSON: ${(err as Error).message}.`,
      'The stored auth payload may be truncated or corrupted. Re-run `codex login` to regenerate it.',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CodexAuthFileError(
      `Unexpected auth payload shape at ${sourceLabel}: not a JSON object.`,
      'Re-run `codex login` to regenerate the file.',
    );
  }

  const obj = parsed as Record<string, unknown>;
  const out: CodexAuthJson = {};

  if (typeof obj.OPENAI_API_KEY === 'string' && obj.OPENAI_API_KEY.trim() !== '') {
    out.openaiApiKey = obj.OPENAI_API_KEY.trim();
  }

  if (obj.tokens && typeof obj.tokens === 'object' && !Array.isArray(obj.tokens)) {
    const t = obj.tokens as Record<string, unknown>;
    const access = typeof t.access_token === 'string' ? t.access_token.trim() : '';
    const refresh = typeof t.refresh_token === 'string' ? t.refresh_token.trim() : '';
    if (access && refresh) {
      out.tokens = {
        access_token: access,
        refresh_token: refresh,
        id_token: typeof t.id_token === 'string' ? t.id_token : undefined,
        account:
          t.account && typeof t.account === 'object' && !Array.isArray(t.account)
            ? (t.account as Record<string, unknown>)
            : undefined,
      };
    }
  }

  if (typeof obj.auth_mode === 'string') out.authMode = obj.auth_mode;
  if (typeof obj.last_refresh === 'string') out.lastRefresh = obj.last_refresh;

  return out;
}

async function readKeyringPayload(codexHome: string): Promise<string | null> {
  const account = await buildKeyringAccount(codexHome);

  switch (process.platform) {
    case 'darwin': {
      try {
        const { stdout } = await execFileAsync(
          'security',
          ['find-generic-password', '-s', KEYRING_SERVICE, '-a', account, '-w'],
          { timeout: KEYRING_LOOKUP_TIMEOUT_MS },
        );
        const secret = stdout.trim();
        return secret === '' ? null : secret;
      } catch (err) {
        const execErr = err as NodeJS.ErrnoException & {
          stderr?: string;
          code?: string | number;
        };
        const stderr = `${execErr.stderr ?? ''}`.trim();
        if (
          stderr.includes('could not be found in the keychain') ||
          stderr.includes('item could not be found')
        ) {
          return null;
        }
        if (execErr.code === 'ENOENT') {
          throw new CodexAuthFileError(
            'macOS `security` command is not available.',
            'Install the standard macOS command line tools, or switch Codex to file-backed auth storage.',
          );
        }
        throw err;
      }
    }
    case 'linux': {
      try {
        const { stdout } = await execFileAsync(
          'secret-tool',
          ['lookup', 'service', KEYRING_SERVICE, 'account', account],
          { timeout: KEYRING_LOOKUP_TIMEOUT_MS },
        );
        const secret = stdout.trim();
        return secret === '' ? null : secret;
      } catch (err) {
        const execErr = err as Error & {
          stderr?: string;
          code?: string | number;
        };
        if (typeof execErr.code === 'number' && execErr.code === 1) return null;
        if (execErr.code === 'ENOENT') {
          throw new CodexAuthFileError(
            'Linux `secret-tool` command is not available.',
            'Install libsecret tools, or switch Codex to file-backed auth storage.',
          );
        }
        throw err;
      }
    }
    default:
      throw new CodexAuthFileError(
        `Codex keyring lookup is not implemented on ${process.platform}.`,
        'Use file-backed Codex auth on this platform, or add a platform-specific keyring reader.',
      );
  }
}

async function buildKeyringAccount(codexHome: string): Promise<string> {
  let canonicalHome = path.resolve(codexHome);
  try {
    canonicalHome = await fs.realpath(codexHome);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }
  const hash = createHash('sha256').update(canonicalHome).digest('hex').slice(0, 16);
  return `cli|${hash}`;
}

/**
 * Parse a JWT's `exp` claim and compare to wall clock.
 *
 * Returns `{ expired: true, expiresInSec: NaN }` when the token is not a
 * well-formed JWT or the payload lacks an `exp` claim — treating "unknown"
 * as "expired" forces a refresh attempt, which is the safe default.
 */
export function getAccessTokenStatus(
  token: string,
  safetyMarginSec: number = TOKEN_EXPIRY_SAFETY_MARGIN_SEC,
): AccessTokenStatus {
  const parts = token.split('.');
  if (parts.length < 2) {
    return { expired: true, expiresInSec: Number.NaN };
  }

  let payload: unknown;
  try {
    const b64url = parts[1];
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4));
    const json = Buffer.from(padded, 'base64').toString('utf8');
    payload = JSON.parse(json);
  } catch {
    return { expired: true, expiresInSec: Number.NaN };
  }

  if (!payload || typeof payload !== 'object') {
    return { expired: true, expiresInSec: Number.NaN };
  }

  const exp = (payload as { exp?: unknown }).exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return { expired: true, expiresInSec: Number.NaN };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresInSec = exp - nowSec;
  return { expired: expiresInSec <= safetyMarginSec, expiresInSec };
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
