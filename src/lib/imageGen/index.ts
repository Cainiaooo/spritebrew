// Factory that returns the configured ImageGenAdapter.
//
// Provider is chosen at runtime via IMAGE_GEN_API_PROVIDER:
//   gpt-image (default) → GptImageAdapter
//   gemini              → GeminiAdapter
//
// Result is memoized per provider so subsequent calls reuse the same instance.

import { GeminiAdapter } from './geminiAdapter';
import { GptImageAdapter } from './gptImageAdapter';
import type { ImageGenAdapter, ImageGenProvider } from './types';

export type { GenerateRequest, EditRequest, GenResult, ImageGenAdapter, ImageGenProvider } from './types';

const cache = new Map<ImageGenProvider, ImageGenAdapter>();

export function getImageGenAdapter(): ImageGenAdapter {
  const provider = (process.env.IMAGE_GEN_API_PROVIDER ?? 'gpt-image') as ImageGenProvider;
  const cached = cache.get(provider);
  if (cached) return cached;

  let adapter: ImageGenAdapter;
  switch (provider) {
    case 'gpt-image':
      adapter = new GptImageAdapter();
      break;
    case 'gemini':
      adapter = new GeminiAdapter();
      break;
    default:
      throw new Error(`Unknown IMAGE_GEN_API_PROVIDER: ${provider}`);
  }
  cache.set(provider, adapter);
  return adapter;
}

// Test-only: clear cached adapters (e.g. when env changes between tests).
export function resetImageGenAdapter(): void {
  cache.clear();
}
