# SpriteBrew Skills

Versioned [Claude Code](https://claude.com/claude-code) skills shipped with this repo. Skills teach Claude (or any compatible agent) how to drive SpriteBrew effectively.

| Skill | Purpose |
|---|---|
| [`spritebrew-cli/`](./spritebrew-cli/SKILL.md) | How to call the SpriteBrew CLI (5 actions, NDJSON streaming, common pitfalls). Loads automatically when the user asks for headless sprite generation. |

## Install

Claude Code discovers skills under either `.claude/skills/<name>/SKILL.md` (per-project) or `~/.claude/skills/<name>/SKILL.md` (global). This repo keeps the canonical files under `skills/`; you choose where to install them.

### Project-scoped install (recommended)

Installs the skill only for this checkout of SpriteBrew.

```bash
npm run skills:install
```

That copies every `skills/<name>/` directory into `.claude/skills/<name>/`. `.claude/` is git-ignored, so the install is local — re-run it after pulling skill updates.

### Global install (every project sees the skill)

```bash
# macOS / Linux
mkdir -p ~/.claude/skills && cp -r skills/spritebrew-cli ~/.claude/skills/

# Windows PowerShell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills" | Out-Null
Copy-Item -Recurse -Force skills\spritebrew-cli "$env:USERPROFILE\.claude\skills\"
```

### Verify install

Restart Claude Code, then ask something like _"用 spritebrew 给我画一只像素猫"_. The skill should auto-load (the CLI prints loaded skills near the top of the session). You can also confirm with `/skills` if your client supports it.

## Authoring new skills

1. Create `skills/<your-skill>/SKILL.md` with YAML frontmatter (`name`, `description`).
2. Update the table above.
3. Run `npm run skills:install` to test locally.
4. Open a PR — the new skill ships with the next release.
