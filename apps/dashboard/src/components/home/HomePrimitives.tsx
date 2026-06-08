import type { ReactNode } from "react";
import CopyButton from "./CopyButton";

export function ProcessTag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-slate-700/70 bg-slate-950/60 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
      {children}
    </span>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/80">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2">
        <span className="font-mono text-[10px] text-slate-600">
          copy-ready snippet
        </span>
        <CopyButton value={code} />
      </div>
      <pre className="block w-full max-w-full overflow-x-auto p-3 text-[11px] leading-5 text-slate-300">
        <code>{code}</code>
      </pre>
    </div>
  );
}
