import type { CachedAgentIndexRow } from "@/lib/agent-cache";
import { NETWORK_CONFIG } from "@tee-agent/agent/network";

interface AgentCardProps {
  agent: CachedAgentIndexRow;
}

export default function AgentCard({ agent }: AgentCardProps) {
  const networkKey =
    Object.entries(NETWORK_CONFIG).find(
      ([, network]) => network.chain.id === agent.chainId,
    )?.[0] ?? "arbitrumSepolia";

  return (
    <a
      href={`/agents/${networkKey}/${agent.tokenId}`}
      className="group block rounded-xl glass-card overflow-hidden"
    >
      {agent.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={agent.imageUrl}
          alt={agent.name}
          className="h-28 w-full object-cover border-b border-violet-950/40"
        />
      ) : (
        <div className="flex h-28 w-full items-center justify-center border-b border-violet-950/40 bg-violet-950/20">
          <span className="text-3xl text-violet-800">◈</span>
        </div>
      )}

      <div className="space-y-3 p-3.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-100 transition-colors group-hover:text-violet-300">
            {agent.name}
          </h3>
          <p className="mt-0.5 text-xs font-mono text-slate-600">
            AgentRegistry #{agent.tokenId}
          </p>
        </div>

        <div className="border-t border-violet-950/40 pt-2 text-right text-xs">
          <span className="font-medium text-violet-500 transition-colors group-hover:text-violet-300">
            View &amp; Manage →
          </span>
        </div>
      </div>
    </a>
  );
}
