// AgentHydration template — drives the /agent-hydration batch page.
//
// v1 ships single-frame per state. Animated per-state cycles are deferred —
// frame consistency across states is the harder problem and is out of scope
// for the first integration.

export const AGENT_HYDRATION_STATES = [
  'idle',
  'active',
  'thinking',
  'coding',
  'testing',
  'error',
  'done',
] as const;

export type AgentHydrationState = (typeof AGENT_HYDRATION_STATES)[number];

export const AGENT_HYDRATION_AGENT_TYPES = [
  'claude-code',
  'codex-cli',
  'gemini-cli',
  'default',
] as const;

export type AgentHydrationAgentType = (typeof AGENT_HYDRATION_AGENT_TYPES)[number];

// Shared artifact-prevention rules appended to every state suffix. Mirrors
// the Codex Pet "Transparency And Effects" section: floating effects, motion
// trails, and shadows are the most common AI-generated failures and must be
// suppressed up front rather than cleaned up downstream.
const SHARED_NEGATIVE = [
  'no speed lines, no motion arcs, no afterimages, no smears',
  'no detached sparkles, floating symbols, speech bubbles, or thought bubbles',
  'no cast shadows, drop shadows, oval floor shadows, glow, halo, or aura',
  'no text, labels, frame numbers, UI panels, or code snippets',
  'fully transparent background (alpha 0) — no checker pattern, no white fill',
].join('; ');

/**
 * Per-state prompt suffix appended to the user's character description.
 *
 * Each entry is "positive pose description" + SHARED_NEGATIVE + state-specific
 * negatives. The state-specific tail forbids the cliché props/symbols the
 * model otherwise reaches for (✗ marks for error, gears for thinking, etc.) —
 * these are cleaner-looking when expressed through pose alone.
 */
export const STATE_PROMPT_SUFFIX: Record<AgentHydrationState, string> = {
  idle: `neutral standing pose, soft breathing posture, calm expression. ${SHARED_NEGATIVE}`,
  active: `alert pose, body leaning slightly forward, eyes wide open, attentive expression. ${SHARED_NEGATIVE}; no exclamation marks, no action streaks`,
  thinking: `hand near chin, head tilted slightly, contemplative gaze. Show focus through pose only. ${SHARED_NEGATIVE}; no question marks, no thought bubbles, no floating gears or lightbulbs`,
  coding: `seated typing pose with a small keyboard prop attached to the lap or hands, focused expression. ${SHARED_NEGATIVE}; no flying code symbols, no glowing keys, no motion lines on hands`,
  testing: `leaning forward, holding a small magnifying glass attached to the paw, inspecting expression. ${SHARED_NEGATIVE}; no floating checkmarks, no red X overlays, no inspection sparkles`,
  error: `slumped or deflated posture, downcast face, sad expression. A single tear touching the cheek or a small smoke puff touching the head is allowed if it overlaps the silhouette. ${SHARED_NEGATIVE}; no red X marks for eyes, no detached tear drops, no floating error symbols`,
  done: `arms raised in celebration, happy expression, content smile. ${SHARED_NEGATIVE}; no confetti, no detached stars or sparkles, no fireworks, no exclamation marks`,
};

// Appended to non-idle state prompts. Idle is generated first as the canonical
// base; subsequent states pass it back as a reference image and use this lock
// to keep silhouette/palette/proportions stable across the 7-state pack.
export const IDENTITY_LOCK_SUFFIX =
  'Identity lock: do not redesign the character. Preserve the exact head shape, face, markings, color palette, outline weight, body proportions, outfit, and silhouette of the reference image. Only change the pose to match the requested state.';

export interface AgentHydrationConfig {
  size: number;
  framesPerState: number;
  fps: number;
  paletteColors: number;
  promptPrefix: string;
}

// Style baseline shared across all 7 states. Two halves:
//   1. Positive: what the sprite IS — chibi mascot proportions, thick outline,
//      visible stepped pixel edges, limited palette, flat cel shading.
//   2. Negative: what the sprite IS NOT — polished illustration, painterly
//      rendering, anime key art, 3D, glossy app-icon, realistic textures,
//      soft gradients. References more detailed than this should be
//      simplified into the house style before generation.
const PROMPT_PREFIX = [
  'pixel-art-adjacent low-resolution mascot sprite',
  'compact chibi proportions, chunky whole-body silhouette',
  'thick dark 1-2px outline, visible stepped pixel edges',
  'limited palette, flat cel shading with at most one highlight and one shadow step',
  'simple readable face, tiny limbs, frontal or three-quarter view',
  'NOT a polished illustration, NOT painterly rendering, NOT anime key art',
  'NOT 3D rendering, NOT glossy app-icon treatment, NOT realistic fur or material texture',
  'NOT soft gradients, NOT high-detail antialiasing',
].join(', ');

export const AGENT_HYDRATION_TEMPLATE: AgentHydrationConfig = {
  size: 64,
  framesPerState: 1,
  fps: 8,
  paletteColors: 16,
  promptPrefix: PROMPT_PREFIX,
};
