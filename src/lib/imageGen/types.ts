// Shared types for the image-generation adapter layer.
// Both GptImageAdapter and GeminiAdapter implement ImageGenAdapter.

export interface GenerateRequest {
  prompt: string;
  width: number;
  height: number;
  referenceImages?: string[];
  onPartialImage?: PartialImageHandler;
}

export interface EditRequest {
  referenceImage: string;
  prompt: string;
  canvasSize?: { w: number; h: number };
  onPartialImage?: PartialImageHandler;
}

export type PartialImageHandler = (rawBase64Image: string) => void | Promise<void>;

export interface GenResult {
  rawBase64Image: string;
  rawWidth: number;
  rawHeight: number;
  cost?: number;
}

export interface ImageGenAdapter {
  generate(req: GenerateRequest): Promise<GenResult>;
  editWithReference(req: EditRequest): Promise<GenResult>;
}

export type ImageGenProvider = 'gpt-image' | 'gpt-image-responses' | 'gemini';
