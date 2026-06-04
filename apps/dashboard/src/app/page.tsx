import { Suspense } from "react";
import AgentList from "@/components/registry/AgentList";
import ContractAddresses from "@/components/ContractAddresses";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    badge: "ERC-721",
    title: "On-Chain Identity",
    body: "Each agent is an NFT on Base. Token ID is the sole on-chain identity.",
  },
  {
    badge: "ERC-7857 · TEE",
    title: "Private Encrypted Data",
    body: "System prompts and keys are AES-256-GCM encrypted. A Phala Cloud TDX oracle re-wraps keys on transfer - plaintext never leaves the enclave.",
  },
  {
    badge: "ERC-8004",
    title: "Reputation & Registry",
    body: "On-chain feedback scores and service endpoints (MCP, A2A, HTTP) travel with the NFT across transfers.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <div className="relative pt-8 pb-4">
        <div className="absolute -left-10 top-0 w-[500px] h-[350px] bg-violet-900/10 blur-[100px] rounded-full pointer-events-none" />
        <div className="relative space-y-6 max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-mono text-violet-400 bg-violet-950/50 border border-violet-800/40 px-3 py-1 rounded-full">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
              Live on Base Sepolia
            </span>
          </div>
          <h1 className="text-6xl md:text-7xl font-bold tracking-tight leading-[1.05]">
            <span className="gradient-text-animated">Tee</span>{" "}
            <span className="text-slate-200">Agent</span>
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed max-w-xl">
            Deploy AI agents as sovereign on-chain entities — ERC-7857 +
            ERC-8004 with private encrypted data, on-chain reputation scoring,
            and Phala Cloud TEE-secured proof generation.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <a
              href="/agents/new"
              className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm"
            >
              Deploy Agent →
            </a>
            <a
              href="https://github.com/cladjules/tee-agent"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-slate-700 hover:border-violet-700 hover:bg-violet-950/30 text-slate-300 hover:text-white font-semibold transition-all text-sm"
            >
              View Source ↗
            </a>
          </div>
        </div>
      </div>

      {/* Deployed Contracts */}
      <ContractAddresses />

      {/* Feature strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="glass-card p-5 rounded-xl space-y-3">
            <span className="text-xs font-mono text-violet-400 bg-violet-950/50 border border-violet-800/30 px-2.5 py-0.5 rounded-md inline-block">
              {f.badge}
            </span>
            <h3 className="text-sm font-semibold text-slate-100">{f.title}</h3>
            <p className="text-xs text-slate-500 leading-relaxed">{f.body}</p>
          </div>
        ))}
      </div>

      {/* Registered Agents */}
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-100">
            Registered Agents
          </h2>
          <a
            href="/agents/new"
            className="text-xs text-violet-400 hover:text-violet-300 transition-colors font-medium"
          >
            + Deploy new →
          </a>
        </div>
        <Suspense
          fallback={
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-44 rounded-xl bg-violet-950/10 border border-violet-950/30 animate-pulse"
                />
              ))}
            </div>
          }
        >
          <AgentList />
        </Suspense>
      </div>
    </div>
  );
}
