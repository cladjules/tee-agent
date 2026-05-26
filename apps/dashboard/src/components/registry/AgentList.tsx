import { getRegisteredAgents } from "@/lib/actions/registry";
import AgentCard from "./AgentCard";

export default async function AgentList() {
  const agents = await getRegisteredAgents();

  if (agents.length === 0) {
    return (
      <div className="glass-card text-center py-16 rounded-xl space-y-3">
        <div className="text-4xl text-violet-800">◈</div>
        <p className="text-slate-400 font-medium">No agents registered yet.</p>
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {agents.map((agent) => (
        <AgentCard key={agent.agentId.toString()} agent={agent} />
      ))}
    </div>
  );
}
