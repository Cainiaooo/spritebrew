# SpriteBrew

Canonical project context lives in `AGENTS.md`. Read that first. This file is the short working version for agent tasks.

## Focus Areas

- Web UI: `src/app/`, `src/components/`, `src/stores/`
- Shared generation core: `src/lib/generation/`
- Image backends and auth: `src/lib/imageGen/` and `src/lib/imageGen/auth/`
- Style definitions: `src/lib/styleRegistry.ts`
- CLI surface: `src/ageniti/`

## Working Rules

- Prefer changing shared generation code over patching web-only behavior.
- Keep auth resolution centralized in `src/lib/imageGen/auth/`.
- Keep AI routes on the Node.js runtime if they touch Codex auth.
- Treat `src/lib/styleRegistry.ts` as the single source of truth for styles.
- Use `src/stores/spriteStore.ts` as the sprite state source.

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run test

npm run cli -- actions
npm run cli -- generate --schema
npm run cli:typecheck
```

## Env Summary

```env
IMAGE_GEN_AUTH_MODE=api-key
IMAGE_GEN_API_PROVIDER=

OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=high

CODEX_HOME=
CODEX_MAIN_MODEL=

GEMINI_API_KEY=
```

## Edit Map

- New style: `src/lib/styleRegistry.ts`
- New animation type: `src/lib/generation/validate.ts`
- New adapter: `src/lib/imageGen/` plus `src/lib/imageGen/index.ts`
- New auth mode: `src/lib/imageGen/auth/types.ts` and `resolver.ts`
- New CLI action: `src/ageniti/actions/` and `src/ageniti/app.ts`
