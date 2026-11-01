import React from 'react';
import { Zap } from 'lucide-react';

export const ConnectionBanner = ({ connected }: { connected: boolean }) => (
  <div
    className={`px-4 py-2 flex items-center justify-between text-xs font-medium transition-colors duration-500 ${
      connected
        ? 'bg-emerald-500/10 text-emerald-400 border-b border-emerald-500/20'
        : 'bg-rose-500/10 text-rose-400 border-b border-rose-500/20'
    }`}
  >
    <span className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
      {connected ? 'Engine Active' : 'Engine Offline'}
    </span>
    {!connected && <span className="text-rose-300/70 font-mono uppercase text-[10px]">Run `bun run api`</span>}
  </div>
);

export const Header = ({ connected: _connected }: { connected: boolean }) => (
  <header className="flex items-center px-5 py-4 border-b border-(--border-subtle) bg-(--bg-primary)/80 backdrop-blur-md sticky top-0 z-20">
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-xl shadow-blue-500/30 ring-1 ring-white/10 transition-all">
        <Zap className="w-6 h-6 text-white" />
      </div>
      <div className="flex flex-col">
        <h1 className="text-lg font-extrabold tracking-tighter text-(--text-primary) leading-none mb-1">Autoply</h1>
        <p className="text-[10px] font-medium text-(--text-tertiary) uppercase tracking-widest opacity-70">Application OS</p>
      </div>
    </div>
  </header>
);
