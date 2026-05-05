// Compose 9 Codex Pet state frames into a 1536×1872 atlas + pet.json bundle.
//
// Spec: docs/references/codex-pet-hatch-skill/references/codex-pet-contract.md
//   - Atlas is 1536×1872, 8 cols × 9 rows, each cell 192×208.
//   - Used columns per row vary (see CODEX_PET_USED_COLS).
//   - Unused cells are fully transparent.
//   - Output is lossless WebP plus a 4-field pet.json.
//
// v1 places one frame per used cell — the same single-frame sprite repeated
// across each row's used columns. This produces a Codex-loadable "static
// pet": no actual animation per row, but it satisfies the geometric
// contract and runs correctly in the Codex CLI. Animated per-row frames
// are deferred — see docs/codex-pet-research.md §5.3 (10).

import sharp from 'sharp';
import {
  CODEX_PET_ATLAS,
  CODEX_PET_STATES,
  CODEX_PET_USED_COLS,
  type CodexPetState,
} from './templates/codexPet';

export interface CodexPetMeta {
  id: string;
  displayName: string;
  description: string;
}

export interface CodexPetBundle {
  /** pet.json text, ready to write. */
  petJson: string;
  /** Lossless WebP-encoded 1536×1872 atlas. */
  spritesheetWebp: Buffer;
}

/**
 * Compose the 9 state frames into a 1536×1872 RGBA atlas. Each frame is
 * scaled with nearest-neighbor to fit a 192×208 cell, centered with
 * transparent padding, and stamped across the row's used columns.
 *
 * Missing states leave their entire row transparent — useful for partial
 * builds during iteration, though Codex itself rejects empty used cells.
 */
export async function composeCodexAtlas(
  stateImages: Partial<Record<CodexPetState, string>>,
): Promise<Buffer> {
  const { cols, rows, cellWidth, cellHeight, totalWidth, totalHeight } = CODEX_PET_ATLAS;

  const tiles: Partial<Record<CodexPetState, Buffer>> = {};
  for (const state of CODEX_PET_STATES) {
    const b64 = stateImages[state];
    if (!b64) continue;
    tiles[state] = await fitFrameToCell(b64, cellWidth, cellHeight);
  }

  const composites: { input: Buffer; left: number; top: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const state = CODEX_PET_STATES[row];
    const tile = tiles[state];
    if (!tile) continue;
    const used = Math.min(CODEX_PET_USED_COLS[state], cols);
    for (let col = 0; col < used; col++) {
      composites.push({
        input: tile,
        left: col * cellWidth,
        top: row * cellHeight,
      });
    }
  }

  return sharp({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

async function fitFrameToCell(
  b64: string,
  cellWidth: number,
  cellHeight: number,
): Promise<Buffer> {
  return sharp(Buffer.from(b64, 'base64'))
    .ensureAlpha()
    .resize(cellWidth, cellHeight, {
      kernel: 'nearest',
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/**
 * Build a Codex-compatible pet bundle: pet.json + lossless WebP atlas.
 * Caller is responsible for writing files / zipping for download.
 */
export async function buildCodexPetBundle(
  meta: CodexPetMeta,
  stateImages: Partial<Record<CodexPetState, string>>,
): Promise<CodexPetBundle> {
  const atlasPng = await composeCodexAtlas(stateImages);
  const spritesheetWebp = await sharp(atlasPng).webp({ lossless: true }).toBuffer();

  const petJson = JSON.stringify(
    {
      id: meta.id,
      displayName: meta.displayName,
      description: meta.description,
      spritesheetPath: 'spritesheet.webp',
    },
    null,
    2,
  );

  return { petJson, spritesheetWebp };
}

/** Lowercase, hyphen-only slug suitable for the Codex pet folder name. */
export function slugifyPetName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'pet';
}
