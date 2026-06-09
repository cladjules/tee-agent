import { notFound } from "next/navigation";
import { getAgentPageData } from "@/lib/actions/registry";
import { DEFAULT_NETWORK, NETWORK_CONFIG } from "@tee-agent/agent/network";
import { getClientConfigForChain } from "@/lib/config";
import AgentDetailActions from "./components/AgentDetailActions";
import type {
  AgentPublicMetadata,
  AgentIntelligentDataEntry,
  AgentService,
} from "@tee-agent/agent/types";
import { readJsonFromUri } from "@tee-agent/agent/crypto";

// ─── Chain helpers (pure — receive URLs as args) ──────────────────────────────

function openseaNft(
  contractAddr: string,
  tokenId: string | bigint,
  openseaUrl: string,
) {
  return `${openseaUrl}/${contractAddr}/${tokenId}`;
}

function explorerAddress(addr: string, explorerUrl: string) {
  return `${explorerUrl}/address/${addr}`;
}

function explorerNft(
  contractAddr: string,
  tokenId: string | bigint,
  explorerUrl: string,
) {
  return `${explorerUrl}/nft/${contractAddr}/${tokenId}`;
}

function erc8004ScanUrl(
  agentId: string,
  erc8004ScanBase: string,
  erc8004ChainSlug: string,
) {
  return `${erc8004ScanBase}/agents/${erc8004ChainSlug}/${agentId}`;
}

function ipfsGatewayUrl(uri: string) {
  if (uri.startsWith("ipfs://")) {
    return `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`;
  }
  return null;
}

function agentTypeFromPublicMetadata(metadata: AgentPublicMetadata): string {
  const type = metadata.attributes?.find(
    (attribute) => attribute.trait_type === "Agent Type",
  )?.value;
  return typeof type === "string" && type.trim() ? type : "assistant";
}

function createdAtFromPublicMetadata(
  metadata: AgentPublicMetadata,
): number | undefined {
  const created = metadata.attributes?.find(
    (attribute) => attribute.trait_type === "Created",
  )?.value;
  return typeof created === "number" ? created : undefined;
}

async function resolvePublicMetadata(
  publicMetadataUri: string,
  fallback: {
    name: string;
    description: string;
    image?: string;
  },
): Promise<AgentPublicMetadata & { agentType: string; createdAt?: number }> {
  try {
    const metadata =
      await readJsonFromUri<AgentPublicMetadata>(publicMetadataUri);
    return {
      name: metadata.name || fallback.name,
      description: metadata.description || fallback.description,
      image: metadata.image ?? fallback.image,
      attributes: metadata.attributes,
      agentType: agentTypeFromPublicMetadata(metadata),
      createdAt: createdAtFromPublicMetadata(metadata),
    };
  } catch {
    return {
      name: fallback.name,
      description: fallback.description,
      image: fallback.image,
      agentType: "assistant",
    };
  }
}

