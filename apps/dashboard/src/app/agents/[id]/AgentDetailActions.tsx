"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AgentService } from "@open-agents-toolkit/agent/types";
import {
  AGENT_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
} from "@open-agents-toolkit/agent/abis";
import { useWallet } from "@/components/wallet/WalletProvider";
import {
  prepareTransferAgent,
  prepareUpdateAgentServices,
} from "@/lib/actions/agents";
import { prepareFeedback, prepareValidation } from "@/lib/actions/registry";

interface Props {
  agentId: string;
  registryAddress?: `0x${string}`;
  reputationAddress?: `0x${string}`;
  owner: string;
  initialServices: readonly AgentService[];
}

const EIP8004_SERVICE_NAMES = [
  "web",
  "A2A",
  "MCP",
  "OASF",
  "DID",
  "email",
] as const;

export default function AgentDetailActions({
  agentId,
  registryAddress,
  reputationAddress,
  owner,
  initialServices,
}: Props) {
  const { address } = useWallet();
  const [moreOpen, setMoreOpen] = useState(false);
  const isOwner = !!address && address.toLowerCase() === owner.toLowerCase();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isOwner ? (
          <>
            <ActionCard
              title="Edit Services"
              description="Update the ERC-8004 service list and refresh the ERC-721 service traits."
              className="md:col-span-2"
            >
              <ServiceEditorForm
                agentId={agentId}
                initialServices={initialServices}
              />
            </ActionCard>

            <ActionCard
              title="Model Allowance"
              description="Grant another wallet approval to operate this model NFT."
            >
              <AuthorizeUsageForm
                tokenId={agentId}
                registryAddress={registryAddress}
              />
            </ActionCard>

            <ActionCard
              title="Transfer"
              description="Move ownership to a new address."
            >
              <TransferForm tokenId={agentId} />
            </ActionCard>
          </>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 text-sm text-gray-400 md:col-span-2">
            {address
              ? "Owner-only edit, approval, and transfer controls are hidden for wallets that do not own this agent."
              : "Connect the owner wallet to edit services, manage allowances, or transfer this agent."}
          </div>
        )}

        <ActionCard
          title="Give Feedback"
          description="Submit ERC-8004 reputation feedback."
          className="md:col-span-2"
        >
          <FeedbackForm
            agentId={agentId}
            reputationAddress={reputationAddress}
          />
        </ActionCard>
      </div>

      <div className="border border-gray-800 rounded-xl overflow-hidden">
        {moreOpen && (
          <div className="border-t border-gray-800 grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
            {isOwner && (
              <SmallActionCard title="Revoke Model Allowance">
                <RevokeAuthForm
                  tokenId={agentId}
                  registryAddress={registryAddress}
                />
              </SmallActionCard>
            )}
            <SmallActionCard title="Request Validation">
              <ValidationForm agentId={agentId} />
            </SmallActionCard>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function ActionCard({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-4 ${className ?? ""}`}
    >
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-gray-500 text-sm">{description}</p>
      </div>
      {children}
    </div>
  );
}

function SmallActionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 rounded-lg border border-gray-800 bg-gray-900/30 space-y-3">
      <h4 className="text-sm font-semibold text-gray-300">{title}</h4>
      {children}
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function useActionState() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    txHash?: string;
    tokenId?: bigint;
    error?: string;
  } | null>(null);

  function run(
    fn: () => Promise<{ txHash?: string; tokenId?: bigint; error?: string }>,
  ) {
    setResult(null);
    startTransition(async () => setResult(await fn()));
  }

  return { isPending, result, run };
}

function ResultBanner({
  result,
}: {
  result: { txHash?: string; tokenId?: bigint; error?: string } | null;
}) {
  if (!result) return null;
  if (result.error)
    return (
      <p className="text-xs text-red-400 bg-red-950/40 px-3 py-2 rounded-lg">
        {result.error}
      </p>
    );
  return (
    <p className="text-xs text-green-400 bg-green-950/40 px-3 py-2 rounded-lg">
      ✓{" "}
      {result.tokenId !== undefined
        ? `Token ID: #${result.tokenId.toString()}`
        : result.txHash
          ? `Tx: ${result.txHash.slice(0, 18)}…`
          : "Success"}
    </p>
  );
}

function Field({
  label,
  name,
  placeholder,
  required,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
      />
    </div>
  );
}

function SubmitButton({
  isPending,
  label,
}: {
  isPending: boolean;
  label: string;
}) {
  return (
    <button
      type="submit"
      disabled={isPending}
      className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
    >
      {isPending ? "Submitting…" : label}
    </button>
  );
}

function validateJsonInput(input: string): string | null {
  if (!input.trim()) return null;
  try {
    JSON.parse(input);
    return null;
  } catch {
    return "Invalid JSON.";
  }
}

// ─── Forms ────────────────────────────────────────────────────────────────────

function FeedbackForm({
  agentId,
  reputationAddress,
}: {
  agentId: string;
  reputationAddress?: `0x${string}`;
}) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { chainId, getViemClients, switchChain } = useWallet();
  const [feedbackJson, setFeedbackJson] = useState(
    '{\n  "summary": "Great response quality",\n  "details": { "latencyMs": 820 }\n}',
  );
  const feedbackJsonError = validateJsonInput(feedbackJson);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          if (!reputationAddress)
            return { error: "Reputation registry is not configured." };

          if (!chainId)
            return { error: "Connect your wallet before submitting feedback." };

          const formData = new FormData(e.currentTarget);
          const prepared = await prepareFeedback(formData);
          if (prepared.error) return { error: prepared.error };

          if (
            !prepared.value ||
            prepared.valueDecimals === undefined ||
            !prepared.feedbackURI
          ) {
            return { error: "Feedback preparation failed." };
          }

          await switchChain();

          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: reputationAddress,
            abi: REPUTATION_REGISTRY_ABI,
            functionName: "giveFeedback",
            args: [
              BigInt(agentId),
              BigInt(prepared.value),
              Number(prepared.valueDecimals),
              prepared.tag1 ?? "",
              prepared.tag2 ?? "",
              "",
              prepared.feedbackURI,
              "0x0000000000000000000000000000000000000000000000000000000000000000",
            ],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          router.refresh();
          return { txHash: hash };
        });
      }}
      className="space-y-3"
    >
      <input type="hidden" name="agentId" value={agentId} />
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Value * <span className="text-gray-600">(-1.0 to 1.0)</span>
        </label>
        <input
          name="value"
          type="number"
          min="-1"
          max="1"
          step="0.01"
          placeholder="0.8"
          required
          className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tag 1" name="tag1" placeholder="helpful" />
        <Field label="Tag 2" name="tag2" placeholder="fast" />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Feedback JSON
        </label>
        <textarea
          name="feedbackJson"
          value={feedbackJson}
          onChange={(e) => setFeedbackJson(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 font-mono placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
        />
        {feedbackJsonError ? (
          <p className="text-xs text-red-400 mt-1">{feedbackJsonError}</p>
        ) : (
          <p className="text-xs text-green-400 mt-1">Valid JSON.</p>
        )}
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Or Upload JSON File
        </label>
        <input
          name="feedbackFile"
          type="file"
          accept="application/json,.json"
          className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-violet-600 file:text-white file:text-xs"
        />
      </div>
      <p className="text-xs text-gray-600">
        We upload this JSON to 0G and submit the resulting URI on-chain.
      </p>
      <SubmitButton isPending={isPending} label="Submit Feedback" />
      <ResultBanner result={result} />
    </form>
  );
}

