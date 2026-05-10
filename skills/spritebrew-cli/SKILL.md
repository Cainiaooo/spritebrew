---
name: spritebrew-cli
description: Use when the user wants to generate pixel-art sprites or animations through SpriteBrew without opening the web UI — phrases like "spritebrew CLI", "用 spritebrew 出图", "headless sprite generate", "agent generate sprite", "像素角色生成", "generate sprite from terminal", "batch sprite generation". Drives the project's `npm run cli -- ...` interface (Ageniti-powered). Skip when the user wants the browser UI, when working in another sprite tool, or for non-sprite image generation.
---

# SpriteBrew CLI

This project exposes its sprite-generation capabilities as a stateless Ageniti CLI so agents can drive it headlessly. Use this skill when the user wants to generate sprites/animations from a terminal, batch them, or have you (the agent) drive sprite generation as part of a larger task.

## When to use

- "Generate a pixel-art X" / "make me a sprite of X"
- "Animate this character with a walk cycle"
- "Build a Codex pet bundle"
- "List the available styles / parts"
- Any sprite generation that should NOT require a human clicking the web UI

## When NOT to use

- The user explicitly says "open the page" / "let me click around" → tell them `npm run dev` and stop
- The user wants non-pixel-art image generation → use a different tool
- The user wants slicing or engine-export (TexturePacker / Godot .tres / etc.) — those are NOT in the CLI yet (web-only for now)

## Capability map

5 actions are exposed. Always run from the project root.

| Action | Purpose | Side effects |
|---|---|---|
| `actions` | Print full manifest of all actions and their JSON Schemas | none |
| `<action> --schema` | Print JSON Schema for one action's input | none |
| `styles_list` | List generation styles, optionally filtered by tier or category | none |
| `parts_list` | List Pixabots outfit parts by category | none |
| `generate` | Text → single pixel-art sprite (PNG) | calls AI provider, costs $$$ |
| `animate` | Existing sprite → multi-frame animation strip | calls AI provider, costs $$$ |
| `codex_build` | 9 state PNGs → Codex Pet bundle (pet.json + WebP atlas) | none, pure compose |

### Decision tree

- **User wants a fresh sprite from a description** → `generate`
- **User wants to add motion to an existing sprite** → `animate`
- **User asks "what styles are there"** → `styles_list`
- **User asks about outfits / overlays** → `parts_list`
- **User has 9 codex pet state images and wants to package them** → `codex_build`
- **User asks anything else (slicing, engine export, gallery, tokens)** → tell them this CLI doesn't cover it; suggest the web UI

## Invocation form

```bash
npm run cli -- <action> [--field value]... [--json '{...}'] [--schema] [--ndjson] [--idempotency-key KEY]
```

- Arguments after `--` are passed to the CLI. Don't forget the `--`.
- Field names map directly from the action's input schema. Booleans flip with `--field` / `--no-field`.
- `--json '<JSON>'` lets you pass the entire input as one JSON blob (preferred for nested fields like `outfit`).
- `--schema` prints the action's JSON Schema and exits — use this whenever you're unsure about a field name.
- `--ndjson` streams every event (log / progress / artifact / result) as one JSON object per line. Use it for long-running `generate` and `animate` so you can show the user partial-image previews.

## Output envelope

Default mode (no `--ndjson`) prints one pretty JSON envelope:

```json
{
  "ok": true,
  "data": { "imageBase64": "...", "cost": 0.018, "qaWarnings": [] },
  "artifacts": [],
  "logs": [],
  "meta": { "action": "generate", "invocationId": "...", "surface": "cli", "durationMs": 4521 }
}
```

On error:

```json
{
  "ok": false,
  "error": { "code": "VALIDATION_ERROR", "message": "...", "issues": [], "retryable": false },
  "artifacts": [],
  "logs": [...],
  "meta": {...}
}
```

Standard error codes you should expect: `VALIDATION_ERROR`, `INTERNAL_ERROR`, `EXTERNAL_SERVICE_ERROR`, `TIMEOUT`, `CANCELLED`, `RATE_LIMITED`. The non-zero exit code matches the error class — script accordingly.

### NDJSON events

When `--ndjson` is set, each line is one of:
- `{ "type": "log", "level": "info", "message": "...", "fields": {...} }` — informational log from inside the action
- `{ "type": "progress", "percent": 50, "message": "..." }` — explicit progress report
- `{ "type": "artifact", "artifact": { "type": "partial-image", "metadata": { "base64": "..." } } }` — `generate`/`animate` emit one of these per AI partial preview frame
- `{ "type": "result", "envelope": { "ok": true, "data": {...} } }` — always the final line

For `generate` and `animate`, each `partial-image` artifact contains a base64 PNG of the in-progress frame straight from the model. You can save these to give the user a "watching it generate" experience.

## Standard workflows

