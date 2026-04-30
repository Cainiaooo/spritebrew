'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { PARTS, type Outfit, type PartCategory } from '@/lib/parts/catalog';

const CATEGORY_LABEL: Record<PartCategory, string> = {
  eyes: 'Eyes',
  heads: 'Hat / Head',
  body: 'Body',
  top: 'Top',
};

const CATEGORY_ORDER: PartCategory[] = ['eyes', 'heads', 'body', 'top'];

interface OutfitPickerProps {
  value: Outfit;
  onChange: (outfit: Outfit) => void;
}

export default function OutfitPicker({ value, onChange }: OutfitPickerProps) {
  const [open, setOpen] = useState(false);

  const setPart = (cat: PartCategory, name: string | undefined) => {
    const next: Outfit = { ...value };
    if (name) next[cat] = name;
    else delete next[cat];
    onChange(next);
  };

  const summary = CATEGORY_ORDER.flatMap((cat) =>
    value[cat] ? [`${CATEGORY_LABEL[cat]}: ${value[cat]}`] : [],
  ).join(' · ') || 'None';

  return (
    <div className="rounded-lg border border-border-default bg-bg-surface">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 cursor-pointer
          hover:bg-bg-elevated transition-colors"
      >
        <div className="text-left">
          <p className="text-xs font-mono text-text-secondary uppercase tracking-wider">
            Outfit (optional)
          </p>
          <p className="text-[10px] font-mono text-text-muted mt-0.5 truncate">{summary}</p>
        </div>
        <ChevronDown
          size={14}
          className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border-subtle pt-3">
          {CATEGORY_ORDER.map((cat) => (
            <div key={cat}>
              <label className="block text-[10px] font-mono text-text-muted mb-1">
                {CATEGORY_LABEL[cat]}
              </label>
              <select
                value={value[cat] ?? ''}
                onChange={(e) => setPart(cat, e.target.value || undefined)}
                className="w-full rounded bg-bg-elevated border border-border-default px-3 py-1.5
                  text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
              >
                <option value="">— None —</option>
                {PARTS[cat].map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {Object.keys(value).length > 0 && (
            <button
              type="button"
              onClick={() => onChange({})}
              className="w-full rounded border border-border-subtle text-[10px] font-mono
                text-text-muted py-1 hover:bg-bg-elevated cursor-pointer"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