function TransferForm({ tokenId }: { tokenId: string }) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { getViemClients, switchChain } = useWallet();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const prepared = await prepareTransferAgent(
            new FormData(e.currentTarget),
          );
          if (prepared.error) return { error: prepared.error };

          await switchChain();
          const { publicClient, walletClient } = await getViemClients();
          const accessPayloads = prepared.accessPayloads ?? [];
          const ownershipProofs = prepared.ownershipProofs ?? [];
          const from = prepared.from!;
          const to = prepared.to!;
          const tokenId = BigInt(prepared.tokenId!);
          const deadline = prepared.deadline!;

          // Recipient signs each access proof using signMessage({ message: digest })
          // digest is the innerHash; signMessage adds the EIP-191 prefix matching Verifier.sol.
          const proofs = await Promise.all(
            accessPayloads.map(async (payload, index) => ({
              accessProof: {
                dataHash: payload.dataHash,
                targetPubkey: payload.targetPubkey,
                nonce: payload.nonce,
                proof: await walletClient.signMessage({
                  account: walletClient.account!,
                  message: payload.digest,
                }),
              },
              ownershipProof: ownershipProofs[index] ?? {
                oracleType: 0,
                dataHash: payload.dataHash,
                sealedKey: "0x" as `0x${string}`,
                targetPubkey: payload.targetPubkey,
                nonce: payload.nonce,
                proof: "0x" as `0x${string}`,
              },
              from,
              to,
              tokenId,
              deadline,
            })),
          );

          const hash = await walletClient.writeContract({
            address: prepared.contractAddress!,
            abi: AGENT_REGISTRY_ABI,
            functionName: "iTransferFrom",
            args: [from, to, tokenId, proofs],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          router.refresh();
          return { txHash: hash };
        });
      }}
      className="space-y-3"
    >
      <input type="hidden" name="tokenId" value={tokenId} />
      <Field label="Recipient Address *" name="to" placeholder="0x…" required />
      <div className="rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 text-xs text-gray-400">
        <strong>Tip:</strong> Transfer your agent's ENS domain directly in ENS
        manager for seamless cross-chain agent ownership transfer via our
        relayer. Alternatively, if transferred here, you will need to transfer
        the domain name after.
      </div>
      <SubmitButton isPending={isPending} label="Transfer" />
      <ResultBanner result={result} />
    </form>
  );
}

