// Helpers for normalizing heterogeneous image-generation responses into a
// plain base64 image string suitable for sharp.

const DATA_URI_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;
const EMBEDDED_DATA_URI_RE =
  /data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=_\-\s]+)/i;

const IMAGE_BASE64_KEYS = new Set([
  'b64_json',
  'partial_image_b64',
  'image_b64',
  'image_base64',
  'base64_image',
  'base64',
  'b64',
  'data',
  'result',
  'content',
  'output',
]);

const IMAGE_URL_KEYS = new Set([
  'url',
  'image_url',
  'output_url',
  'file_url',
]);

export function parseMaybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (!['{', '[', '"'].includes(trimmed[0])) return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

export function extractImageBase64(payload: unknown): string | null {
  let best: string | null = null;
  const seen = new WeakSet<object>();

  const visit = (value: unknown, key?: string) => {
    if (typeof value === 'string') {
      const keyHint = key ? IMAGE_BASE64_KEYS.has(key) : false;
      const normalized = normalizeBase64Candidate(value, keyHint);
      if (normalized && (!best || normalized.length > best.length)) {
        best = normalized;
      }

      const parsed = parseMaybeJson(value);
      if (parsed !== value) visit(parsed, key);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    if (value && typeof value === 'object') {
      if (seen.has(value)) return;
      seen.add(value);
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, childKey);
      }
    }
  };

  visit(payload);
  return best;
}

export function extractImageUrl(payload: unknown): string | null {
  let best: string | null = null;
  const seen = new WeakSet<object>();

  const visit = (value: unknown, key?: string) => {
    if (best) return;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (
        /^https?:\/\//i.test(trimmed) &&
        (!key || IMAGE_URL_KEYS.has(key) || looksLikeImageUrl(trimmed))
      ) {
        best = trimmed;
        return;
      }

      const parsed = parseMaybeJson(value);
      if (parsed !== value) visit(parsed, key);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    if (value && typeof value === 'object') {
      if (seen.has(value)) return;
      seen.add(value);
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, childKey);
      }
    }
  };

  visit(payload);
  return best;
}

export function summarizeResponseShape(payload: unknown): string {
  if (typeof payload === 'string') {
    return `string(${payload.length})`;
  }
  if (Array.isArray(payload)) {
    return `array(${payload.length})`;
  }
  if (payload && typeof payload === 'object') {
    return Object.keys(payload).slice(0, 12).join(', ') || 'object';
  }
  return String(typeof payload);
}

function normalizeBase64Candidate(value: string, keyHint: boolean): string | null {
  let candidate = value.trim();
  const embedded = candidate.match(EMBEDDED_DATA_URI_RE);
  if (embedded) {
    candidate = embedded[1];
  } else if (DATA_URI_RE.test(candidate)) {
    candidate = candidate.replace(DATA_URI_RE, '');
  }

  if (/^https?:\/\//i.test(candidate)) return null;

  candidate = candidate.replace(/\s/g, '');
  if (candidate.length < 100) return null;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(candidate)) return null;

  candidate = candidate.replace(/-/g, '+').replace(/_/g, '/');
  candidate = padBase64(candidate);

  const buf = Buffer.from(candidate, 'base64');
  if (buf.length < 32) return null;

  if (hasImageSignature(buf)) return candidate;
  return keyHint && candidate.length > 1000 ? candidate : null;
}

function padBase64(value: string): string {
  const remainder = value.length % 4;
  return remainder === 0 ? value : value + '='.repeat(4 - remainder);
}

function hasImageSignature(buf: Buffer): boolean {
  return (
    isPng(buf) ||
    isJpeg(buf) ||
    isWebp(buf) ||
    isGif(buf)
  );
}

function isPng(buf: Buffer): boolean {
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  );
}

function isJpeg(buf: Buffer): boolean {
  return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isWebp(buf: Buffer): boolean {
  return (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function isGif(buf: Buffer): boolean {
  return (
    buf.subarray(0, 6).toString('ascii') === 'GIF87a' ||
    buf.subarray(0, 6).toString('ascii') === 'GIF89a'
  );
}

function looksLikeImageUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return /\.(png|jpe?g|webp|gif)(?:$|\?)/i.test(pathname);
  } catch {
    return false;
  }
}
