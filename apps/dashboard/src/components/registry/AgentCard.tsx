import type {
  AgentIdentity,
  AgentRegistrationFile,
} from "@open-agents-toolkit/agent/types";

interface AgentCardProps {
  agent: AgentIdentity & { metadata: AgentRegistrationFile };
}

export default function AgentCard({ agent }: AgentCardProps) {
  const ensDomain =
    agent.metadata.services?.find((service) => service.name === "ENS")
      ?.endpoint ?? agent.metadata.name;

  return (
    <a
      href={`/agents/${agent.agentId.toString()}`}
      className="block p-5 rounded-xl border border-gray-800 bg-gray-900 hover:border-violet-600 transition-colors space-y-3"
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-white truncate max-w-[200px]">
            {ensDomain}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[200px]">
            {agent.metadata.name} #{agent.agentId.toString()}
          </p>
        </div>
        {agent.metadata.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agent.metadata.image}
            alt={agent.metadata.name}
            className="w-10 h-10 rounded-lg object-cover border border-gray-700"
          />
        )}
      </div>

      <p className="text-sm text-gray-400 line-clamp-2">
        {agent.metadata.description}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {(agent.metadata.services ?? []).slice(0, 3).map((service) => (
          <span
            key={`${service.name}:${service.endpoint}`}
            className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700"
          >
            {service.name}
          </span>
        ))}
        {(agent.metadata.services?.length ?? 0) === 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700">
            No services
          </span>
        )}
      </div>

      <div className="pt-2 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
        <span className="font-mono truncate max-w-[140px]">
          {agent.owner.slice(0, 6)}...{agent.owner.slice(-4)}
        </span>
        <span className="text-violet-400 font-medium">View &amp; Manage →</span>
      </div>
    </a>
  );
}
