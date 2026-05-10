// Action: parts_list — introspect the Pixabots outfit parts catalog.

import { defineAction, s } from '@ageniti/core';
import { PARTS, type PartCategory } from '@/lib/parts/catalog';

const CATEGORIES: PartCategory[] = ['eyes', 'heads', 'body', 'top'];

export const partsList = defineAction({
  name: 'parts_list',
  description:
    'List available outfit parts (eyes, heads, body, top). Use names from this list as keys in outfit input on generate/animate.',
  visibility: 'public',
  sideEffects: 'read',
  idempotency: 'idempotent',
  input: s.object({
    category: s
      .enum(['eyes', 'heads', 'body', 'top'])
      .optional()
      .describe('Filter to a single category. If omitted, returns all four.'),
  }),
  output: s.object({
    parts: s.record(
      s.array(
        s.object({
          name: s.string(),
          path: s.string(),
          frames: s.number().optional(),
          kind: s.string().optional(),
        }),
      ),
    ),
  }),
  async run(input) {
    const cats = input.category ? [input.category as PartCategory] : CATEGORIES;
    const parts: Record<string, unknown[]> = {};
    for (const cat of cats) {
      parts[cat] = PARTS[cat].map((p) => ({
        name: p.name,
        path: p.path,
        frames: p.frames,
        kind: p.kind,
      }));
    }
    return { parts: parts as Record<string, Array<{ name: string; path: string; frames?: number; kind?: string }>> };
  },
});
