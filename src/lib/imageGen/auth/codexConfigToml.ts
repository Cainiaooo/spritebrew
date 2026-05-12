// Read and parse the minimal subset of ~/.codex/config.toml that SpriteBrew
// needs to resolve the Codex-native base URL for static (api-key) credentials.
//
// Codex's config.toml looks like:
//
//   model = "gpt-5-codex"
//   model_provider = "openai"
//
//   [model_providers.openai]
//   name = "OpenAI"
//   base_url = "https://api.openai.com/v1"
//   env_key = "OPENAI_API_KEY"
//   wire_api = "responses"
//
//   [model_providers.my-relay]
//   name = "My Relay"
//   base_url = "https://relay.example.com/v1"
//
// We only extract:
//   - top-level `model_provider` string
//   - `model_providers.<name>.base_url` string
//   - `model_providers.<name>.wire_api` string
//
// The parser handles line-based top-level scalars, `[table.path]` headers,
// `key = "value"` (basic strings only, with `\\` + `\"` escapes), integer /
// boolean / bare-identifier values (kept as raw strings), and `# …` comments.
// Anything richer (arrays, multi-line strings, inline tables, dates) is
// skipped silently. If Codex grows to use those, `parseConfigToml` should be
// swapped for a real library instead of fighting edge cases here.
//
// Kept read-only — the file belongs to the Codex CLI.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export class CodexConfigTomlError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(hint ? `${message}\nHint: ${hint}` : message);
    this.name = 'CodexConfigTomlError';
  }
}

/** Subset we care about. */
export interface CodexConfigToml {
  /** Active provider name (top-level `model_provider`). */
  modelProvider?: string;
  /** base_url / wire_api keyed by provider name. */
  providers: Record<string, { baseUrl?: string; wireApi?: string }>;
}

export interface CodexProviderConfig {
  baseUrl?: string;
  wireApi?: string;
}

/**
 * Read and parse ~/.codex/config.toml (or equivalent under `codexHome`).
 * Returns null when the file does not exist — callers should treat that as
 * "fall back to env OPENAI_BASE_URL" rather than an error.
 */
export async function readConfigToml(codexHome: string): Promise<CodexConfigToml | null> {
  const filePath = path.join(codexHome, 'config.toml');
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw new CodexConfigTomlError(
      `Failed to read ${filePath}: ${(err as Error).message}.`,
      'Check file permissions; config.toml should be readable by the current user.',
    );
  }
  return parseConfigToml(raw);
}

/**
 * Resolve the base_url that Codex itself would use for the currently-active
 * provider. Returns `undefined` when:
 *   - config.toml is missing,
 *   - `model_provider` is not set,
 *   - the named provider has no `base_url`.
 *
 * Callers should layer their own env fallback on top of this.
 */
export async function resolveCodexBaseUrl(codexHome: string): Promise<string | undefined> {
  const provider = await resolveCodexProviderConfig(codexHome);
  return provider?.baseUrl;
}

export async function resolveCodexProviderConfig(
  codexHome: string,
): Promise<CodexProviderConfig | undefined> {
  const config = await readConfigToml(codexHome);
  if (!config) return undefined;
  const name = config.modelProvider;
  if (!name) return undefined;
  const provider = config.providers[name];
  return provider ?? undefined;
}

// ─── Parser ──

export function parseConfigToml(raw: string): CodexConfigToml {
  const out: CodexConfigToml = { providers: {} };
  let currentTable: string[] = [];

  const lines = raw.split(/\r?\n/);
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const original = lines[lineNo];
    const line = stripInlineComment(original).trim();
    if (line === '') continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      // Array-of-tables (`[[...]]`) is not used by codex; ignore the contents.
      if (line.startsWith('[[')) {
        currentTable = [];
        continue;
      }
      const header = line.slice(1, -1).trim();
      if (header === '') continue;
      currentTable = splitDottedKey(header);
      continue;
    }

    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const keyPart = line.slice(0, eq).trim();
    const valuePart = line.slice(eq + 1).trim();
    if (keyPart === '' || valuePart === '') continue;
    const keyPath = [...currentTable, ...splitDottedKey(keyPart)];
    const value = parseScalar(valuePart);
    if (value === undefined) continue;
    assignDotted(out, keyPath, value);
  }

  return out;
}

function stripInlineComment(line: string): string {
  // Very conservative: remove `# …` only when the `#` is outside a string.
  let inString: '"' | "'" | null = null;
  let escape = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\' && inString === '"') {
        escape = true;
        continue;
      }
      if (c === inString) {
        inString = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      continue;
    }
    if (c === '#') return line.slice(0, i);
  }
  return line;
}

function splitDottedKey(src: string): string[] {
  // Supports `a.b.c` and quoted segments like `a."b.c".d`.
  const parts: string[] = [];
  let inString: '"' | "'" | null = null;
  let buf = '';
  let escape = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (escape) {
        buf += c;
        escape = false;
        continue;
      }
      if (c === '\\' && inString === '"') {
        escape = true;
        continue;
      }
      if (c === inString) {
        inString = null;
        continue;
      }
      buf += c;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      continue;
    }
    if (c === '.') {
      parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  parts.push(buf.trim());
  return parts.filter((p) => p.length > 0);
}

function parseScalar(src: string): string | number | boolean | undefined {
  if (src.length === 0) return undefined;
  const first = src[0];

  if (first === '"' || first === "'") {
    const end = findClosingQuote(src, first);
    if (end === -1) return undefined;
    const inner = src.slice(1, end);
    return first === '"' ? unescapeBasicString(inner) : inner;
  }

  if (first === '[' || first === '{') {
    // Arrays / inline tables: out of scope for our subset.
    return undefined;
  }

  if (src === 'true') return true;
  if (src === 'false') return false;

  if (/^-?\d+$/.test(src)) return Number.parseInt(src, 10);
  if (/^-?\d+\.\d+$/.test(src)) return Number.parseFloat(src);

  // Bare identifiers or unexpected tokens — stringify so call sites can still
  // see the raw value rather than silently dropping it.
  return src;
}

function findClosingQuote(src: string, quote: '"' | "'"): number {
  let escape = false;
  for (let i = 1; i < src.length; i++) {
    const c = src[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && quote === '"') {
      escape = true;
      continue;
    }
    if (c === quote) return i;
  }
  return -1;
}

function unescapeBasicString(inner: string): string {
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const next = inner[i + 1];
    i++;
    switch (next) {
      case '"':
        out += '"';
        break;
      case '\\':
        out += '\\';
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      default:
        out += next ?? '';
    }
  }
  return out;
}

function assignDotted(
  out: CodexConfigToml,
  keyPath: string[],
  value: string | number | boolean,
): void {
  if (keyPath.length === 0) return;

  // Top-level `model_provider = "…"`.
  if (keyPath.length === 1 && keyPath[0] === 'model_provider' && typeof value === 'string') {
    out.modelProvider = value;
    return;
  }

  // `[model_providers.<name>]` or `model_providers.<name>.<field> = "…"`.
  if (keyPath[0] === 'model_providers' && keyPath.length >= 3) {
    const name = keyPath[1];
    const field = keyPath.slice(2).join('.');
    const bucket = (out.providers[name] ??= {});
    if (field === 'base_url' && typeof value === 'string') {
      bucket.baseUrl = value;
    } else if (field === 'wire_api' && typeof value === 'string') {
      bucket.wireApi = value;
    }
    return;
  }
  // Everything else is out of scope for our subset.
}
