# SpriteBrew

AI-powered pixel art sprite sheet generator built with Next.js. The web UI and the agent-facing CLI share the same generation core.

## What Matters

- `src/app/`: App Router pages and API routes. AI routes live under `api/` and use the Node.js runtime.
- `src/ageniti/`: agent-facing CLI/app surface. Actions call the same generation code as the web route.
- `src/lib/generation/`: shared create / animate pipelines, prompts, validators, and shared input types.
- `src/lib/imageGen/`: adapter layer for GPT Image, Responses relay, Codex OAuth, and Gemini.
- `src/lib/imageGen/auth/`: credential resolution from env, `~/.codex`, and cached OAuth refresh state.
- `src/lib/styleRegistry.ts`: single source of truth for generation styles and per-style prompt hints.
- `src/lib/exportEngine.ts`: multi-engine export logic.
- `src/stores/spriteStore.ts`: single global sprite state store. Do not replace with React context.

## Core Rules

- Keep AI routes on `runtime = 'nodejs'` when they depend on Codex auth or other Node-only APIs.
- Fix generation behavior in `src/lib/generation/` so both web and CLI benefit.
- Inject auth via `ResolvedCredential`; do not make adapters read auth env ad hoc.
- Add or change styles in `src/lib/styleRegistry.ts`, not inside UI components.
- Reuse shared types from `src/lib/types.ts` or module-local `types.ts`; do not redeclare.

## Auth Model

- `IMAGE_GEN_AUTH_MODE` chooses the credential source:
  - `api-key`: `OPENAI_API_KEY` + `OPENAI_BASE_URL`
  - `codex-key`: `~/.codex/auth.json` API key
  - `codex-oauth`: `~/.codex/auth.json` OAuth tokens
  - `codex-auto`: env key, then Codex key, then Codex OAuth
- `IMAGE_GEN_API_PROVIDER=gemini` bypasses the OpenAI-compatible path and uses `GeminiAdapter`.
- Codex OAuth is read-only against `~/.codex`; rotated tokens are cached under `~/.spritebrew/codex-oauth-cache/`.

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
npm run test

npm run cli -- actions
npm run cli -- generate --schema
npm run cli -- styles_list --tier fast
npm run cli:typecheck
```

## Important Env Vars

```env
IMAGE_GEN_AUTH_MODE=api-key
IMAGE_GEN_API_PROVIDER=

OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=high
OPENAI_RESPONSES_IMAGE_MODE=

CODEX_HOME=
CODEX_MAIN_MODEL=

GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
```

## Common Change Map

- New style: edit `GENERATION_STYLES` in `src/lib/styleRegistry.ts`.
- New animation type: edit `VALID_ACTIONS` and `ACTION_PROMPT_PREFIX` in `src/lib/generation/validate.ts`.
- New export target: add it in `src/lib/constants.ts` and implement it in `src/lib/exportEngine.ts`.
- New size preset: edit `SLICER_FRAME_PRESETS` in `src/lib/constants.ts`.
- New image backend: add an `ImageGenAdapter` under `src/lib/imageGen/` and wire it in `src/lib/imageGen/index.ts`.
- New auth mode: extend `src/lib/imageGen/auth/types.ts` and `src/lib/imageGen/auth/resolver.ts`.
- New CLI action: add it under `src/ageniti/actions/` and register it in `src/ageniti/app.ts`.

## Quick Architecture

- `/api/generate` uses SSE and relays partial images through `src/lib/sseClient.ts`.
- `runCreate.ts` and `runAnimate.ts` are the shared pipelines for both web and CLI.
- `validation.ts` mirrors server-side GPT Image constraints early to fail before network calls.
- Export is currently a web feature; generation logic is shared, persistence is not.
