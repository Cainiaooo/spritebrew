# SpriteBrew

AI-powered pixel art sprite sheet generator. Forked from GAlbanese09/spritebrew.

## Project Structure

```
spritebrew/
  src/
    app/                  — Next.js 16 App Router pages + API routes
      api/generate/       — SSE-streaming generation endpoint (Retro Diffusion API)
      api/generation-limit/ — Per-user daily limit check
      api/stripe/         — Stripe checkout + webhook
      api/token-balance/  — Token balance CRUD (Cloudflare KV)
      api/waitlist/       — Waitlist management (Cloudflare KV)
      generate/           — Create New / Animate My Character UI
      upload/             — Upload & Slice sprite sheet
      export/             — Multi-engine export page
      gallery/            — Per-user generation history
      preview/            — PixiJS animation preview / demo area
      buy-tokens/         — Stripe-powered token purchase
      admin/              — Admin tools (test-references, etc.)
    components/
      layout/             — AppShell, Header, Sidebar, ClerkClientProvider
      sprites/            — Core sprite tools (SlicerConfig, GenerationForm, PixelEditor, etc.)
      ui/                 — Reusable UI primitives (Button, Card, Badge, Tooltip)
    lib/                  — Shared utilities and business logic
      constants.ts        — Sprite sizes, slicer presets, animation types, engine targets
      types.ts            — TypeScript interfaces (SpriteFrame, SpriteAnimation, SpriteSheet, etc.)
      styleRegistry.ts    — Generation style registry (single source of truth for all RD prompt_style values)
      exportEngine.ts     — Multi-engine export logic (TexturePacker, Godot .tres, Aseprite, etc.)
      spriteUtils.ts      — Sprite manipulation helpers
      generationHistory.ts — Per-user history persistence (localStorage + KV)
      generationLimits.ts — Daily generation limits (localStorage)
      sseClient.ts        — Client-side SSE consumer for streaming generation
      tokenBalance.ts     — Token debit/credit against Cloudflare KV
      stripe.ts           — Stripe checkout session + webhook handler
      accountLock.ts      — Account lock/dispute status check
    stores/
      spriteStore.ts      — Zustand global state (sprite sheet, frames, animations, generation state)
  public/                 — Static assets
  scripts/
    generate-favicon.mjs  — Favicon generation script
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (React 19), App Router, Edge Runtime |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Animation Preview | PixiJS 8 |
| Auth | Clerk (`@clerk/react`) |
| AI Backend | Retro Diffusion direct API (`api.retrodiffusion.ai/v1/inferences`) |
| Storage | Cloudflare KV |
| Payments | Stripe |
| Export | JSZip |
| Hosting | Cloudflare Pages (via `@opennextjs/cloudflare`) |
| License | AGPL-3.0 (forked) |

## Build & Dev Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development server (localhost:3000)
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint
```

**Environment variables** (`.env.local`):
```
RETRO_DIFFUSION_API_KEY=...        # Required for AI generation
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...  # Required for auth UI
CLERK_SECRET_KEY=...               # Required for auth backend
# Optional:
REPLICATE_API_TOKEN=...            # Legacy, no longer used
STRIPE_SECRET_KEY=...              # Token purchase payments
STRIPE_WEBHOOK_SECRET=...          # Stripe webhook verification
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=...
```

## Key Architecture Patterns

### SSE Streaming Generation
The `/api/generate` route uses Server-Sent Events with 15-second heartbeat pings to keep the Cloudflare proxy alive during long AI generations (Cloudflare Pages has a 120-second proxy timeout). Client consumes via `src/lib/sseClient.ts`.

### Style Registry
`src/lib/styleRegistry.ts` is the **single source of truth** for all generation styles. Each entry maps to a Retro Diffusion `prompt_style` value. Styles are organized by tier:
- **fast** (3 tokens, $0.015-0.02/image, 64-384px)
- **plus** (10 tokens, $0.025-0.06/image, 16-192px)
- **pro** (40 tokens, $0.22/image, 96-256px, supports reference images)
- **animation** (15 tokens, $0.07/image, fixed sizes)

### Two Generation Modes
1. **Create New** (`mode: 'create'`) — Text-to-sprite via prompt + style selection
2. **Animate My Character** (`mode: 'animate'`) — Upload existing sprite + select action animation

### Token Economy
- Users purchase tokens via Stripe
- Each generation debits tokens based on style cost
- Failed generations auto-refund tokens
- Balance stored in Cloudflare KV keyed by Clerk user ID

### Multi-Engine Export
`src/lib/exportEngine.ts` supports 6 export formats:
- TexturePacker JSON Hash (Unity, Godot, Phaser, PixiJS)
- GameMaker horizontal strips
- RPG Maker MV/MZ 3×4 grid
- Aseprite JSON
- **Godot SpriteFrames .tres** ← directly usable in Godot 4
- Raw Frames ZIP (individual PNGs)

## Coding Conventions

- TypeScript strict mode, React 19 with App Router
- Edge Runtime for API routes (`export const runtime = 'edge'`)
- Components in PascalCase, files in PascalCase.tsx
- Shared types in `src/lib/types.ts` — import from there, don't redeclare
- Style registry is append-friendly: add new styles to `GENERATION_STYLES` array in `styleRegistry.ts`
- Constants (sizes, presets, animation types) live in `src/lib/constants.ts` — add presets there for automatic UI propagation
- Zustand store (`spriteStore.ts`) is the single state source — don't use React context for sprite state

## What to Update When Making Changes

- **Adding a new generation style** → Add entry to `GENERATION_STYLES` in `styleRegistry.ts`
- **Adding a new animation type** → Add to `ANIMATION_TYPES` in `constants.ts` + `VALID_ACTIONS` + `ACTION_STYLE_MAP` + `ACTION_PROMPT_PREFIX` in `api/generate/route.ts`
- **Adding a new export format** → Add to `ENGINE_TARGETS` in `constants.ts` + implement in `exportEngine.ts`
- **Adding a new sprite size preset** → Add to `SLICER_FRAME_PRESETS` in `constants.ts`
- **Changing AI backend** → Modify `callRD()` in `api/generate/route.ts` + update `styleRegistry.ts` prompt_style values

## Fork Notes

This is a private fork by Cainiaooo for custom development. Upstream: GAlbanese09/spritebrew.

Planned modifications:
- Replace Retro Diffusion API with custom/self-hosted AI model backend
- Adapt token/billing system for internal use
- Potentially integrate with game-simulate project's asset pipeline