function ServiceEditorForm({
  agentId,
  initialServices,
}: {
  agentId: string;
  initialServices: readonly AgentService[];
}) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { getViemClients, switchChain } = useWallet();
  const initialServiceMap = new Map(
    initialServices.map((service) => [service.name, service]),
  );
  const ensService = initialServiceMap.get("ENS");
  const ensEndpoint = ensService?.endpoint ?? "";

  const [services, setServices] = useState<
    Array<{
      name: (typeof EIP8004_SERVICE_NAMES)[number];
      endpoint: string;
      version: string;
    }>
  >(
    EIP8004_SERVICE_NAMES.map((name) => {
      const existing = initialServiceMap.get(name);
      return {
        name,
        endpoint: existing?.endpoint ?? "",
        version: existing?.version ?? "",
      };
    }),
  );

  function updateService(
    index: number,
    field: "endpoint" | "version",
    value: string,
  ) {
    setServices((current) => {
      const next = [...current];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();

        const metadataServices: Array<{
          name: string;
          endpoint: string;
          version?: string;
        }> = [
          ...services
            .filter((service) => service.endpoint.trim().length > 0)
            .map((service) => ({
              name: service.name,
              endpoint: service.endpoint,
              version: service.version,
            })),
          ...(ensEndpoint.trim().length > 0
            ? [{ name: "ENS", endpoint: ensEndpoint.trim(), version: "v1" }]
            : []),
        ];

        const formData = new FormData();
        formData.set("tokenId", agentId);
        formData.set("servicesJson", JSON.stringify(metadataServices));
        run(async () => {
          const prepared = await prepareUpdateAgentServices(formData);
          if (prepared.error) return { error: prepared.error };

          await switchChain();
          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: prepared.contractAddress!,
            abi: AGENT_REGISTRY_ABI,
            functionName: "setMetadataURI",
            args: [BigInt(prepared.tokenId!), prepared.tokenUri!],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          router.refresh();
          return { txHash: hash };
        });
      }}
      className="space-y-4"
    >
      <p className="text-xs text-gray-500 px-2 -mt-1">
        EIP-8004 services. Fill endpoints you support. ENS is included and
        read-only.
      </p>

      {services.map((service, index) => (
        <div
          key={`${index}:${service.name}:${service.endpoint}`}
          className="p-3 rounded-lg border border-gray-700 bg-gray-800/50"
        >
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-12 md:col-span-3">
              <input
                type="text"
                value={service.name}
                disabled
                className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 text-sm"
              />
            </div>
            <div className="col-span-12 md:col-span-6">
              <input
                type="text"
                value={service.endpoint}
                onChange={(e) =>
                  updateService(index, "endpoint", e.target.value)
                }
                placeholder="Endpoint"
                className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-500 text-sm"
              />
            </div>
            <div className="col-span-12 md:col-span-3">
              <input
                type="text"
                value={service.version}
                onChange={(e) =>
                  updateService(index, "version", e.target.value)
                }
                placeholder="Version"
                className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-500 text-sm"
              />
            </div>
          </div>
        </div>
      ))}

      <div className="p-3 rounded-lg border border-gray-700 bg-gray-800/50">
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-12 md:col-span-3">
            <input
              type="text"
              value="ENS"
              disabled
              className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 text-sm"
            />
          </div>
          <div className="col-span-12 md:col-span-6">
            <input
              type="text"
              value={ensEndpoint}
              disabled
              className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 text-sm"
            />
          </div>
          <div className="col-span-12 md:col-span-3">
            <input
              type="text"
              value="v1"
              disabled
              className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 text-sm"
            />
          </div>
        </div>
      </div>

      <SubmitButton isPending={isPending} label="Save Services" />
      <ResultBanner result={result} />
    </form>
  );
}

