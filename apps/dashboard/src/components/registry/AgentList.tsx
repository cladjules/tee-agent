import { getRegisteredAgents } from "@/lib/actions/registry";
import AgentCard from "./AgentCard";

export default async function AgentList() {
  const agents = await getRegisteredAgents();

  if (agents.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-gray-700 rounded-xl text-gray-500">
        No agents registered yet. Be the first!
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
