"use client";

import { useState } from "react";

export default function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="rounded border border-slate-700/80 bg-slate-950/80 px-2 py-1 text-[10px] font-mono text-slate-400 transition hover:border-cyan-700/80 hover:text-cyan-200"
      aria-label={label}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
