import type {
  AgentIdentity,
  AgentRegistrationFile,
} from "@tee-agent/agent/types";

interface AgentCardProps {
  agent: AgentIdentity & { metadata: AgentRegistrationFile };
}

export default function AgentCard({ agent }: AgentCardProps) {
  return (
    <a
      href={`/agents/${agent.agentId.toString()}`}
      className="group block p-5 rounded-xl glass-card space-y-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-100 truncate max-w-[180px] group-hover:text-violet-300 transition-colors">
            {agent.metadata.name}
          </h3>
          <p className="text-xs font-mono text-slate-600 mt-0.5">
            #{agent.agentId.toString()}
          </p>
        </div>
        {agent.metadata.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agent.metadata.image}
            alt={agent.metadata.name}
            className="w-11 h-11 rounded-lg object-cover border border-violet-900/50 flex-shrink-0"
          />
        ) : (
          <div className="w-11 h-11 rounded-lg border border-violet-900/30 bg-violet-950/30 flex items-center justify-center flex-shrink-0">
            <span className="text-lg text-violet-700">◈</span>
          </div>
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-slate-400 line-clamp-2 leading-relaxed">
        {agent.metadata.description}
      </p>

      {/* Services */}
      <div className="flex flex-wrap gap-1.5">
        {(agent.metadata.services ?? []).slice(0, 3).map((service) => (
          <span
            key={`${service.name}:${service.endpoint}`}
            className="text-xs px-2 py-0.5 rounded-md bg-violet-950/40 text-violet-400 border border-violet-900/40 font-mono"
          >
            {service.name}
          </span>
        ))}
        {(agent.metadata.services?.length ?? 0) === 0 && (
          <span className="text-xs px-2 py-0.5 rounded-md bg-slate-900/50 text-slate-600 border border-slate-800/50 font-mono">
            no services
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="pt-3 border-t border-violet-950/40 flex items-center justify-between text-xs">
        <span className="font-mono text-slate-600">
          {agent.owner.slice(0, 6)}…{agent.owner.slice(-4)}
        </span>
        <span className="text-violet-500 group-hover:text-violet-300 font-medium transition-colors">
          View &amp; Manage →
        </span>
      </div>
    </a>
  );
}
