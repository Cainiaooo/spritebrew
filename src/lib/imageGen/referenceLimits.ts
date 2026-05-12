// Shared limits for reference-image inputs.
//
// This file is intentionally dependency-free so both server code and client UI
// can consume the same limits without pulling in server-only modules.

export const MAX_REFERENCE_IMAGES = 16;
/** Loose cap for multipart payload size. 12MB decoded → ~16MB base64. */
export const REF_TOTAL_BASE64_BUDGET = Math.floor((12 * 1024 * 1024 * 4) / 3);
