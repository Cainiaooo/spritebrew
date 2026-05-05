'use client';

// Visible 4-step progress list for batch generation flows.
//
// Mirrors Codex Pet SKILL.md L88-108: each step represents a real
// artifact (description set, base generated, all states generated,
// bundle downloaded). A step only flips to "done" when the artifact is
// actually present — never on intent. "Active" is the single in-flight
// step; "failed" carries the error inline.

import { Check, Loader2, X } from 'lucide-react';

export type HatchStepStatus = 'pending' | 'active' | 'done' | 'failed';

export interface HatchStep {
  title: string;
  description: string;
  status: HatchStepStatus;
  /** Optional sub-status shown only when this step is active. */
  detail?: string;
  /** Optional failure note shown only when status === 'failed'. */
  error?: string;
}

interface Props {
  steps: HatchStep[];
}

export default function HatchChecklist({ steps }: Props) {
  return (
    <div className="rounded-lg border border-border-default bg-bg-surface p-5">
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <StatusIcon status={step.status} index={i} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className={`font-mono text-sm ${
                    step.status === 'active'
                      ? 'text-text-primary'
                      : step.status === 'done'
                      ? 'text-text-secondary'
                      : step.status === 'failed'
                      ? 'text-red-400'
                      : 'text-text-muted'
                  }`}
                >
                  {step.title}
                </span>
                {step.detail && step.status === 'active' && (
                  <span className="text-[10px] font-mono text-accent-amber/80">
                    {step.detail}
                  </span>
                )}
              </div>
              <p
                className={`text-[10px] font-mono ${
                  step.status === 'active' ? 'text-text-secondary' : 'text-text-muted'
                }`}
              >
                {step.description}
              </p>
              {step.error && step.status === 'failed' && (
                <p className="text-[10px] font-mono text-red-400 mt-1 truncate" title={step.error}>
                  {step.error}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StatusIcon({ status, index }: { status: HatchStepStatus; index: number }) {
  const base =
    'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 border';
  if (status === 'done') {
    return (
      <div className={`${base} bg-green-500/15 border-green-400/70`}>
        <Check size={12} className="text-green-400" />
      </div>
    );
  }
  if (status === 'active') {
    return (
      <div className={`${base} bg-accent-amber/15 border-accent-amber`}>
        <Loader2 size={12} className="text-accent-amber animate-spin" />
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className={`${base} bg-red-500/15 border-red-400/70`}>
        <X size={12} className="text-red-400" />
      </div>
    );
  }
  return (
    <div className={`${base} border-border-default`}>
      <span className="text-[10px] font-mono text-text-muted">{index + 1}</span>
    </div>
  );
}
