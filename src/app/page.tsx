'use client';

import Link from 'next/link';
import {
  Sparkles,
  Upload,
  Scan,
  Eraser,
  Pencil,
  Download,
  ArrowRight,
} from 'lucide-react';

const FEATURES = [
  {
    icon: Sparkles,
    title: 'AI Character Generation',
    desc: 'Describe a character in plain text and get a complete sprite sheet. Pluggable image backend (GPT Image 2 / Gemini).',
    span: 'sm:col-span-2',
  },
  {
    icon: Upload,
    title: 'Animate Your Own Art',
    desc: 'Upload existing pixel art and generate walk cycles, attacks, idles. The AI preserves your character\'s look.',
    span: '',
  },
  {
    icon: Scan,
    title: 'Smart Sprite Detection',
    desc: 'Auto-detect characters on any sprite sheet. No grid required.',
    span: '',
  },
  {
    icon: Eraser,
    title: 'Background Removal',
    desc: 'One-click background removal with adjustable tolerance.',
    span: '',
  },
  {
    icon: Pencil,
    title: 'Pixel Editor',
    desc: 'Touch up output pixel by pixel. Pencil, eraser, eyedropper, undo/redo.',
    span: '',
  },
  {
    icon: Download,
    title: '6 Export Formats',
    desc: 'TexturePacker, Aseprite, GameMaker, RPG Maker, Godot SpriteFrames, raw frames.',
    span: 'sm:col-span-2',
  },
] as const;

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e8e0d6] font-mono overflow-x-hidden">
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <BrewLogo />
          <span className="font-display text-[10px] text-[#d4871c] tracking-wide leading-tight">
            Sprite<br />Brew
          </span>
        </Link>
        <Link
          href="/generate"
          className="px-4 py-2 rounded text-xs font-mono font-semibold
            bg-[#d4871c] text-[#0a0a0a] hover:bg-[#e8991f] transition-colors"
        >
          Open App
        </Link>
      </nav>

      <section className="text-center px-6 pt-16 pb-20 max-w-4xl mx-auto">
        <h1 className="font-display text-lg sm:text-2xl md:text-3xl text-[#d4871c] leading-relaxed"
          style={{ textShadow: '0 0 30px rgba(212,135,28,0.3)' }}>
          Pixel-perfect sprite sheets.<br />Locally deployed.
        </h1>
        <p className="mt-6 text-sm sm:text-base text-[#9a918a] max-w-2xl mx-auto leading-relaxed">
          Local fork of SpriteBrew. Describe a character, pick a moveset, and let
          GPT Image 2 or Gemini generate game-ready pixel art. Outputs Godot
          SpriteFrames, Aseprite JSON, and more.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/generate"
            className="px-8 py-3 rounded-lg text-sm font-mono font-bold
              bg-[#d4871c] text-[#0a0a0a] hover:bg-[#e8991f] transition-colors
              shadow-[0_0_20px_rgba(212,135,28,0.3)]"
          >
            Start Creating <ArrowRight size={16} className="inline ml-1" />
          </Link>
        </div>
      </section>

      <section className="px-6 py-16 max-w-5xl mx-auto">
        <h2 className="font-display text-[10px] text-[#9a918a] uppercase tracking-[0.2em] text-center mb-10">
          Everything you need
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc, span }) => (
            <div
              key={title}
              className={`rounded-xl border border-[#1e1b18] bg-[#121010] p-5
                hover:border-[#d4871c]/30 transition-colors group ${span}`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg
                  bg-[#d4871c]/10 group-hover:bg-[#d4871c]/20 transition-colors">
                  <Icon size={18} className="text-[#d4871c]" />
                </div>
                <h3 className="text-sm font-semibold">{title}</h3>
              </div>
              <p className="text-xs text-[#9a918a] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-[#1e1b18] px-6 py-8">
        <div className="max-w-4xl mx-auto text-center text-[10px] text-[#5c5550]">
          <p>SpriteBrew (local fork) · AGPL-3.0 · Upstream: GAlbanese09/spritebrew</p>
        </div>
      </footer>
    </div>
  );
}

function BrewLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ imageRendering: 'pixelated' }}>
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
