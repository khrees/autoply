import React from 'react';
import { Zap } from 'lucide-react';

export const ConnectionBanner = ({ connected }: { connected: boolean }) => (
  <div
    className={`px-4 py-2 flex items-center justify-between text-xs font-medium ${
      connected
        ? 'bg-emerald-500/10 text-emerald-400 border-b border-emerald-500/20'
        : 'bg-rose-500/10 text-rose-400 border-b border-rose-500/20'
    }`}
  >
    <span className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
      {connected ? 'Engine Ready' : 'Engine Offline'}
    </span>
    {!connected && <span className="text-rose-300/70">Run `bun run api`</span>}
  </div>
);

export const Header = ({ connected: _connected }: { connected: boolean }) => (
  <header className="flex items-center px-5 py-4 border-b border-(--border-subtle)">
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
        <Zap className="w-5 h-5 text-white" />
      </div>
      <div>
        <h1 className="text-base font-bold tracking-tight text-(--text-primary)">Autoply</h1>
        <p className="text-[0.6875rem] text-(--text-tertiary)">Job Application Automator</p>
      </div>
    </div>
  </header>
);
