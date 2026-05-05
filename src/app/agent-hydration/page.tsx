'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Loader2, Download, AlertCircle, AlertTriangle, Check, RotateCw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import HatchChecklist, {
  type HatchStep,
  type HatchStepStatus,
} from '@/components/sprites/HatchChecklist';
import { downloadAsZip } from '@/lib/downloadUtils';
import { fetchGenerationSSE } from '@/lib/sseClient';
import {
  AGENT_HYDRATION_STATES,
  AGENT_HYDRATION_AGENT_TYPES,
  AGENT_HYDRATION_TEMPLATE,
  STATE_PROMPT_SUFFIX,
  IDENTITY_LOCK_SUFFIX,
  type AgentHydrationAgentType,
  type AgentHydrationState,
} from '@/lib/templates/agentHydration';

const DATA_URI_PREFIX_RE = /^data:image\/[a-z]+;base64,/;

interface QaWarning {
  code: string;
  message: string;
}

interface StateProgress {
  state: AgentHydrationState;
  status: 'pending' | 'running' | 'done' | 'error';
  imageUrl?: string;
  error?: string;
  warnings?: QaWarning[];
}

export default function AgentHydrationPage() {
  const [description, setDescription] = useState('');
  const [agentType, setAgentType] = useState<AgentHydrationAgentType>('claude-code');
  const [running, setRunning] = useState(false);
  const [packing, setPacking] = useState(false);
  const [packed, setPacked] = useState(false);
  const [progress, setProgress] = useState<StateProgress[]>([]);
  const [error, setError] = useState<string | null>(null);

  const startBatch = useCallback(async () => {
    if (!description.trim() || running) return;

    setError(null);
    setRunning(true);
    setPacked(false);

    const initial: StateProgress[] = AGENT_HYDRATION_STATES.map((s) => ({
      state: s,
      status: 'pending',
    }));
    setProgress(initial);

    const tmpl = AGENT_HYDRATION_TEMPLATE;
    const results: StateProgress[] = [...initial];

    // Idle generates first (no reference) and becomes the canonical base for
    // the remaining states. They pass it back as a reference image plus the
    // identity-lock suffix so silhouette/palette/proportions stay coherent.
    let canonicalBaseB64: string | null = null;

    for (let i = 0; i < AGENT_HYDRATION_STATES.length; i++) {
      const state = AGENT_HYDRATION_STATES[i];
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

  const regenerateState = useCallback(
    async (state: AgentHydrationState) => {
      // Idle is the canonical base — regenerating it would invalidate every
      // other state's identity lock. Restart the whole batch instead.
      if (state === 'idle' || running) return;

      const idle = progress.find((p) => p.state === 'idle');
      if (!idle?.imageUrl || idle.status !== 'done') return;
      const baseB64 = idle.imageUrl.replace(DATA_URI_PREFIX_RE, '');

      const idx = progress.findIndex((p) => p.state === state);
      if (idx < 0) return;
      // Block concurrent regens — the network call is fast enough that
      // serializing keeps the UI predictable without a per-card spinner.
      if (progress.some((p) => p.status === 'running')) return;

      setPacked(false);
      setProgress((prev) =>
        prev.map((p, i) =>
          i === idx
            ? { ...p, status: 'running', error: undefined, warnings: undefined }
            : p,
        ),
      );

      const tmpl = AGENT_HYDRATION_TEMPLATE;
      const prompt = [
        tmpl.promptPrefix,
        description.trim(),
        STATE_PROMPT_SUFFIX[state],
        IDENTITY_LOCK_SUFFIX,
      ].join(', ');

      try {
        const data = await fetchGenerationSSE(
          {
            mode: 'create',
            prompt,
            promptStyle: 'character',
            width: tmpl.size,
            height: tmpl.size,
            removeBg: true,
            referenceImages: [baseB64],
          },
          null,
        );

        if (!data.success || !data.imageUrl) {
          throw new Error(String(data.error ?? 'No image returned'));
        }

        const warnings = Array.isArray(data.qaWarnings)
          ? (data.qaWarnings as QaWarning[])
          : undefined;
        setProgress((prev) =>
          prev.map((p, i) =>
            i === idx
              ? {
                  ...p,
                  status: 'done',
                  imageUrl: data.imageUrl,
                  warnings,
                  error: undefined,
                }
              : p,
          ),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        setProgress((prev) =>
          prev.map((p, i) => (i === idx ? { ...p, status: 'error', error: msg } : p)),
        );
      }
    },
    [progress, description, running],
  );

  const downloadZip = useCallback(async () => {
    const completed = progress.filter((p) => p.status === 'done' && p.imageUrl);
    if (completed.length === 0) return;

    const tmpl = AGENT_HYDRATION_TEMPLATE;
    const files: { name: string; data: Blob | string }[] = [];
    const states: Record<string, { sheet: string; json: string; frames: number; fps: number }> = {};

    for (const p of completed) {
      const blob = await dataUrlToBlob(p.imageUrl!);
      const sheetName = `${p.state}.png`;
      const jsonName = `${p.state}.json`;
      files.push({ name: sheetName, data: blob });

      const aseprite = {
        frames: [
          {
            filename: sheetName,
            frame: { x: 0, y: 0, w: tmpl.size, h: tmpl.size },
            duration: Math.round(1000 / tmpl.fps),
            sourceSize: { w: tmpl.size, h: tmpl.size },
            spriteSourceSize: { x: 0, y: 0, w: tmpl.size, h: tmpl.size },
          },
        ],
        meta: {
          app: 'SpriteBrew',
          version: '1.0',
          image: sheetName,
          format: 'RGBA8888',
          size: { w: tmpl.size, h: tmpl.size },
          scale: '1',
          frameTags: [
            { name: p.state, from: 0, to: 0, direction: 'forward' },
          ],
        },
      };

      const jsonStr = JSON.stringify(aseprite, null, 2);
      files.push({ name: jsonName, data: jsonStr });

      states[p.state] = {
        sheet: sheetName,
        json: jsonName,
        frames: tmpl.framesPerState,
        fps: tmpl.fps,
      };
    }

    const manifest = {
      generator: 'SpriteBrew',
      version: '1.0',
      agentType,
      description: description.trim(),
      template: tmpl,
      states,
    };
    files.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });

    const readme = [
      `# SpriteBrew — Agent Hydration Bundle`,
      ``,
      `Agent type: \`${agentType}\``,
      `Source description: ${description.trim()}`,
      ``,
      `## Layout`,
      ``,
      AGENT_HYDRATION_STATES.map(
        (s) => `- \`${s}.png\` — ${tmpl.size}×${tmpl.size}, ${tmpl.framesPerState} frame(s) at ${tmpl.fps}fps`,
      ).join('\n'),
      ``,
      `Drop this folder under \`AgentHydration/src/lib/characters/sprites/${agentType}/\``,
      `and load via the manifest.`,
      ``,
    ].join('\n');
    files.push({ name: 'README.md', data: readme });

    setPacking(true);
    try {
      await downloadAsZip(files, `agent-hydration_${agentType}.zip`);
      setPacked(true);
    } finally {
      setPacking(false);
    }
  }, [progress, agentType, description]);

  const completedCount = progress.filter((p) => p.status === 'done').length;
  const allDone = progress.length > 0 && completedCount === progress.length;

  const checklistSteps = deriveAgentHydrationSteps({
    description,
    agentType,
    progress,
    allDone,
    packing,
    packed,
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-sm text-accent-amber mb-2">Agent Hydration Sprite Pack</h1>
        <p className="text-sm font-mono text-text-secondary">
          Generate a complete 7-state sprite pack for AgentHydration
          (idle / active / thinking / coding / testing / error / done) from
          a single character description. Output is an importable zip.
        </p>
      </div>

      <Card className="p-6 space-y-4">
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

        <div>
          <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
            Agent type
          </label>
          <div className="flex flex-wrap gap-2">
            {AGENT_HYDRATION_AGENT_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setAgentType(t)}
                disabled={running}
                className={`px-3 py-1.5 rounded text-xs font-mono cursor-pointer transition-colors
                  ${agentType === t
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  } disabled:opacity-50`}
              >
                {t}
              </button>
            ))}
          </div>
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
              <>Generate 7-state pack</>
            )}
          </Button>
        </div>
      </Card>

      {description.trim() && (
        <HatchChecklist steps={checklistSteps} />
      )}

      {progress.length > 0 && (
        <div className="rounded-lg border border-border-default bg-bg-surface p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {progress.map((p) => (
              <div
                key={p.state}
                className="rounded-lg border border-border-subtle bg-bg-elevated p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-mono text-text-primary capitalize">
                    {p.state}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {p.status === 'pending' && (
                      <span className="text-[10px] font-mono text-text-muted">queued</span>
                    )}
                    {p.status === 'running' && (
                      <Loader2 size={12} className="animate-spin text-accent-amber" />
                    )}
                    {p.status === 'done' && <Check size={12} className="text-green-400" />}
                    {p.status === 'error' && <AlertCircle size={12} className="text-red-400" />}
                    {p.state !== 'idle'
                      && (p.status === 'done' || p.status === 'error')
                      && !running
                      && progress.find((q) => q.state === 'idle')?.status === 'done'
                      && !progress.some((q) => q.status === 'running') && (
                      <button
                        onClick={() => regenerateState(p.state)}
                        title="Regenerate this state, keeping idle as the canonical base"
                        className="p-0.5 rounded text-text-muted hover:text-accent-amber cursor-pointer transition-colors"
                      >
                        <RotateCw size={11} />
                      </button>
                    )}
                  </div>
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
                      className="w-16 h-16"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                ) : (
                  <div className="h-16 rounded border border-dashed border-border-subtle" />
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
              <Button size="md" onClick={downloadZip} disabled={packing}>
                {packing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Packing...
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    Download zip
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
        v1 generates one frame per state. Animated per-state cycles arrive in a
        later phase. See the <Link href="/" className="text-accent-amber hover:underline">main app</Link> for finer controls.
      </p>
    </div>
  );
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

function deriveAgentHydrationSteps(args: {
  description: string;
  agentType: AgentHydrationAgentType;
  progress: StateProgress[];
  allDone: boolean;
  packing: boolean;
  packed: boolean;
}): HatchStep[] {
  const { description, agentType, progress, allDone, packing, packed } = args;
  const display = description.trim() ? `your ${agentType} agent` : 'your agent';

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

  let posesStatus: HatchStepStatus;
  if (!idleDone) posesStatus = 'pending';
  else if (othersAllDone) posesStatus = 'done';
  else if (othersRemaining) posesStatus = 'active';
  else posesStatus = 'failed';

  return [
    {
      title: `Get ${display} ready`,
      description: 'Confirm description and agent type, then start the run.',
      status: !description.trim()
        ? 'pending'
        : progress.length === 0
        ? 'active'
        : 'done',
    },
    {
      title: `Imagine ${display}'s main look`,
      description:
        'Generate the idle base sprite — anchors identity for the other 6 states.',
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
      title: `Picture ${display}'s states`,
      description:
        'Generate the 6 remaining hydration states with the idle frame as a reference.',
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
      title: `Pack the bundle`,
      description: 'Bundle all 7 sprites + Aseprite JSON + manifest into a zip.',
      status: !allDone
        ? 'pending'
        : packed
        ? 'done'
        : packing
        ? 'active'
        : 'active',
      detail: !allDone
        ? undefined
        : packed
        ? undefined
        : packing
        ? 'building zip…'
        : 'ready — click Download',
    },
  ];
}
