export const BUNDLE_TYPES = ['unit', 'spell', 'combat', 'character_full'] as const;
export type BundleType = (typeof BUNDLE_TYPES)[number];

export interface BundleStep {
  name: string;
  type: 'generate' | 'animate';
  promptSuffix?: string;
  action?: string;
  motionPrompt?: string;
  framesDuration?: number;
  emit?: boolean;
}

export const BUNDLE_PRESETS: Record<BundleType, BundleStep[]> = {
  unit: [
    { name: 'idle', type: 'generate', promptSuffix: ', idle pose, standing' },
    { name: 'walk', type: 'animate', action: 'walking', framesDuration: 6 },
  ],
  spell: [
    {
      name: 'cast_source',
      type: 'generate',
      promptSuffix: ', casting spell pose, magical energy gathering',
      emit: false,
    },
    {
      name: 'cast',
      type: 'animate',
      action: 'custom_action',
      motionPrompt: 'spellcasting motion, channeling magical energy, hands and sleeves moving',
      framesDuration: 6,
    },
    {
      name: 'projectile',
      type: 'generate',
      promptSuffix: ', magic projectile, glowing orb, flying',
    },
    { name: 'impact', type: 'generate', promptSuffix: ', magic impact explosion, burst effect' },
  ],
  combat: [
    { name: 'idle', type: 'generate', promptSuffix: ', idle combat stance' },
    { name: 'attack', type: 'animate', action: 'attack', framesDuration: 6 },
    {
      name: 'hurt',
      type: 'animate',
      action: 'custom_action',
      motionPrompt: 'hurt reaction, brief recoil, defensive stagger',
      framesDuration: 4,
    },
  ],
  character_full: [
    { name: 'idle', type: 'generate', promptSuffix: ', idle pose, standing' },
    { name: 'walk', type: 'animate', action: 'walking', framesDuration: 6 },
    { name: 'attack', type: 'animate', action: 'attack', framesDuration: 6 },
    {
      name: 'hurt',
      type: 'animate',
      action: 'custom_action',
      motionPrompt: 'hurt reaction, brief recoil, defensive stagger',
      framesDuration: 4,
    },
  ],
};