function AuthorizeUsageForm({
  tokenId,
  registryAddress,
}: {
  tokenId: string;
  registryAddress?: `0x${string}`;
}) {
  const { isPending, result, run } = useActionState();
  const { getViemClients, switchChain } = useWallet();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          if (!registryAddress)
            return { error: "Agent registry is not configured." };
          const formData = new FormData(e.currentTarget);
          const user = (formData.get("user") as string | null)?.trim() as
            | `0x${string}`
            | undefined;
          if (!user) return { error: "User address is required." };

          await switchChain();
          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: registryAddress,
            abi: AGENT_REGISTRY_ABI,
            functionName: "approve",
            args: [user, BigInt(tokenId)],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          return { txHash: hash };
        });
      }}
      className="space-y-3"
    >
      <input type="hidden" name="tokenId" value={tokenId} />
      <Field label="Wallet Address *" name="user" placeholder="0x…" required />
      <p className="text-xs text-gray-600">
        This grants ERC-721 token approval for this specific model NFT.
      </p>
      <SubmitButton isPending={isPending} label="Grant Allowance" />
      <ResultBanner result={result} />
    </form>
  );
}

function RevokeAuthForm({
  tokenId,
  registryAddress,
}: {
  tokenId: string;
  registryAddress?: `0x${string}`;
}) {
  const { isPending, result, run } = useActionState();
  const { getViemClients, switchChain } = useWallet();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          if (!registryAddress)
            return { error: "Agent registry is not configured." };
          await switchChain();
          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: registryAddress,
            abi: AGENT_REGISTRY_ABI,
            functionName: "approve",
            args: [
              "0x0000000000000000000000000000000000000000",
              BigInt(tokenId),
            ],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          return { txHash: hash };
        });
      }}
      className="space-y-3"
    >
      <input type="hidden" name="tokenId" value={tokenId} />
      <p className="text-xs text-gray-600">
        This clears the current token-level approval via approve(0x0, tokenId).
      </p>
      <SubmitButton isPending={isPending} label="Revoke Allowance" />
      <ResultBanner result={result} />
    </form>
  );
}

function ValidationForm({ agentId }: { agentId: string }) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { getViemClients, switchChain } = useWallet();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const prepared = await prepareValidation(
            new FormData(e.currentTarget),
          );
          if (prepared.error) return { error: prepared.error };

          await switchChain();
          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: prepared.contractAddress!,
            abi: VALIDATION_REGISTRY_ABI,
            functionName: "validationRequest",
            args: [
              prepared.validatorAddress!,
              BigInt(prepared.agentId!),
              prepared.requestURI ?? "",
              prepared.requestHash!,
            ],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          router.refresh();
          return { txHash: hash };
        });
      }}
      className="space-y-3"
    >
      <input type="hidden" name="agentId" value={agentId} />
      <Field
        label="Validator Address *"
        name="validatorAddress"
        placeholder="0x…"
        required
      />
      <Field label="Request URI" name="requestURI" placeholder="https://…" />
      <SubmitButton isPending={isPending} label="Request" />
      <ResultBanner result={result} />
    </form>
  );
}
