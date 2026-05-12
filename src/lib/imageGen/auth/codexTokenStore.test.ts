// Tests for codexTokenStore.
//
// Runs under `node:test` via `tsx --test`. No network — `fetchImpl` is
// injected per test. The access_token is a synthetic JWT whose `exp` is
// controlled by the test so we can verify both "still fresh" and "expired"
// branches without touching the wall clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CODEX_OAUTH_TOKEN_URL,
  CodexReauthRequiredError,
  CodexTokenStore,
} from './codexTokenStore';

function makeJwt(expSecondsFromNow: number): string {
  const header = { alg: 'none', typ: 'JWT' };
  const payload = { exp: Math.floor(Date.now() / 1000) + expSecondsFromNow };
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64(header)}.${b64(payload)}.sig`;
}

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeErrResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('getAccessToken returns cached token while still fresh', async () => {
  let calls = 0;
  const store = new CodexTokenStore({
    accessToken: makeJwt(3600),
    refreshToken: 'r0',
    fetchImpl: async () => {
      calls++;
      return makeOkResponse({ access_token: 'should-not-be-used' });
    },
  });

  const token = await store.getAccessToken();
  assert.equal(token, store.currentAccessToken);
  assert.equal(calls, 0, 'no refresh should be triggered while token is fresh');
});

test('concurrent getAccessToken calls share a single refresh', async () => {
  let calls = 0;
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const store = new CodexTokenStore({
    accessToken: makeJwt(-3600), // already expired
    refreshToken: 'r0',
    fetchImpl: async () => {
      calls++;
      await gate;
      return makeOkResponse({
        access_token: makeJwt(3600),
        refresh_token: 'r1',
      });
    },
  });

  const a = store.getAccessToken();
  const b = store.getAccessToken();
  const c = store.getAccessToken();

  // Let the in-flight refresh resolve now that all three callers have joined.
  release!();

  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.equal(calls, 1, 'expected a single refresh for three concurrent callers');
  assert.equal(ra, rb);
  assert.equal(rb, rc);
  assert.equal(store.currentRefreshToken, 'r1');
});

test('forceRefresh bypasses the freshness check', async () => {
  let calls = 0;
  const store = new CodexTokenStore({
    accessToken: makeJwt(3600), // still fresh
    refreshToken: 'r0',
    fetchImpl: async () => {
      calls++;
      return makeOkResponse({
        access_token: makeJwt(3600),
        refresh_token: 'r1',
      });
    },
  });

  await store.forceRefresh();
  assert.equal(calls, 1, 'forceRefresh should always hit the network');
  assert.equal(store.currentRefreshToken, 'r1');
});

test('invalid_grant response surfaces as CodexReauthRequiredError', async () => {
  const store = new CodexTokenStore({
    accessToken: makeJwt(-3600),
    refreshToken: 'r0',
    fetchImpl: async () =>
      makeErrResponse(400, {
        error: 'invalid_grant',
        error_description: 'Token has been revoked',
      }),
  });

  await assert.rejects(
    () => store.getAccessToken(),
    (err: unknown) => {
      assert.ok(
        err instanceof CodexReauthRequiredError,
        `expected CodexReauthRequiredError, got ${(err as Error)?.name}`,
      );
      return true;
    },
  );
});

test('non-auth error codes surface as generic Error with status', async () => {
  const store = new CodexTokenStore({
    accessToken: makeJwt(-3600),
    refreshToken: 'r0',
    fetchImpl: async () =>
      makeErrResponse(500, { error: 'server_error' }),
  });

  await assert.rejects(
    () => store.getAccessToken(),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match((err as Error).message, /500/);
      assert.ok(
        !(err instanceof CodexReauthRequiredError),
        '5xx must not be classified as reauth-required',
      );
      return true;
    },
  );
});

test('persistRotatedTokens is called with the rotated pair on success', async () => {
  const persisted: Array<{ accessToken: string; refreshToken: string }> = [];
  const newAccess = makeJwt(3600);
  const store = new CodexTokenStore({
    accessToken: makeJwt(-3600),
    refreshToken: 'r0',
    fetchImpl: async () =>
      makeOkResponse({
        access_token: newAccess,
        refresh_token: 'r1',
      }),
    persistRotatedTokens: async (tokens) => {
      persisted.push(tokens);
    },
  });

  const token = await store.getAccessToken();
  assert.equal(token, newAccess);
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0], { accessToken: newAccess, refreshToken: 'r1' });
});

test('refresh response without access_token throws', async () => {
  const store = new CodexTokenStore({
    accessToken: makeJwt(-3600),
    refreshToken: 'r0',
    fetchImpl: async () => makeOkResponse({ token_type: 'Bearer' }),
  });

  await assert.rejects(
    () => store.getAccessToken(),
    /no access_token/,
  );
});

test('response with only new access_token (no rotated refresh) keeps old refresh', async () => {
  const newAccess = makeJwt(3600);
  let persistCalls = 0;
  const store = new CodexTokenStore({
    accessToken: makeJwt(-3600),
    refreshToken: 'r0',
    fetchImpl: async () => makeOkResponse({ access_token: newAccess }),
    persistRotatedTokens: async () => {
      persistCalls++;
    },
  });

  const token = await store.getAccessToken();
  assert.equal(token, newAccess);
  assert.equal(store.currentRefreshToken, 'r0', 'refresh_token should not change when server omits it');
  assert.equal(persistCalls, 1, 'persist still runs so caches are consistent');
});

test('network error is wrapped with a connectivity hint', async () => {
  const store = new CodexTokenStore({
    accessToken: makeJwt(-3600),
    refreshToken: 'r0',
    fetchImpl: async () => {
      throw new Error('ECONNRESET');
    },
  });

  await assert.rejects(
    () => store.getAccessToken(),
    /network error.*ECONNRESET/i,
  );
});

test('refresh body includes grant_type, refresh_token, client_id, scope', async () => {
  let captured = '';
  let capturedUrl = '';
  const store = new CodexTokenStore({
    accessToken: makeJwt(-3600),
    refreshToken: 'r0',
    fetchImpl: async (url, init) => {
      capturedUrl = typeof url === 'string' ? url : String(url);
      captured = typeof init?.body === 'string' ? init.body : '';
      return makeOkResponse({ access_token: makeJwt(3600) });
    },
  });
  await store.getAccessToken();

  assert.equal(capturedUrl, CODEX_OAUTH_TOKEN_URL);
  const form = new URLSearchParams(captured);
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('refresh_token'), 'r0');
  assert.ok(form.get('client_id'), 'client_id must be present');
  assert.equal(form.get('scope'), 'openid profile email');
});
