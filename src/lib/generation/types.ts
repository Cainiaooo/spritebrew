// Shared input types for generation runners — used by both the Next.js
// SSE route and the Ageniti CLI action wrappers.

import type { Outfit } from '@/lib/parts/catalog';
import type { PartialImageHandler } from '@/lib/imageGen/types';
import type { QaWarning } from '@/lib/imageGen/qa';

export interface CreateInput {
  prompt: string;
  promptStyle?: string;
  style?: string;
  width?: number;
  height?: number;
  removeBg?: boolean;
  referenceImages?: string[];
  outfit?: Outfit;
}

export interface AnimateInput {
  inputImage: string;
  action: string;
  framesDuration?: number;
  motionPrompt?: string;
  width?: number;
  height?: number;
  outfit?: Outfit;
}

export interface CreateResult {
  success: true;
  imageUrl: string;
  prediction: { status: string; cost?: number };
  qaWarnings: QaWarning[];
}

export interface AnimateResult {
  success: true;
  imageUrl: string;
  prediction: {
    status: string;
    cost?: number;
    frameCount: number;
    layout: string;
    sourcePxPerFrame: string;
  };
  qaWarnings: QaWarning[];
}

export type { PartialImageHandler, QaWarning };

// ─── Map Generation (Phase 5 POC) ───

export interface MapCreateInput {
  prompt: string;
  style: 'overworld' | 'dungeon' | 'interior' | 'forest' | 'desert';
  width?: number;
  height?: number;
}

export interface MapCreateResult {
  success: true;
  baseImageUrl: string;
  dressedImageUrl: string;
  prediction: { status: string; cost?: number };
}

export interface PropPackInput {
  dressedImage: string; // base64, no data: prefix
  prompt: string;
  width?: number;
  height?: number;
}

export interface PropPackResult {
  success: true;
  props: Array<{ id: string; imageUrl: string; label: string }>;
  prediction: { status: string; cost?: number };
}

export interface ComposePreviewInput {
  baseImage: string; // base64
  props: Array<{ imageBase64: string; x: number; y: number; scale?: number }>;
  width: number;
  height: number;
}

export interface ComposePreviewResult {
  success: true;
  composedImageUrl: string;
}
