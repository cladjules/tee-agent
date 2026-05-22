import { notFound } from "next/navigation";
import {
  getAgent,
  getAgentFeedbackOverview,
  getAgentIntelligentData,
} from "@/lib/actions/registry";
import AgentDetailActions from "./AgentDetailActions";
import OwnerIntelligentDataDecrypt from "./OwnerIntelligentDataDecrypt";
import { useMemo } from "react";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return {
    title: `Agent #${id} — Open Agents Toolkit`,
    description: `View and manage on-chain AI agent #${id}`,
  };
}

export default async function AgentDetailPage({ params }: Props) {
  const { id } = await params;
  const agentId = BigInt(id);
  const [agent, intelligentDataInfo, feedbackOverview] = await Promise.all([
    getAgent(agentId),
    getAgentIntelligentData(agentId),
    getAgentFeedbackOverview(agentId),
  ]);

  if (!agent) notFound();

  const ensDomain = agent?.metadata.services?.find(
    (service) => service.name === "ENS",
  )?.endpoint;

  return (
    <div className="space-y-10 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4">
        {agent.metadata.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agent.metadata.image}
            alt={agent.metadata.name}
            className="w-16 h-16 rounded-xl object-cover border border-gray-700 flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold">
              {ensDomain
                ? `${ensDomain} (${agent.metadata.name})`
                : agent.metadata.name}
            </h1>
            <span className="text-sm font-mono text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
              #{agent.agentId.toString()}
            </span>
          </div>
          <p className="text-gray-400 mt-2">{agent.metadata.description}</p>
        </div>
        <a
          href="/"
          className="flex-shrink-0 px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-sm transition-colors"
        >
          ← All Agents
        </a>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Identity */}
        <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">
            Identity
          </h2>
          <DetailRow
            label="Agent ID"
            value={`#${agent.agentId.toString()}`}
            mono
          />
          <DetailRow label="Owner" value={agent.owner} mono truncate />
          {agent.agentWallet &&
            agent.agentWallet !==
              "0x0000000000000000000000000000000000000000" && (
              <DetailRow
                label="Agent Wallet"
                value={agent.agentWallet}
                mono
                truncate
              />
            )}
          <DetailRow
            label="Metadata URI"
            value={agent.metadataUri}
            mono
            truncate
          />
          {intelligentDataInfo.verifierAddress &&
            intelligentDataInfo.verifierAddress !==
              "0x0000000000000000000000000000000000000000" && (
              <DetailRow
                label="Verifier Address"
                value={intelligentDataInfo.verifierAddress}
                mono
                truncate
              />
            )}
        </section>

        <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">
            Reputation
          </h2>
          <DetailRow
            label="Total Score"
            value={feedbackOverview.totalScore.toFixed(4)}
            mono
          />
          <DetailRow
            label="Active Feedback Count"
            value={String(feedbackOverview.totalCount)}
            mono
          />
        </section>

        <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3 md:col-span-2">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">
            Services
          </h2>
          {(agent.metadata.services?.length ?? 0) > 0 ? (
            <div className="space-y-3">
              {agent.metadata.services.map((service) => (
                <div
                  key={`${service.name}:${service.endpoint}`}
                  className="rounded-lg border border-gray-800 bg-gray-950/40 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-sm font-semibold text-gray-200">
                      {service.name}
                    </span>
                    {service.version && (
                      <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700 font-mono text-xs">
                        {service.version}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-300 font-mono break-all">
                    {service.endpoint}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No services configured.</p>
          )}
        </section>

        <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3 md:col-span-2">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">
            Intelligent Data
          </h2>
          {intelligentDataInfo.intelligentData.length > 0 ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-300">
                  Owner Decryption
                </h3>
                <p className="text-xs text-gray-500">
                  Decryption is available only to the connected owner wallet and
                  requires a wallet signature.
                </p>
                <OwnerIntelligentDataDecrypt
                  agentId={id}
                  owner={agent.owner}
                  entries={intelligentDataInfo.intelligentData}
                />
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">
              No intelligent data entries found.
            </p>
          )}
        </section>

        <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3 md:col-span-2">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">
            All Feedback
          </h2>
          {feedbackOverview.feedbacks.length > 0 ? (
            <div className="space-y-3">
              {feedbackOverview.feedbacks.map((feedback) => (
                <div
                  key={`${feedback.client}:${feedback.feedbackIndex}`}
                  className="rounded-lg border border-gray-800 bg-gray-950/40 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs text-gray-500 font-mono">
                      {feedback.client} / #{feedback.feedbackIndex}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded border ${
                        feedback.isRevoked
                          ? "text-red-300 border-red-800 bg-red-950/40"
                          : "text-emerald-300 border-emerald-800 bg-emerald-950/40"
                      }`}
                    >
                      {feedback.isRevoked ? "Revoked" : "Active"}
                    </span>
                  </div>
                  <DetailRow
                    label="Score"
                    value={feedback.normalizedValue.toFixed(4)}
                    mono
                  />
                  <DetailRow label="Tag 1" value={feedback.tag1 || "-"} />
                  <DetailRow label="Tag 2" value={feedback.tag2 || "-"} />
                  {feedback.endpoint && (
                    <DetailRow
                      label="Endpoint"
                      value={feedback.endpoint}
                      mono
                      truncate
                    />
                  )}
                  {feedback.feedbackURI && (
                    <DetailRow
                      label="Feedback URI"
                      value={feedback.feedbackURI}
                      mono
                      truncate
                    />
                  )}
                  {feedback.feedbackHash && (
                    <DetailRow
                      label="Feedback Hash"
                      value={feedback.feedbackHash}
                      mono
                      truncate
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No feedback entries yet.</p>
          )}
        </section>
      </div>

      {/* Actions */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Actions</h2>
          <p className="text-gray-500 text-sm mt-1">
            ERC-7857 NFT operations and ERC-8004 registry interactions for this
            agent.
          </p>
        </div>
        <AgentDetailActions
          agentId={id}
          registryAddress={
            process.env.AGENT_REGISTRY_ADDRESS as `0x${string}` | undefined
          }
          reputationAddress={
            process.env.REPUTATION_REGISTRY_ADDRESS as `0x${string}` | undefined
          }
          owner={agent.owner}
          initialServices={agent.metadata.services ?? []}
        />
      </section>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      <span
        className={`text-gray-200 text-right break-all ${mono ? "font-mono" : ""} ${truncate ? "truncate max-w-[200px]" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
