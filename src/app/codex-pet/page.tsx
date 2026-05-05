'use client';

// Codex Pet hatching page. Same idle-as-canonical-base pattern as
// agent-hydration, but generates the 9 Codex-required states and exports
// a Codex CLI bundle (pet.json + spritesheet.webp) instead of the
// hydration zip.

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Loader2, Download, AlertCircle, AlertTriangle, Check } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import HatchChecklist, {
  type HatchStep,
  type HatchStepStatus,
} from '@/components/sprites/HatchChecklist';
import { downloadAsZip } from '@/lib/downloadUtils';
import { fetchGenerationSSE } from '@/lib/sseClient';
import {
  CODEX_PET_STATES,
  CODEX_PET_TEMPLATE,
  STATE_PROMPT_SUFFIX,
  IDENTITY_LOCK_SUFFIX,
  type CodexPetState,
} from '@/lib/templates/codexPet';

const DATA_URI_PREFIX_RE = /^data:image\/[a-z]+;base64,/;

interface QaWarning {
  code: string;
  message: string;
}

interface StateProgress {
  state: CodexPetState;
  status: 'pending' | 'running' | 'done' | 'error';
  imageUrl?: string;
  error?: string;
  warnings?: QaWarning[];
}

export default function CodexPetPage() {
  const [petName, setPetName] = useState('');
  const [description, setDescription] = useState('');
  const [running, setRunning] = useState(false);
  const [hatching, setHatching] = useState(false);
  const [hatched, setHatched] = useState(false);
  const [progress, setProgress] = useState<StateProgress[]>([]);
  const [error, setError] = useState<string | null>(null);

  const startBatch = useCallback(async () => {
    if (!description.trim() || running) return;

    setError(null);
    setRunning(true);
    setHatched(false);

    const initial: StateProgress[] = CODEX_PET_STATES.map((s) => ({
      state: s,
      status: 'pending',
    }));
    setProgress(initial);

    const tmpl = CODEX_PET_TEMPLATE;
    const results: StateProgress[] = [...initial];

    let canonicalBaseB64: string | null = null;

    for (let i = 0; i < CODEX_PET_STATES.length; i++) {
      const state = CODEX_PET_STATES[i];
      const isIdle = state === 'idle';

      if (!isIdle && !canonicalBaseB64) {
        results[i] = {
          ...results[i],
          status: 'error',
          error: 'idle base unavailable — cannot identity-lock this state',
        };
        setProgress([...results]);
        continue;
      }

      results[i] = { ...results[i], status: 'running' };
      setProgress([...results]);

      const promptParts = [tmpl.promptPrefix, description.trim(), STATE_PROMPT_SUFFIX[state]];
      if (!isIdle) promptParts.push(IDENTITY_LOCK_SUFFIX);
      const prompt = promptParts.join(', ');

      try {
        const data = await fetchGenerationSSE(
          {
            mode: 'create',
            prompt,
            promptStyle: 'character',
            width: tmpl.size,
            height: tmpl.size,
            removeBg: true,
            ...(isIdle ? {} : { referenceImages: [canonicalBaseB64!] }),
          },
          null,
        );

        if (!data.success || !data.imageUrl) {
          throw new Error(String(data.error ?? 'No image returned'));
        }

        const warnings = Array.isArray(data.qaWarnings)
          ? (data.qaWarnings as QaWarning[])
          : undefined;
        results[i] = { ...results[i], status: 'done', imageUrl: data.imageUrl, warnings };
        if (isIdle && typeof data.imageUrl === 'string') {
          canonicalBaseB64 = data.imageUrl.replace(DATA_URI_PREFIX_RE, '');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        results[i] = { ...results[i], status: 'error', error: msg };
      }

      setProgress([...results]);
    }

    setRunning(false);
  }, [description, running]);

  const hatch = useCallback(async () => {
    const completed = progress.filter((p) => p.status === 'done' && p.imageUrl);
    if (completed.length === 0 || hatching) return;

    setHatching(true);
    setError(null);
    try {
      const stateImages: Record<string, string> = {};
      for (const p of completed) {
        if (!p.imageUrl) continue;
        stateImages[p.state] = p.imageUrl.replace(DATA_URI_PREFIX_RE, '');
      }

      const displayName = petName.trim() || description.trim().split(/\s+/).slice(0, 2).join(' ') || 'Pet';

      const res = await fetch('/api/codex-pet/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta: {
            displayName,
            description: description.trim(),
          },
          stateImages,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? `HTTP ${res.status}`);

      const webpBytes = Uint8Array.from(atob(data.spritesheetWebpBase64), (c) => c.charCodeAt(0));
      const webpBlob = new Blob([webpBytes], { type: 'image/webp' });

      const slug = data.meta.id;
      await downloadAsZip(
        [
          { name: `${slug}/pet.json`, data: data.petJson },
          { name: `${slug}/spritesheet.webp`, data: webpBlob },
          {
            name: `${slug}/README.md`,
            data: codexInstallReadme(slug, data.meta.displayName, data.meta.description),
          },
        ],
        `codex-pet_${slug}.zip`,
      );
      setHatched(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Hatch failed';
      setError(msg);
    } finally {
      setHatching(false);
    }
  }, [progress, petName, description, hatching]);

  const completedCount = progress.filter((p) => p.status === 'done').length;
  const allDone = progress.length > 0 && completedCount === progress.length;

  const checklistSteps = deriveCodexPetSteps({
    description,
    petName,
    progress,
    allDone,
    hatching,
    hatched,
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-sm text-accent-amber mb-2">Codex Pet Hatchery</h1>
        <p className="text-sm font-mono text-text-secondary">
          Generate the 9-state sprite atlas required by the Codex CLI&apos;s pet
          system (idle / running-right / running-left / waving / jumping /
          failed / waiting / running / review). Outputs a drop-in
          <code className="mx-1 text-accent-amber">pet.json</code>+
          <code className="mx-1 text-accent-amber">spritesheet.webp</code>
          bundle for{' '}
          <code className="text-accent-amber">~/.codex/pets/&lt;name&gt;/</code>.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
            Pet name (optional)
          </label>
          <input
            value={petName}
            onChange={(e) => setPetName(e.target.value)}
            placeholder="e.g. Mikoto"
            disabled={running}
            className="w-full rounded-lg bg-bg-elevated border border-border-default px-4 py-3
              text-sm font-mono text-text-primary placeholder:text-text-muted
              focus:outline-none focus:border-accent-amber disabled:opacity-50"
          />
        </div>

        <div>
          <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
            Character description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. blue robot cat with antenna"
            rows={2}
            disabled={running}
            className="w-full rounded-lg bg-bg-elevated border border-border-default px-4 py-3
              text-sm font-mono text-text-primary placeholder:text-text-muted resize-none
              focus:outline-none focus:border-accent-amber disabled:opacity-50"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button
            size="lg"
            onClick={startBatch}
            disabled={!description.trim() || running}
          >
            {running ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generating {completedCount}/{progress.length}...
              </>
            ) : (
              <>Generate 9-state pet</>
            )}
          </Button>
        </div>
      </Card>

      {description.trim() && (
        <HatchChecklist steps={checklistSteps} />
      )}

      {progress.length > 0 && (
        <div className="rounded-lg border border-border-default bg-bg-surface p-6 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
            {progress.map((p) => (
              <div
                key={p.state}
                className="rounded-lg border border-border-subtle bg-bg-elevated p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-text-primary">{p.state}</span>
                  {p.status === 'pending' && (
                    <span className="text-[10px] font-mono text-text-muted">queued</span>
                  )}
                  {p.status === 'running' && (
                    <Loader2 size={12} className="animate-spin text-accent-amber" />
                  )}
                  {p.status === 'done' && <Check size={12} className="text-green-400" />}
                  {p.status === 'error' && <AlertCircle size={12} className="text-red-400" />}
                </div>
                {p.imageUrl ? (
                  <div
                    className="rounded border border-border-subtle overflow-hidden flex items-center justify-center"
                    style={{
                      backgroundImage:
                        'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%)',
                      backgroundSize: '8px 8px',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.imageUrl}
                      alt={p.state}
                      className="w-20 h-20"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                ) : (
                  <div className="h-20 rounded border border-dashed border-border-subtle" />
                )}
                {p.error && (
                  <p className="text-[9px] font-mono text-red-400 truncate">{p.error}</p>
                )}
                {p.warnings && p.warnings.length > 0 && (
                  <div
                    className="flex items-start gap-1 text-[9px] font-mono text-amber-400/80"
                    title={p.warnings.map((w) => `${w.code}: ${w.message}`).join('\n')}
                  >
                    <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
                    <span className="truncate">
                      {p.warnings.length === 1
                        ? p.warnings[0].code
                        : `${p.warnings.length} warnings`}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {allDone && (
            <div className="flex justify-end">
              <Button size="md" onClick={hatch} disabled={hatching}>
                {hatching ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Hatching...
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    Hatch pet (download bundle)
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs font-mono text-red-400">{error}</p>
        </div>
      )}

      <p className="text-[10px] font-mono text-text-muted">
        v1 stamps a single frame across each row&apos;s used cells, producing a
        Codex-loadable static pet. Animated per-row cycles arrive in a later
        phase. See the <Link href="/" className="text-accent-amber hover:underline">main app</Link> for finer controls.
      </p>
    </div>
  );
}

function deriveCodexPetSteps(args: {
  description: string;
  petName: string;
  progress: StateProgress[];
  allDone: boolean;
  hatching: boolean;
  hatched: boolean;
}): HatchStep[] {
  const { description, petName, progress, allDone, hatching, hatched } = args;
  const display =
    petName.trim() ||
    description.trim().split(/\s+/).slice(0, 2).join(' ') ||
    'your pet';

  const idle = progress.find((p) => p.state === 'idle');
  const idleStatus = idle?.status;
  const idleDone = idleStatus === 'done';
  const others = progress.filter((p) => p.state !== 'idle');
  const othersTotal = others.length;
  const othersDone = others.filter((p) => p.status === 'done').length;
  const othersFailed = others.filter((p) => p.status === 'error').length;
  const othersAllDone = othersTotal > 0 && othersDone === othersTotal;
  const othersRemaining = others.some(
    (p) => p.status === 'pending' || p.status === 'running',
  );

  // Step 3: only flips to "failed" once every other state has been attempted
  // (no pending or running left) and at least one ended in error.
  let posesStatus: HatchStepStatus;
  if (!idleDone) posesStatus = 'pending';
  else if (othersAllDone) posesStatus = 'done';
  else if (othersRemaining) posesStatus = 'active';
  else posesStatus = 'failed';

  return [
    {
      title: `Get ${display} ready`,
      description: 'Confirm the pet description and start the run.',
      status: !description.trim()
        ? 'pending'
        : progress.length === 0
        ? 'active'
        : 'done',
    },
    {
      title: `Imagine ${display}'s main look`,
      description:
        'Generate the idle base sprite — anchors identity for the other 8 states.',
      status:
        progress.length === 0
          ? 'pending'
          : idleStatus === 'running'
          ? 'active'
          : idleStatus === 'error'
          ? 'failed'
          : idleDone
          ? 'done'
          : 'pending',
      error: idleStatus === 'error' ? idle?.error : undefined,
    },
    {
      title: `Picture ${display}'s poses`,
      description:
        'Generate the 8 remaining Codex states with the idle frame as a reference.',
      status: posesStatus,
      detail:
        posesStatus === 'active'
          ? `${othersDone} of ${othersTotal} done${
              othersFailed > 0 ? `, ${othersFailed} failed` : ''
            }`
          : undefined,
      error:
        posesStatus === 'failed'
          ? `${othersFailed} of ${othersTotal} states failed — re-run to retry`
          : undefined,
    },
    {
      title: `Hatch ${display}`,
      description:
        'Compose the 1536×1872 atlas, encode lossless WebP, and download the bundle.',
      status: !allDone
        ? 'pending'
        : hatched
        ? 'done'
        : hatching
        ? 'active'
        : 'active',
      detail: !allDone
        ? undefined
        : hatched
        ? undefined
        : hatching
        ? 'building bundle…'
        : 'ready — click Hatch',
    },
  ];
}

function codexInstallReadme(slug: string, displayName: string, description: string): string {
  return [
    `# ${displayName}`,
    '',
    description,
    '',
    '## Install',
    '',
    'Copy this folder into your Codex pets directory:',
    '',
    '```bash',
    `mkdir -p "$HOME/.codex/pets/${slug}"`,
    `cp pet.json spritesheet.webp "$HOME/.codex/pets/${slug}/"`,
    '```',
    '',
    'Then select the pet in the Codex CLI.',
    '',
    '## Generated by',
    '',
    'SpriteBrew Codex Pet Hatchery — v1 stamps a single frame across each',
    'row\'s used cells, so the pet appears static in the Codex CLI. Replace',
    'the spritesheet with an animated atlas to add motion.',
    '',
  ].join('\n');
}
