import { notFound } from "next/navigation";
import {
  getAgent,
  getAgentFeedbackOverview,
  getAgentIntelligentData,
} from "@/lib/actions/registry";
import {
  fetchPendingValidationsForAgent,
  getOracleRunHistory,
} from "@/lib/actions/agents";
import AgentDetailActions from "./AgentDetailActions";

// ─── Chain helpers ────────────────────────────────────────────────────────────

const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "baseSepolia") as
  | "base"
  | "baseSepolia";

const EXPLORER_BASE =
  NETWORK === "base" ? "https://basescan.org" : "https://sepolia.basescan.org";

const ERC8004_IDENTITY_ADDRESS =
  NETWORK === "base"
    ? "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
    : "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const ERC8004_SCAN_BASE =
  NETWORK === "base" ? "https://8004scan.io" : "https://testnet.8004scan.io";

const CHAIN_ID = NETWORK === "base" ? 8453 : 84532;

function explorerAddress(addr: string) {
  return `${EXPLORER_BASE}/address/${addr}`;
}

function explorerNft(contractAddr: string, tokenId: string | bigint) {
  return `${EXPLORER_BASE}/nft/${contractAddr}/${tokenId}`;
}

function ipfsGatewayUrl(uri: string) {
  if (uri.startsWith("ipfs://")) {
    return `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`;
  }
  return null;
}

function erc8004ScanUrl(agentId: string) {
  return `${ERC8004_SCAN_BASE}/agents/${CHAIN_ID}/${agentId}`;
}

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return {
    title: `Agent #${id} — Tee Agent`,
    description: `View and manage on-chain AI agent #${id}`,
  };
}

export default async function AgentDetailPage({ params }: Props) {
  const { id } = await params;
  const agentId = BigInt(id);
  const [
    agent,
    intelligentDataInfo,
    feedbackOverview,
    oracleRunsResult,
    pendingValidations,
  ] = await Promise.all([
    getAgent(agentId),
    getAgentIntelligentData(agentId),
    getAgentFeedbackOverview(agentId),
    getOracleRunHistory(id),
    fetchPendingValidationsForAgent(id),
  ]);

  if (!agent) notFound();

  const oracleRuns = oracleRunsResult.runs;

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
            <h1 className="text-3xl font-bold">{agent.metadata.name}</h1>
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
        {/* Addresses & Owners */}
        <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">
            Addresses
          </h2>
          <DetailRow
            label="Owner"
            value={agent.owner}
            mono
            truncate
            href={explorerAddress(agent.owner)}
          />
          {agent.agentWallet &&
            agent.agentWallet !==
              "0x0000000000000000000000000000000000000000" && (
              <DetailRow
                label="Agent Wallet"
                value={agent.agentWallet}
                mono
                truncate
                href={explorerAddress(agent.agentWallet)}
              />
            )}
          {intelligentDataInfo.verifierAddress &&
            intelligentDataInfo.verifierAddress !==
              "0x0000000000000000000000000000000000000000" && (
              <DetailRow
                label="Verifier"
                value={intelligentDataInfo.verifierAddress}
                mono
                truncate
                href={explorerAddress(intelligentDataInfo.verifierAddress)}
              />
            )}
        </section>

        {/* ERC-721 / ERC-7857 */}
        <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">
            ERC-721 / ERC-7857
          </h2>
          {process.env.AGENT_REGISTRY_ADDRESS && (
            <DetailRow
              label="Token"
              value={`#${agent.agentId.toString()}`}
              mono
              href={explorerNft(
                process.env.AGENT_REGISTRY_ADDRESS,
                agent.agentId,
              )}
            />
          )}
          <DetailRow
            label="Metadata URI"
            value={agent.publicMetadataUri ?? "—"}
            mono
            truncate
            href={ipfsGatewayUrl(agent.publicMetadataUri ?? "") ?? undefined}
          />
          {agent.publicMetadataUri &&
            ipfsGatewayUrl(agent.publicMetadataUri) && (
              <DetailRow
                label="Metadata JSON"
                value="View on IPFS ↗"
                href={ipfsGatewayUrl(agent.publicMetadataUri)!}
              />
            )}
        </section>

        {/* ERC-8004 */}
        <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">
            ERC-8004
          </h2>
          {intelligentDataInfo.erc8004AgentId &&
            intelligentDataInfo.erc8004AgentId !== "0" && (
              <>
                <DetailRow
                  label="Token"
                  value={`#${intelligentDataInfo.erc8004AgentId}`}
                  mono
                  href={explorerNft(
                    ERC8004_IDENTITY_ADDRESS,
                    intelligentDataInfo.erc8004AgentId,
                  )}
                />
                <DetailRow
                  label="View on 8004scan"
                  value="View agent ↗"
                  href={erc8004ScanUrl(intelligentDataInfo.erc8004AgentId)}
                />
              </>
            )}
          {agent.metadataUri ? (
            <>
              <DetailRow
                label="Metadata URI"
                value={agent.metadataUri}
                mono
                truncate
                href={ipfsGatewayUrl(agent.metadataUri) ?? undefined}
              />
              {ipfsGatewayUrl(agent.metadataUri) && (
                <DetailRow
                  label="Metadata JSON"
                  value="View on IPFS ↗"
                  href={ipfsGatewayUrl(agent.metadataUri)!}
                />
              )}
            </>
          ) : (
            <DetailRow label="Metadata URI" value="—" />
          )}
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
              {intelligentDataInfo.intelligentData.map((entry, idx) => (
                <div
                  key={`${entry.dataHash}:${idx}`}
                  className="rounded-lg border border-gray-800 bg-gray-950/40 p-4 space-y-2"
                >
                  {entry.name && (
                    <p className="text-xs font-semibold text-gray-400">
                      {entry.name}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">Proof Hash</p>
                  <p className="text-xs text-gray-300 break-all font-mono">
                    {entry.dataHash}
                  </p>
                  <p className="text-xs text-gray-500">Address / URI</p>
                  <p className="text-xs text-gray-300 break-all font-mono">
                    {entry.dataDescription}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">
              No intelligent data entries found.
            </p>
          )}
        </section>

        <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3 md:col-span-2">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">
            Reputation &amp; Feedback
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
          owner={agent.owner}
          initialServices={agent.metadata.services ?? []}
          initialRuns={oracleRuns}
          initialPendingValidations={pendingValidations}
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
  href,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
  href?: string;
}) {
  const cls = `text-right break-all ${mono ? "font-mono" : ""} ${truncate ? "truncate max-w-[200px]" : ""}`;
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${cls} text-violet-400 hover:text-violet-300 underline underline-offset-2`}
          title={value}
        >
          {value}
        </a>
      ) : (
        <span className={`${cls} text-gray-200`} title={value}>
          {value}
        </span>
      )}
    </div>
  );
}
