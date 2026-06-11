"use client";

import { useEffect, useRef, useState } from "react";
import CopyButton from "./CopyButton";

const TEASER_LINES = [
  "npm run deploy:arbitrumSepolia --workspace=contracts",
  "npm run setup-env --workspace=contracts",
  "npm run oracle:image",
  "npm run oracle:deploy -- src/examples/prediction-market.ts",
  "",
  "const prepared = await prepareMint(config, {",
  '    name: "Prediction Agent",',
  '    services: [{ name: "teeOracle", endpoint: oracleUrl }],',
  '    privateEntries: [{ name: "skill", data: systemPrompt }],',
  "});",
  "await walletClient.writeContract({",
  "    address: prepared.contractAddress,",
  '    functionName: "mint",',
  "    args: [ownerAddress, prepared.publicMetadataUri,",
  "      prepared.agentMetadataUri, prepared.intelligentData],",
  "});",
] as const;

const TEASER_COPY = TEASER_LINES.join("\n");

export default function DeployCodeTeaser() {
  const rootRef = useRef<HTMLElement | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [activeLine, setActiveLine] = useState(0);
  const [activeChars, setActiveChars] = useState(0);
  const isDone = activeLine >= TEASER_LINES.length;

  useEffect(() => {
    const node = rootRef.current;
    if (!node || hasStarted) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setHasStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasStarted]);

  useEffect(() => {
    if (!hasStarted || isDone) return;

    const line = TEASER_LINES[activeLine] ?? "";

    if (activeChars < line.length) {
      const timeout = window.setTimeout(() => {
        setActiveChars((count) => count + 1);
      }, 14);
      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(() => {
      setActiveLine((lineIndex) => lineIndex + 1);
      setActiveChars(0);
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [activeChars, activeLine, hasStarted, isDone]);

  return (
    <section ref={rootRef} className="min-w-0">
      <div className="glass-card min-w-0 overflow-hidden rounded-xl p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">
            Deploy The Oracle - Mint an Agent
          </h2>
          <a
            href="/docs"
            className="inline-flex items-center justify-center rounded-lg border border-cyan-800/70 bg-cyan-950/30 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-500/80 hover:bg-cyan-950/45"
          >
            Full Docs
          </a>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#050712] shadow-[inset_0_1px_0_rgba(148,163,184,0.08)]">
          <div className="flex items-center gap-1.5 border-b border-slate-800 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-red-400/80" />
            <span className="h-2 w-2 rounded-full bg-yellow-300/80" />
            <span className="h-2 w-2 rounded-full bg-cyan-400/80" />
            <span className="ml-2 font-mono text-[10px] text-cyan-500/80">
              ⌁
            </span>
            <span className="truncate font-mono text-[10px] text-slate-600">
              tee-agent deploy · copy-ready
            </span>
            <span className="ml-auto">
              <CopyButton value={TEASER_COPY} />
            </span>
          </div>
          <pre className="min-h-72 overflow-hidden whitespace-pre-wrap p-3 text-[11px] leading-6 text-slate-300 md:text-xs">
            {TEASER_LINES.map((line, index) => {
              const isActive = hasStarted && index === activeLine;
              const isBlank = line === "";
              const visibleText =
                index < activeLine
                  ? line
                  : isActive
                    ? line.slice(0, activeChars)
                    : "";

              return (
                <span
                  key={`${index}-${line}`}
                  className="grid min-h-6 min-w-0 grid-cols-[0.9rem_minmax(0,1fr)] whitespace-nowrap"
                >
                  <span className={isActive && !isBlank ? "text-cyan-300" : ""}>
                    {isActive && !isBlank ? ">" : ""}
                  </span>
                  <span className="min-w-0">
                    <code
                      aria-label={line || "blank line"}
                      className={`whitespace-pre ${index > 4 ? "text-slate-400" : ""}`}
                    >
                      {visibleText}
                    </code>
                    {isActive ? <span className="deploy-caret-inline" /> : null}
                  </span>
                </span>
              );
            })}
          </pre>
        </div>
      </div>
    </section>
  );
}
