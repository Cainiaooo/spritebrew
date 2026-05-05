// Build a Codex-compatible pet bundle from 9 generated state frames.
//
// Input: { meta, stateImages } where stateImages maps each Codex row name
// to a base64 PNG (no data: prefix). Missing states leave their row blank
// — Codex itself will reject the resulting pet, but we permit partial
// builds for preview iteration.
//
// Output: { petJson: string, spritesheetWebpBase64: string }. The browser
// wraps both into a downloadable zip via the existing JSZip helper.

export const runtime = 'nodejs';

import { buildCodexPetBundle, slugifyPetName, type CodexPetMeta } from '@/lib/codexPetExport';
import { CODEX_PET_STATES, type CodexPetState } from '@/lib/templates/codexPet';

interface BuildBody {
  meta?: Partial<CodexPetMeta> & { displayName?: string };
  stateImages?: Partial<Record<CodexPetState, string>>;
}

export async function POST(request: Request): Promise<Response> {
  let body: BuildBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const display = body.meta?.displayName?.trim();
  if (!display) {
    return Response.json({ success: false, error: 'displayName is required.' }, { status: 400 });
  }

  const meta: CodexPetMeta = {
    id: body.meta?.id?.trim() || slugifyPetName(display),
    displayName: display,
    description: body.meta?.description?.trim() || `${display}, a SpriteBrew Codex pet.`,
  };

  const stateImages: Partial<Record<CodexPetState, string>> = {};
  if (body.stateImages) {
    for (const state of CODEX_PET_STATES) {
      const img = body.stateImages[state];
      if (typeof img !== 'string' || img.length === 0) continue;
      if (img.startsWith('data:')) {
        return Response.json(
          {
            success: false,
            error: `stateImages.${state} includes data: prefix. Strip it before sending.`,
          },
          { status: 400 },
        );
      }
      stateImages[state] = img;
    }
  }

  if (Object.keys(stateImages).length === 0) {
    return Response.json(
      { success: false, error: 'At least one stateImage is required.' },
      { status: 400 },
    );
  }

  try {
    const bundle = await buildCodexPetBundle(meta, stateImages);
    return Response.json({
      success: true,
      meta,
      petJson: bundle.petJson,
      spritesheetWebpBase64: bundle.spritesheetWebp.toString('base64'),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Atlas composition failed.';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