interface Props {
  params: Promise<{ chain: string; id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return {
    title: `Agent #${id} — Tee Agent`,
    description: `View and manage on-chain AI agent #${id}`,
  };
}

export default async function AgentDetailPage({ params }: Props) {
  const { chain, id } = await params;
  const nc =
    NETWORK_CONFIG[chain as keyof typeof NETWORK_CONFIG] ?? DEFAULT_NETWORK;
  const chainId = nc.chain.id;
  const clientCfg = getClientConfigForChain(chainId);
  const {
    agent,
    intelligentDataInfo,
    feedbackOverview,
    oracleRunsResult,
    validationResponses,
  } = await getAgentPageData(id, chainId);

  if (!agent) notFound();

  const publicMetadata = await resolvePublicMetadata(agent.publicMetadataUri, {
    name: agent.metadata.name,
    description: agent.metadata.description,
    image: agent.metadata.image,
  });

  const oracleRuns = oracleRunsResult.runs;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
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

      {/* Addresses — compact strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="p-4 rounded-xl border border-gray-800 bg-gray-900/50 space-y-2">
          <h2 className="font-semibold text-xs text-gray-500 uppercase tracking-wider">
            Addresses
          </h2>
          <DetailRow
            label="Owner"
            value={agent.owner}
            mono
            truncate
            href={explorerAddress(agent.owner, nc.explorerUrl)}
          />
          {clientCfg.registryAddress && (
            <DetailRow
              label="AgentRegistry · ERC-7857"
              value={clientCfg.registryAddress}
              mono
              truncate
              href={explorerAddress(clientCfg.registryAddress, nc.explorerUrl)}
            />
          )}
          {clientCfg.validationRegistryAddress && (
            <DetailRow
              label="ValidationRegistry · ERC-8004"
              value={clientCfg.validationRegistryAddress}
              mono
              truncate
              href={explorerAddress(
                clientCfg.validationRegistryAddress,
                nc.explorerUrl,
              )}
            />
          )}
          {clientCfg.teeVerifierAddress && (
            <DetailRow
              label="TeeVerifier · TEE"
              value={clientCfg.teeVerifierAddress}
              mono
              truncate
              href={explorerAddress(
                clientCfg.teeVerifierAddress,
                nc.explorerUrl,
              )}
            />
          )}
        </section>

        <section className="p-4 rounded-xl border border-gray-800 bg-gray-900/50 space-y-2">
          <h2 className="font-semibold text-xs text-gray-500 uppercase tracking-wider">
            On-chain
          </h2>
          {clientCfg.registryAddress && (
            <DetailRow
              label="ERC-7857 Agent"
              value={`#${agent.agentId.toString()}`}
              mono
              href={explorerNft(
                clientCfg.registryAddress,
                agent.agentId,
                nc.explorerUrl,
              )}
            />
          )}
          {intelligentDataInfo.erc8004AgentId &&
            intelligentDataInfo.erc8004AgentId !== "0" && (
              <DetailRow
                label="ERC-8004 Agent"
                value={`#${intelligentDataInfo.erc8004AgentId}`}
                mono
                href={erc8004ScanUrl(
                  intelligentDataInfo.erc8004AgentId,
                  nc.erc8004ScanUrl,
                  nc.erc8004ChainSlug,
                )}
              />
            )}
          {clientCfg.registryAddress && (
            <DetailRow
              label="ERC-721 Opensea"
              value={`#${agent.agentId.toString()}`}
              mono
              mt
              href={openseaNft(
                clientCfg.registryAddress,
                agent.agentId,
                nc.openseaUrl,
              )}
            />
          )}
          {agent.publicMetadataUri && (
            <DetailRow
              label="ERC-721 URI"
              value={agent.publicMetadataUri}
              mono
              truncate
              href={ipfsGatewayUrl(agent.publicMetadataUri) ?? undefined}
            />
          )}
          {agent.metadataUri && (
            <DetailRow
              label="ERC-8004 URI"
              value={agent.metadataUri}
              mono
              truncate
              href={ipfsGatewayUrl(agent.metadataUri) ?? undefined}
            />
          )}
        </section>
      </div>

      {/* Oracle runs + actions — primary content */}
      <AgentDetailActions
        agentId={id}
        chainId={chainId}
        erc8004AgentId={intelligentDataInfo.erc8004AgentId ?? undefined}
        owner={agent.owner}
        initialServices={agent.metadata.services ?? []}
        initialPublicMetadata={{
          name: publicMetadata.name,
          description: publicMetadata.description,
          imageUrl: publicMetadata.image ?? "",
          agentType: publicMetadata.agentType,
        }}
        initialPublicMetadataCreatedAt={publicMetadata.createdAt}
        initialRuns={oracleRuns}
        initialValidationResponses={validationResponses}
      />

      {/* Secondary sections */}
      <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3">
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

      <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3">
        <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">
          Services
        </h2>
        {(agent.metadata.services?.length ?? 0) > 0 ? (
          <div className="space-y-3">
            {agent.metadata.services.map((service: AgentService) => (
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

      <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3">
        <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">
          Intelligent Data
        </h2>
        {intelligentDataInfo.intelligentData.length > 0 ? (
          <div className="space-y-3">
            {intelligentDataInfo.intelligentData.map(
              (entry: AgentIntelligentDataEntry, idx: number) => (
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
              ),
            )}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">
            No intelligent data entries found.
          </p>
        )}
      </section>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  truncate,
  mt,
  href,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
  mt?: boolean;
  href?: string;
}) {
  const cls = `text-right break-all ${mono ? "font-mono" : ""} ${truncate ? "truncate max-w-[200px]" : ""}`;
  return (
    <div
      className={`flex items-start justify-between gap-4 text-sm ${mt ? "mt-4" : ""}`}
    >
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
