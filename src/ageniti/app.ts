// SpriteBrew Ageniti app — single source of truth for the agent-facing
// surface. Define actions once; CLI / HTTP / MCP / OpenAI tools all flow
// from this same registration.

import { createAgenitiApp } from '@ageniti/core';
import { generate } from './actions/generate';
import { animate } from './actions/animate';
import { stylesList } from './actions/stylesList';
import { partsList } from './actions/partsList';
import { codexBuild } from './actions/codexBuild';
import { bundle } from './actions/bundle';

export const app = createAgenitiApp({
  name: 'spritebrew',
  description: 'AI-powered pixel art sprite sheet generator — agent surface.',
  docs: {
    summary:
      'Use this app to generate pixel-art sprites and animations. Start by listing styles, then call generate (text→sprite) or animate (sprite→strip). Use bundle for multi-asset generation in one call.',
    audience: 'AI agents and CLI users driving SpriteBrew headlessly.',
    quickStart: [
      'spritebrew styles_list --tier fast    # see fast-tier styles',
      'spritebrew generate --prompt "a cute red dragon" --style character --width 64 --height 64',
      'spritebrew animate --input-image $(base64 -w0 char.png) --action walking --frames-duration 6',
      'spritebrew bundle --type spell --prompt "ice wizard" --width 64',
    ],
  },
  actions: [generate, animate, bundle, stylesList, partsList, codexBuild],
});
