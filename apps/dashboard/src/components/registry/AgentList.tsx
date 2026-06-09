import { getRegisteredAgents } from "@/lib/actions/registry";
import AgentListClient from "./AgentListClient";

export default async function AgentList() {
  const agentsByChainId = await getRegisteredAgents();
  return <AgentListClient agentsByChainId={agentsByChainId} />;
}
