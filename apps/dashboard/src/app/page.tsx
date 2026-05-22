import { Suspense } from "react";
import AgentList from "@/components/registry/AgentList";

export const dynamic = "force-dynamic";

const PILLARS = [
  {
    badge: "ERC-721 · EIP-712 · ENS",
    title: "On-Chain Agent Identity",
    color: "violet",
    description:
      "Every agent is minted as an ERC-721 NFT and permanently tied to an ENS domain. Ownership is registered with an EIP-712 typed-data proof. Transfer the ENS name and ownership mirrors automatically across chains — making your .eth domain the single source of truth for your agent.",
    bullets: [
      "Human-readable .eth domain attached to every agent",
      "EIP-712 signed proof links agent wallet on-chain",
      "Cross-chain ownership mirror via KeeperHub",
    ],
  },
  {
    badge: "ERC-7857 · TEE · AES-256-GCM",
    title: "Private Intelligent Data",
    color: "pink",
    description:
      "Store private system prompts, agent definitions, API keys, and knowledge bases as Intelligent Data (ERC-7857). All files are AES-256-GCM encrypted before upload to 0G Storage. A TEE Oracle (Intel TDX) manages key handoff — only you, or wallets you explicitly approve, can decrypt.",
    bullets: [
      "Approve other wallets to use your agent's private data",
      "Transfer the NFT — TEE re-encrypts data for the new owner",
      "Content hashes anchored on-chain, no plaintext ever leaves the TEE",
    ],
  },
  {
    badge: "ERC-8004 · MCP · A2A",
    title: "Reputation & Services",
    color: "cyan",
    description:
      "Agents earn a tamper-proof reputation through on-chain feedback scored by other agents and clients (ERC-8004). Define service endpoints — MCP, A2A, web, DID, email — discoverable by any agent or client on the network. Reputation and services travel with the NFT.",
    bullets: [
      "On-chain scores with Sybil-resistant client filtering",
      "Publish MCP, A2A, and custom protocol endpoints",
      "Reputation persists across ownership transfers",
    ],
  },
  {
    badge: "0G Storage · Encrypted",
    title: "Decentralized Encrypted Storage",
    color: "emerald",
    description:
      "Every file — public metadata, encrypted payloads, and service definitions — is stored on 0G Storage. Nothing is stored on centralized servers. Public metadata is referenced via zerog:// URIs; private data is encrypted before leaving your browser.",
    bullets: [
      "Decentralized storage with zerog:// URI scheme",
      "Public metadata (name, image, services) stored as JSON",
      "Private data encrypted client-side before any upload",
    ],
  },
];

const colorMap: Record<
  string,
  { badge: string; heading: string; bullet: string; border: string }
> = {
  violet: {
    badge: "bg-violet-950 text-violet-300 border-violet-800",
    heading: "text-violet-400",
    bullet: "text-violet-400",
    border: "border-violet-900/60",
  },
  pink: {
    badge: "bg-pink-950 text-pink-300 border-pink-800",
    heading: "text-pink-400",
    bullet: "text-pink-400",
    border: "border-pink-900/60",
  },
  cyan: {
    badge: "bg-cyan-950 text-cyan-300 border-cyan-800",
    heading: "text-cyan-400",
    bullet: "text-cyan-400",
    border: "border-cyan-900/60",
  },
  emerald: {
    badge: "bg-emerald-950 text-emerald-300 border-emerald-800",
    heading: "text-emerald-400",
    bullet: "text-emerald-400",
    border: "border-emerald-900/60",
  },
};

export default function HomePage() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <div className="space-y-5 pt-4">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent leading-tight">
          Open Agents Toolkit
        </h1>
        <p className="text-xl text-gray-300 max-w-2xl leading-relaxed">
          Deploy AI agents as sovereign on-chain entities — with a permanent ENS
          identity, private encrypted data managed by a TEE oracle, and
          verifiable reputation scored by other agents.
        </p>
        <a
          href="/agents/new"
          className="inline-block px-6 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors text-sm"
        >
          Create Your Agent
        </a>
      </div>

      {/* Four Pillars */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-gray-100">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {PILLARS.map((pillar) => {
            const c = colorMap[pillar.color];
            return (
              <div
                key={pillar.title}
                className={`p-6 rounded-xl border bg-gray-900/50 space-y-4 ${c.border}`}
              >
                <div className="space-y-2">
                  <span
                    className={`inline-block text-xs font-mono px-2 py-0.5 rounded-full border ${c.badge}`}
                  >
                    {pillar.badge}
                  </span>
                  <h3 className={`text-lg font-semibold ${c.heading}`}>
                    {pillar.title}
                  </h3>
                  <p className="text-sm text-gray-400 leading-relaxed">
                    {pillar.description}
                  </p>
                </div>
                <ul className="space-y-1.5">
                  {pillar.bullets.map((b) => (
                    <li key={b} className="flex gap-2 text-sm text-gray-300">
                      <span className={`mt-0.5 shrink-0 ${c.bullet}`}>→</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Registered Agents */}
      <div className="space-y-4">
        <div>
          <h2 className="text-3xl font-bold">Registered Agents</h2>
          <p className="text-gray-400 mt-1">
            Browse all agents on the network and interact with them.
          </p>
        </div>
        <Suspense
          fallback={
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-48 rounded-xl bg-gray-800/50 animate-pulse"
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
