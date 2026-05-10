#!/usr/bin/env -S tsx
// SpriteBrew CLI entry point.
// Run via `npm run cli -- <command>` or `tsx bin/spritebrew.ts <command>`.

import { app } from '@/ageniti/app';

void (async () => {
  const cli = app.createCli({
    name: 'spritebrew',
  });
  await cli.main();
})();
