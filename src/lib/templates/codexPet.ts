// Codex Pet template — drives the /codex-pet hatching page.
//
// Targets the 9-row, 1536×1872 atlas required by the Codex CLI's pet
// system. Row order, cell size, and per-row used-column counts come from
// docs/references/codex-pet-hatch-skill/references/animation-rows.md and
// codex-pet-contract.md. State suffixes follow the same "positive +
// negative" pattern as agentHydration.ts and incorporate the
// state-specific guidance from SKILL.md ("show the wave through paw pose
// only", "show vertical motion through body position only", etc.).

export const CODEX_PET_STATES = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
] as const;

export type CodexPetState = (typeof CODEX_PET_STATES)[number];

// Used columns per row, from animation-rows.md. Columns at index >= used
// must be fully transparent in the final atlas.
export const CODEX_PET_USED_COLS: Record<CodexPetState, number> = {
  idle: 6,
  'running-right': 8,
  'running-left': 8,
  waving: 4,
  jumping: 5,
  failed: 8,
  waiting: 6,
  running: 6,
  review: 6,
};

export const CODEX_PET_ATLAS = {
  cols: 8,
  rows: 9,
  cellWidth: 192,
  cellHeight: 208,
  totalWidth: 1536,
  totalHeight: 1872,
} as const;

const SHARED_NEGATIVE = [
  'no speed lines, no motion arcs, no afterimages, no smears',
  'no detached sparkles, floating symbols, speech bubbles, or thought bubbles',
  'no cast shadows, drop shadows, oval floor shadows, glow, halo, or aura',
  'no text, labels, frame numbers, UI panels, or code snippets',
  'fully transparent background (alpha 0) — no checker pattern, no white fill',
].join('; ');

export const STATE_PROMPT_SUFFIX: Record<CodexPetState, string> = {
  idle: `neutral standing pose, calm breathing posture, gentle expression. ${SHARED_NEGATIVE}`,
  'running-right': `running pose facing right, body in mid-stride leaning forward, side view, one foot lifted. ${SHARED_NEGATIVE}; no dust clouds, no speed marks behind the feet, no motion blur on limbs`,
  'running-left': `running pose facing left, body in mid-stride leaning forward, side view, one foot lifted. ${SHARED_NEGATIVE}; no dust clouds, no speed marks behind the feet, no motion blur on limbs`,
  waving: `friendly greeting pose, one paw raised in a wave, looking forward. Show the wave through paw position only. ${SHARED_NEGATIVE}; no wave marks, no motion arcs around the paw, no sparkles`,
  jumping: `jumping pose with body lifted off ground, feet tucked, arms out for balance. Show vertical motion through body position only. ${SHARED_NEGATIVE}; no dust, no landing marks, no impact bursts, no bounce pads`,
  failed: `slumped or deflated posture, sad downcast face, knees bent. A single tear touching the cheek or a small smoke puff touching the head is allowed if it overlaps the silhouette. ${SHARED_NEGATIVE}; no red X marks for eyes, no detached tear drops, no error symbols`,
  waiting: `patient idle pose, slight glance to the side, attentive but relaxed posture. ${SHARED_NEGATIVE}; no clocks, no hourglass props, no question marks`,
  running: `front-facing or in-place running pose, body bobbing, legs in motion. ${SHARED_NEGATIVE}; no dust, no speed lines, no motion arcs`,
  review: `focused inspecting pose, slight forward lean, head tilted, attentive eyes. Show focus through pose only. ${SHARED_NEGATIVE}; no magnifying glasses unless that prop already exists in the base, no papers, no code snippets, no question marks`,
};

export const IDENTITY_LOCK_SUFFIX =
  'Identity lock: do not redesign the character. Preserve the exact head shape, face, markings, color palette, outline weight, body proportions, outfit, and silhouette of the reference image. Only change the pose to match the requested state.';

const PROMPT_PREFIX = [
  'pixel-art-adjacent low-resolution mascot sprite',
  'compact chibi proportions, chunky whole-body silhouette',
  'thick dark 1-2px outline, visible stepped pixel edges',
  'limited palette, flat cel shading with at most one highlight and one shadow step',
  'simple readable face, tiny limbs, three-quarter or side view',
  'NOT a polished illustration, NOT painterly rendering, NOT anime key art',
  'NOT 3D rendering, NOT glossy app-icon treatment, NOT realistic fur or material texture',
  'NOT soft gradients, NOT high-detail antialiasing',
].join(', ');

export interface CodexPetConfig {
  /** Generation size (px). 128 fits inside Codex's 192×208 cell with margin. */
  size: number;
  paletteColors: number;
  promptPrefix: string;
}

export const CODEX_PET_TEMPLATE: CodexPetConfig = {
  size: 128,
  paletteColors: 32,
  promptPrefix: PROMPT_PREFIX,
};
