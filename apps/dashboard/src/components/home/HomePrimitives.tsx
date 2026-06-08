import type { ReactNode } from "react";

export function ProcessTag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-slate-700/70 bg-slate-950/60 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
      {children}
    </span>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="block w-full max-w-full overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-[11px] leading-5 text-slate-300">
      <code>{code}</code>
    </pre>
  );
}
