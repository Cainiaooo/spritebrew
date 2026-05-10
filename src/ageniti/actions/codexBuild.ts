// Action: codex_build — assemble a Codex Pet bundle (pet.json + WebP atlas)
// from 9 per-state base64 PNGs.

import { defineAction, s } from '@ageniti/core';
import { buildCodexPetBundle } from '@/lib/codexPetExport';
import { CODEX_PET_STATES, type CodexPetState } from '@/lib/templates/codexPet';

export const codexBuild = defineAction({
  name: 'codex_build',
  description:
    'Build a Codex Pet bundle (pet.json + lossless WebP atlas) from 9 state-frame base64 PNGs. Missing states leave their atlas row transparent.',
  visibility: 'public',
  sideEffects: 'read',
  idempotency: 'idempotent',
  input: s.object({
    meta: s.object({
      id: s.string().min(1).describe('Slug for the pet folder/identity.'),
      displayName: s.string().min(1).describe('Human-facing pet name.'),
      description: s.string().describe('Free-form pet description.'),
    }),
    states: s
      .record(s.string())
      .describe(
        `Map from state name to base64 PNG. Valid state keys: ${CODEX_PET_STATES.join(', ')}`,
      ),
  }),
  output: s.object({
    petJson: s.string().describe('JSON text ready to write as pet.json.'),
    spritesheetWebpBase64: s
      .string()
      .describe('1536x1872 lossless WebP atlas as raw base64.'),
  }),
  async run(input, ctx) {
    const stateImages: Partial<Record<CodexPetState, string>> = {};
    for (const [k, v] of Object.entries(input.states)) {
      if ((CODEX_PET_STATES as readonly string[]).includes(k)) {
        stateImages[k as CodexPetState] = v as string;
      } else {
        ctx.logger.warn('Ignoring unknown codex pet state', { state: k });
      }
    }

    const bundle = await buildCodexPetBundle(input.meta, stateImages);
    return {
      petJson: bundle.petJson,
      spritesheetWebpBase64: bundle.spritesheetWebp.toString('base64'),
    };
  },
});
