'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  UploadCloud,
  PlayCircle,
  Download,
  Sparkles,
  Images,
  MessageCircle,
  Bot,
  X,
} from 'lucide-react';
import Badge from '@/components/ui/Badge';
import { FEEDBACK_URL, BETA_TOOLTIP } from '@/lib/externalLinks';

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home, soon: false },
  { href: '/upload', label: 'Upload', icon: UploadCloud, soon: false },
  { href: '/preview', label: 'Preview', icon: PlayCircle, soon: false },
  { href: '/export', label: 'Export', icon: Download, soon: false },
  { href: '/gallery', label: 'Gallery', icon: Images, soon: false },
  { href: '/generate', label: 'Generate', icon: Sparkles, soon: false },
  { href: '/agent-hydration', label: 'Agent Pack', icon: Bot, soon: false },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 flex h-full w-[var(--sidebar-width)] flex-col
          border-r border-border-default bg-bg-secondary
          transition-transform duration-200 ease-in-out
          lg:translate-x-0
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex items-center justify-between px-5 py-5 border-b border-border-subtle">
          <Link href="/" className="flex items-center gap-3" onClick={onClose}>
            <BrewIcon />
            <span className="font-display text-[11px] text-accent-amber leading-tight tracking-wide">
              Sprite<br />Brew
            </span>
          </Link>
          <a
            href={FEEDBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={BETA_TOOLTIP}
            className="text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded
              bg-accent-amber text-bg-primary hover:bg-accent-amber/80 transition-colors
              cursor-pointer select-none"
          >
            BETA
          </a>
          <button
            onClick={onClose}
            className="lg:hidden p-1 text-text-muted hover:text-text-primary cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon, soon }) => {
            const active = pathname === href;
            const className = `
                  flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-mono
                  transition-all duration-150 group
                  ${active
                    ? 'bg-accent-amber-glow text-accent-amber text-glow-amber'
                    : soon
                      ? 'text-text-muted cursor-default'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                  }
                `;
            return (
              <Link
                key={href}
                href={soon ? '#' : href}
                onClick={soon ? (e) => e.preventDefault() : onClose}
                className={className}
              >
                <Icon
                  size={18}
                  className={active ? 'text-accent-amber' : soon ? 'text-text-muted' : 'text-text-muted group-hover:text-text-secondary'}
                />
                <span className="flex-1">{label}</span>
                {soon && <Badge variant="muted">Soon</Badge>}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-2">
          <a
            href={FEEDBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-mono
              text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all duration-150 group"
          >
            <MessageCircle
              size={18}
              className="text-text-muted group-hover:text-text-secondary"
            />
            <span>Feedback</span>
          </a>
        </div>

        <div className="px-5 py-3 border-t border-border-subtle space-y-1.5">
          <p className="text-[10px] text-text-muted font-mono uppercase tracking-widest">
            SpriteBrew v0.3.0 (local)
          </p>
        </div>
      </aside>
    </>
  );
}

function BrewIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="1" width="4" height="2" fill="#d4871c" />
      <rect x="6" y="0" width="4" height="1" fill="#8B7355" />
      <rect x="4" y="3" width="8" height="2" fill="#d4871c" opacity="0.6" />
      <rect x="3" y="5" width="10" height="8" rx="1" fill="#d4871c" opacity="0.8" />
      <rect x="4" y="7" width="8" height="5" fill="#e8991f" />
      <rect x="6" y="8" width="1" height="1" fill="#fff" opacity="0.6" />
      <rect x="9" y="9" width="1" height="1" fill="#fff" opacity="0.4" />
      <rect x="7" y="10" width="1" height="1" fill="#fff" opacity="0.3" />
      <rect x="4" y="5" width="1" height="6" fill="#fff" opacity="0.1" />
      <rect x="3" y="13" width="10" height="1" fill="#d4871c" />
    </svg>
  );
}
