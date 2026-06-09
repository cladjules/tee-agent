"use client";

import { getNetworkConfigByChainId } from "@tee-agent/agent/network";
import type {
  CachedAgentIndexRow,
  CachedAgentsByChainId,
} from "@/lib/agent-cache";
import { useWallet } from "@/providers/WalletProvider";
import AgentCard from "./AgentCard";

export default function AgentListClient({
  agentsByChainId,
}: {
  agentsByChainId: CachedAgentsByChainId;
}) {
  const { chainId } = useWallet();
  const selectedChainId = chainId ?? Number(Object.keys(agentsByChainId)[0]);
  const selectedAgents: CachedAgentIndexRow[] =
    agentsByChainId[selectedChainId] ?? [];
  const network = selectedChainId
    ? getNetworkConfigByChainId(selectedChainId)
    : undefined;

  if (selectedAgents.length === 0) {
    return (
      <div className="glass-card text-center py-16 rounded-xl space-y-3">
        <div className="text-4xl text-violet-800">◈</div>
        <p className="text-slate-400 font-medium">
          No agents registered{network ? ` on ${network.label}` : ""} yet.
        </p>
        <p className="text-sm text-slate-600">
          Deploy your first agent to get started.
        </p>
        <a
          href="/agents/new"
          className="btn-primary inline-block mt-2 px-5 py-2.5 rounded-lg text-sm"
        >
          Deploy Agent →
        </a>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {selectedAgents.map((agent) => (
        <AgentCard key={`${agent.chainId}:${agent.tokenId}`} agent={agent} />
      ))}
    </div>
  );
}
