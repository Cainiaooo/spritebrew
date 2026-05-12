import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const CACHE_VERSION = 1;
const CACHE_DIR = path.join(os.homedir(), '.spritebrew', 'codex-oauth-cache');

interface CachedTokenEntry {
  version: number;
  codexHome: string;
  sourceRefreshToken: string;
  accessToken: string;
  refreshToken: string;
  updatedAt: string;
}

export interface CachedTokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function readCachedTokenPair(
  codexHome: string,
  sourceRefreshToken: string,
): Promise<CachedTokenPair | null> {
  const filePath = await getCacheFilePath(codexHome);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const entry = parsed as Partial<CachedTokenEntry>;
  if (entry.version !== CACHE_VERSION) return null;
  if (entry.sourceRefreshToken !== sourceRefreshToken) return null;
  if (typeof entry.accessToken !== 'string' || entry.accessToken.trim() === '') return null;
  if (typeof entry.refreshToken !== 'string' || entry.refreshToken.trim() === '') return null;

  return {
    accessToken: entry.accessToken,
    refreshToken: entry.refreshToken,
  };
}

export async function writeCachedTokenPair(
  codexHome: string,
  sourceRefreshToken: string,
  pair: CachedTokenPair,
): Promise<void> {
  const filePath = await getCacheFilePath(codexHome);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload: CachedTokenEntry = {
    version: CACHE_VERSION,
    codexHome: path.resolve(codexHome),
    sourceRefreshToken,
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(filePath, JSON.stringify(payload), { mode: 0o600 });
}

async function getCacheFilePath(codexHome: string): Promise<string> {
  let canonicalHome = path.resolve(codexHome);
  try {
    canonicalHome = await fs.realpath(codexHome);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const hash = createHash('sha256').update(canonicalHome).digest('hex').slice(0, 24);
  return path.join(CACHE_DIR, `${hash}.json`);
}
