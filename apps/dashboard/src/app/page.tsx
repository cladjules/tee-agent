import { Suspense } from "react";
import AgentList from "@/components/registry/AgentList";
import ContractAddresses from "@/components/ContractAddresses";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    badge: "ERC-721",
    title: "On-Chain Identity",
    body: "Each agent is an NFT on Base. Token ID is the sole identity — no ENS dependency.",
  },
  {
    badge: "ERC-7857 · TEE",
    title: "Private Encrypted Data",
    body: "System prompts and keys are AES-256-GCM encrypted. A Phala Cloud TDX oracle re-encrypts on transfer — plaintext never leaves the enclave.",
  },
  {
    badge: "ERC-8004",
    title: "Reputation & Registry",
    body: "On-chain feedback scores and service endpoints (MCP, A2A, HTTP) travel with the NFT across transfers.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <div className="space-y-4 pt-4">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent leading-tight">
          Open Agents Toolkit
        </h1>
        <p className="text-base text-gray-400 max-w-xl leading-relaxed">
          Deploy AI agents as sovereign on-chain entities on Base — ERC-721 NFTs
          with private encrypted data (ERC-7857), on-chain reputation, and a
          Phala Cloud TEE oracle for secure ownership transfers.
        </p>
        <a
          href="/agents/new"
          className="inline-block px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors text-sm"
        >
          Create Agent
        </a>
      </div>

      {/* Feature strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="p-4 rounded-xl border border-gray-800 bg-gray-900/50 space-y-2"
          >
            <span className="text-xs font-mono text-gray-500">{f.badge}</span>
            <h3 className="text-sm font-semibold text-gray-100">{f.title}</h3>
            <p className="text-xs text-gray-400 leading-relaxed">{f.body}</p>
          </div>
        ))}
      </div>

      {/* Deployed Contracts */}
      <ContractAddresses />

      {/* Registered Agents */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Registered Agents</h2>
        <Suspense
          fallback={
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-40 rounded-xl bg-gray-800/50 animate-pulse"
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
