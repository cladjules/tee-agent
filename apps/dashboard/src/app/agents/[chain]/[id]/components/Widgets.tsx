"use client";

import { useState, type ReactNode } from "react";

export function ProcessActionStep({
  step,
  title,
  accessLabel,
  status,
  children,
}: {
  step: string;
  title: string;
  accessLabel: string;
  status: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40 overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900/40">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
            Step {step}
          </p>
          <h3 className="text-sm font-semibold text-gray-100 mt-0.5">
            {title}
          </h3>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
          <span className="text-[10px] font-mono rounded border border-gray-700 bg-gray-950 px-1.5 py-0.5 text-gray-500">
            {accessLabel}
          </span>
          <span className="text-[10px] font-mono rounded border border-gray-700 bg-gray-950 px-1.5 py-0.5 text-gray-500">
            {status}
          </span>
        </div>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

export function CollapsibleSection({
  title,
  description,
  className,
  comingSoon,
  defaultOpen,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  comingSoon?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div
      className={`rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => !comingSoon && setOpen((v) => !v)}
        disabled={comingSoon}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-800/40 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            {title}
            {comingSoon && (
              <span className="text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                Coming soon
              </span>
            )}
          </h3>
          <p className="text-gray-500 text-xs mt-0.5">{description}</p>
        </div>
        <span className="text-gray-500 ml-4 flex-shrink-0 text-xs">
          {!comingSoon && (open ? "▲" : "▼")}
        </span>
      </button>
      {open && !comingSoon && (
        <div className="pt-4 px-5 pb-5 pt-1 border-t border-gray-800 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}
