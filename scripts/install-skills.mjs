#!/usr/bin/env node
// Copies every skill under ./skills/<name>/ into ./.claude/skills/<name>/
// so Claude Code's project-scoped skill discovery picks them up.

import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = join(root, 'skills');
const dst = join(root, '.claude', 'skills');

if (!existsSync(src)) {
  console.error(`No skills/ directory at ${src}`);
  process.exit(1);
}

await mkdir(dst, { recursive: true });

const entries = await readdir(src, { withFileTypes: true });
let installed = 0;

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const from = join(src, entry.name);
  const to = join(dst, entry.name);
  const skillFile = join(from, 'SKILL.md');
  try {
    await stat(skillFile);
  } catch {
    console.warn(`  skip ${entry.name}: no SKILL.md`);
    continue;
  }
  await cp(from, to, { recursive: true, force: true });
  console.log(`  installed: ${entry.name}`);
  installed++;
}

console.log(`\nDone. ${installed} skill(s) copied to .claude/skills/.`);
console.log('Restart Claude Code to pick them up.');
