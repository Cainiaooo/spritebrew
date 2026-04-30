// Pixabots Parts Catalog (ported from pixabots/packages/core/src/parts.ts).
//
// IMPORTANT: Arrays are APPEND-ONLY. Never reorder or remove entries —
// downstream compositor IDs are positional.
//
// Isomorphic: no fs/path imports so this can be imported from client UI.

export type PartCategory = 'eyes' | 'heads' | 'body' | 'top';
export type PartAnimKind = 'static' | 'blink' | 'sequence';

export interface PartOption {
  name: string;
  /** "{category}/{name}.png" for static, "{category}/{name}/" for animated. */
  path: string;
  frames?: number;
  kind?: PartAnimKind;
}

/** Layer order, bottom → top. */
export const LAYER_ORDER: PartCategory[] = ['top', 'body', 'heads', 'eyes'];
export const CATEGORY_ORDER: PartCategory[] = ['eyes', 'heads', 'body', 'top'];

type PartInput = string | { name: string; frames?: number; kind?: PartAnimKind };

function makeParts(category: PartCategory, entries: PartInput[]): PartOption[] {
  return entries.map((entry) => {
    const e = typeof entry === 'string' ? { name: entry } : entry;
    const opt: PartOption = { name: e.name, path: `${category}/${e.name}.png` };
    if (e.frames !== undefined) opt.frames = e.frames;
    if (e.kind !== undefined) opt.kind = e.kind;
    return opt;
  });
}

export const PARTS: Record<PartCategory, PartOption[]> = {
  eyes: makeParts('eyes', [
    'big-face',
    { name: 'cheeky-terminal', frames: 16, kind: 'sequence' },
    { name: 'glasses', frames: 2, kind: 'blink' },
    { name: 'human', frames: 2, kind: 'blink' },
    { name: 'human-2', frames: 2, kind: 'blink' },
    'monitor',
    'monitor-round',
    'mustache',
    { name: 'terminal', frames: 2, kind: 'blink' },
    { name: 'terminal-green', frames: 2, kind: 'blink' },
    'terminal-light',
    { name: 'terminal-round', frames: 2, kind: 'blink' },
    { name: 'tight-visor', frames: 8, kind: 'sequence' },
    { name: 'visor', frames: 8, kind: 'sequence' },
    { name: 'wayfarer', frames: 4, kind: 'sequence' },
    { name: 'wayfarer-face', frames: 8, kind: 'sequence' },
  ]),
  heads: makeParts('heads', [
    'ac', 'blob', 'blob-blue', 'bowl', 'box', 'commodore', 'frame', 'punch-bowl',
  ]),
  body: makeParts('body', [
    'backpack', 'claws', 'heart', 'swag', 'tank', 'wings', 'fire',
  ]),
  top: makeParts('top', [
    'antenna', 'bulb', 'bunny-ears', 'disco', 'leaf', 'lollypop',
    'mohawk', 'plant', 'radar', 'bun', 'horns', 'spikes',
  ]),
};

export function partCount(category: PartCategory): number {
  return PARTS[category].length;
}

export function getPart(category: PartCategory, index: number): PartOption {
  const opts = PARTS[category];
  if (index < 0 || index >= opts.length) {
    throw new RangeError(`Index ${index} out of range for ${category} (0–${opts.length - 1})`);
  }
  return opts[index];
}

export function getPartByName(category: PartCategory, name: string): PartOption | null {
  return PARTS[category].find((p) => p.name === name) ?? null;
}

/** Outfit selection used by SpriteBrew UI / API. */
export type Outfit = Partial<Record<PartCategory, string>>;