### Workflow A — text-to-sprite (most common)

1. Decide if you need to discover a style or already know one.
2. List candidate styles (cheap, no AI cost):
   ```bash
   npm run cli -- styles_list --tier fast    # icons, simple
   npm run cli -- styles_list --tier plus    # standard chars/items
   npm run cli -- styles_list --tier pro     # high detail
   npm run cli -- styles_list --category characters
   ```
3. Generate. Use `--ndjson` so the user sees progress; redirect the result to a file:
   ```bash
   npm run cli -- generate \
     --prompt "a cute red dragon, friendly, big eyes" \
     --style character \
     --width 64 --height 64 \
     > result.json
   ```
4. Extract the PNG:
   ```bash
   jq -r .data.imageBase64 result.json | base64 -d > dragon.png
   ```
5. If `qaWarnings` is non-empty, show it to the user — common codes: `BACKGROUND_NOT_REMOVED`, `MOSTLY_TRANSPARENT`, `MOSTLY_OPAQUE`.

### Workflow B — animate an existing character

1. Confirm the source sprite is square. The CLI will reject non-square input.
2. Encode the sprite to base64 (no `data:` prefix):
   ```bash
   B64=$(base64 -w0 char.png)    # Linux
   # PowerShell: $B64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes('char.png'))
   ```
3. Animate:
   ```bash
   npm run cli -- animate \
     --input-image "$B64" \
     --action walking \
     --frames-duration 6 \
     --width 64 \
     --ndjson
   ```
4. The output `imageBase64` is a horizontal strip — `frameCount` frames of `width × width` each, side by side.

### Workflow C — outfit overlay

1. Discover available parts:
   ```bash
   npm run cli -- parts_list                   # all categories
   npm run cli -- parts_list --category eyes
   ```
2. Pass an outfit map via `--json` (CLI flag form gets messy for nested fields):
   ```bash
   npm run cli -- generate --json '{
     "prompt": "a cyber mascot",
     "style": "character",
     "outfit": { "eyes": "visor", "heads": "frame", "top": "antenna" }
   }'
   ```

### Workflow D — Codex pet bundle

1. Generate or collect 9 state PNGs (states: `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, `review`).
2. Pack them as a state→base64 map and feed `codex_build`:
   ```bash
   npm run cli -- codex_build --json '{
     "meta": { "id": "my-pet", "displayName": "My Pet", "description": "..." },
     "states": { "idle": "<b64>", "running-right": "<b64>", ... }
   }'
   ```
3. The output `spritesheetWebpBase64` is a 1536×1872 lossless WebP atlas — write it as `spritesheet.webp` next to `pet.json` from `data.petJson`.

## Common pitfalls

- **Style resolution constraints**. Some styles lock to a specific size (e.g. `animation-walk` is locked at 64×64). If you pass non-matching `--width`/`--height`, you'll get `VALIDATION_ERROR`. Check `resolutionMode` in `styles_list`.
- **Reference / input images must NOT include the `data:image/...;base64,` prefix.** Pass raw base64 only. `generate`/`animate` strip a leading `data:` prefix from `inputImage` defensively, but `referenceImages[]` does not.
- **Animation must be square.** `animate` rejects `width !== height`. Use `--width 64` and let height default.
- **Frame count is fixed.** `framesDuration` must be `4`, `6` (default), or `8`. Anything else is rejected.
- **Reference image budget.** Up to 4 images, total base64 payload under ~16 MiB.
- **`generate --style nonexistent` does not error**. The runner falls back to the first registered style. To target a specific style reliably, pull the id from `styles_list` first.
- **API key required.** Every `generate`/`animate` call hits a real AI provider. The CLI reads `OPENAI_API_KEY` (or Gemini equivalent) from the project's `.env.local`. If missing, you get `INTERNAL_ERROR: OPENAI_API_KEY is not set.`

## Idempotency and retries

For any `generate`/`animate` call you may need to retry, pass `--idempotency-key <key>` (e.g. a random UUID). Within ~5 minutes, repeated calls with the same key + same input replay the cached result instead of re-billing the AI.

```bash
KEY=$(uuidgen)
npm run cli -- generate --prompt "..." --style character --idempotency-key "$KEY"
# safe to retry the same command — second call is a cache hit
```

## Schema discovery (always available)

Whenever you don't remember the exact field name, ask the CLI:

```bash
npm run cli -- actions                   # all actions, full schemas
npm run cli -- generate --schema         # one action's input schema
npm run cli -- manifest                  # full surface manifest
```

The schemas are the source of truth. Do not guess field names — query them.

## Going deeper

For protocol details (more flags, JSON-RPC over MCP, OpenAI tool form, error code mapping), see `E:\Projects\Ageniti\AGENTS.md`. Most of that is unnecessary for routine sprite generation; come back to it only if a basic invocation isn't working.
