import { Suspense } from "react";
import AgentList from "@/components/registry/AgentList";

export default function RegisteredAgentsSection() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-100">
          Registered Agents
        </h2>
        <a
          href="https://www.teeagent.xyz/agents/new"
          className="text-xs text-violet-400 hover:text-violet-300 transition-colors font-medium"
        >
          + Mint new →
        </a>
      </div>
      <Suspense
        fallback={
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-48 rounded-xl bg-violet-950/10 border border-violet-950/30 animate-pulse"
              />
            ))}
          </div>
        }
      >
        <AgentList />
      </Suspense>
    </div>
  );
}
