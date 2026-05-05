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

/** Per-state prompt suffix appended to the user's character description. */
export const STATE_PROMPT_SUFFIX: Record<AgentHydrationState, string> = {
  idle: 'in idle standing pose, neutral expression',
  active: 'in alert active pose, eyes open wide',
  thinking: 'thinking pose, hand on chin, contemplative',
  coding: 'typing on a small keyboard, focused',
  testing: 'holding a magnifying glass, inspecting',
  error: 'distressed expression, X marks for eyes',
  done: 'celebrating with arms raised, happy',
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

export const AGENT_HYDRATION_TEMPLATE: AgentHydrationConfig = {
  size: 64,
  framesPerState: 1,
  fps: 8,
  paletteColors: 16,
  promptPrefix: 'cute pixel art chibi character, frontal view',
};
