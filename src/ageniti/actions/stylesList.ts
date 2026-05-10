// Action: styles_list — introspect the generation style registry.

import { defineAction, s } from '@ageniti/core';
import { GENERATION_STYLES } from '@/lib/styleRegistry';

export const stylesList = defineAction({
  name: 'styles_list',
  description:
    'List available generation styles. Filter by tier (fast/plus/pro/animation) or category.',
  visibility: 'public',
  sideEffects: 'read',
  idempotency: 'idempotent',
  input: s.object({
    tier: s
      .enum(['fast', 'plus', 'pro', 'animation'])
      .optional()
      .describe('Filter by tier.'),
    category: s
      .enum(['characters', 'items', 'environments', 'animations', 'tiles', 'ui'])
      .optional()
      .describe('Filter by category.'),
  }),
  output: s.object({
    styles: s.array(
      s.object({
        id: s.string(),
        label: s.string(),
        description: s.string(),
        tier: s.string(),
        category: s.string(),
        defaultWidth: s.number(),
        defaultHeight: s.number(),
        minSize: s.number(),
        maxSize: s.number(),
        isAnimation: s.boolean(),
        supportsRemoveBg: s.boolean(),
        supportsReferenceImages: s.boolean().optional(),
        resolutionMode: s.any().optional(),
      }),
    ),
  }),
  async run(input) {
    const filtered = GENERATION_STYLES.filter((style) => {
      if (input.tier && style.tier !== input.tier) return false;
      if (input.category && style.category !== input.category) return false;
      return true;
    }).map((style) => ({
      id: style.id,
      label: style.label,
      description: style.description,
      tier: style.tier,
      category: style.category,
      defaultWidth: style.defaultWidth,
      defaultHeight: style.defaultHeight,
      minSize: style.minSize,
      maxSize: style.maxSize,
      isAnimation: style.isAnimation,
      supportsRemoveBg: style.supportsRemoveBg,
      supportsReferenceImages: style.supportsReferenceImages,
      resolutionMode: style.resolutionMode,
    }));
    return { styles: filtered };
  },
});
