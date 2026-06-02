"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { keccak256, toBytes, type Address } from "viem";
import type { AgentService } from "@tee-agent/agent/types";
import {
  AGENT_REGISTRY_ABI,
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
} from "@tee-agent/agent/abis";
import {
  signAccessPayloads,
  buildReencryptTypedData,
  buildRunTypedData,
  buildValidateTypedData,
} from "@tee-agent/agent/typed-data";
import { useWallet } from "@/components/wallet/WalletProvider";
import {
  prepareTransferAgent,
  prepareUpdateAgentServices,
  recordOracleRun,
} from "@/lib/actions/agents";
import { prepareFeedback } from "@/lib/actions/registry";
import type { TransferRecipientAgent } from "@/lib/actions/registry";
import type { CachedOracleRun } from "@/lib/agent-cache";
import type { PendingValidation } from "@/lib/actions/agents";
import {
  ServiceEditorPanel,
  type ServiceEditorEntry,
} from "@/components/ServiceEditorPanel";
import { ErrorBox } from "@/components/ErrorBox";

const VERIFIER_TEE_VERIFIER_ABI = [
  {
    name: "teeVerifier",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

type ActionClientConfig = {
  registryAddress?: Address;
  identityRegistryAddress?: Address;
  reputationRegistryAddress?: Address;
  validationRegistryAddress?: Address;
};

interface Props {
  agentId: string;
  /** ERC-8004 Identity Registry agent ID — used for ValidationRegistry calls. */
  erc8004AgentId?: string;
  owner: string;
  initialServices: readonly AgentService[];
  initialRuns?: CachedOracleRun[];
  initialPendingValidations?: PendingValidation[];
  recipientAgents?: TransferRecipientAgent[];
  clientCfg: ActionClientConfig;
}

export default function AgentDetailActions({
  agentId,
  erc8004AgentId,
  owner,
  initialServices,
  initialRuns,
  initialPendingValidations,
  recipientAgents,
  clientCfg,
}: Props) {
  const { address } = useWallet();
  const isOwner = !!address && address.toLowerCase() === owner.toLowerCase();
  const [runs, setRuns] = useState<CachedOracleRun[]>(initialRuns ?? []);
  const [pending, setPending] = useState<PendingValidation[]>(
    initialPendingValidations ?? [],
  );
  function addRun(run: CachedOracleRun) {
    setRuns((prev) => [run, ...prev]);
  }
  function markValidationComplete(
    requestHash: string,
    response: {
      score?: number;
      txHash?: string;
      responseURI?: string;
      responseHash?: string;
      tag?: string;
      reasoning?: string;
      evidence?: Record<string, unknown>;
    } | null,
  ) {
    if (!response) return;
    setPending((prev) =>
      prev.map((j) =>
        j.requestHash === requestHash
          ? {
              ...j,
              response: {
                score: response.score ?? 0,
                txHash: response.txHash,
                timestamp: Math.floor(Date.now() / 1000),
                responseURI: response.responseURI,
                responseHash: response.responseHash,
                tag: response.tag,
                reasoning: response.reasoning,
                evidence: response.evidence,
              },
            }
          : j,
      ),
    );
  }

  const teeOracleUrl =
    initialServices.find((s) => s.name === "teeOracle")?.endpoint ?? "";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CollapsibleSection
          title="Oracle Runs"
          description="Run the oracle and request on-chain validation against specific runs."
          className="md:col-span-2"
          defaultOpen
        >
          <OracleRunHistory
            runs={runs}
            agentId={agentId}
            erc8004AgentId={erc8004AgentId}
            teeOracleUrl={teeOracleUrl}
            clientCfg={clientCfg}
          />
          {runs.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-800" />
          )}
          <RunOracleForm
            agentId={agentId}
            teeOracleUrl={teeOracleUrl}
            onNewRun={addRun}
            clientCfg={clientCfg}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title="Validations"
          description="Sign and send queued validation requests to the oracle."
          className="md:col-span-2"
          defaultOpen
        >
          <PendingValidationsPanel
            agentId={agentId}
            erc8004AgentId={erc8004AgentId}
            pending={pending}
            teeOracleUrl={teeOracleUrl}
            onComplete={markValidationComplete}
            clientCfg={clientCfg}
          />
        </CollapsibleSection>

        {isOwner ? (
          <CollapsibleSection
            title="NFT Actions"
            description="Transfer, approve, or revoke ERC-721 ownership and allowances."
            className="md:col-span-2"
          >
            <div className="space-y-6">
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Transfer
                </h4>
                <TransferForm
                  tokenId={agentId}
                  erc8004AgentId={erc8004AgentId}
                  teeOracleUrl={teeOracleUrl}
                  recipientAgents={recipientAgents ?? []}
                  clientCfg={clientCfg}
                />
              </div>

              <div className="opacity-60">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                  Model Allowance
                  <span className="text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                    Coming soon
                  </span>
                </h4>
                <p className="text-xs text-gray-500">
                  Grant another wallet approval to operate this model NFT.
                </p>
              </div>

              <div className="opacity-60">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                  Revoke Model Allowance
                  <span className="text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                    Coming soon
                  </span>
                </h4>
                <p className="text-xs text-gray-500">
                  Remove approval for a wallet to operate this model NFT.
                </p>
              </div>
            </div>
          </CollapsibleSection>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 text-sm text-gray-400 md:col-span-2">
            {address
              ? "Owner-only edit, approval, and transfer controls are hidden for wallets that do not own this agent."
              : "Connect the owner wallet to edit services, manage allowances, or transfer this agent."}
          </div>
        )}
      </div>

      {isOwner && (
        <CollapsibleSection
          title="Edit Services"
          description="Update the ERC-8004 service list and refresh the ERC-721 service traits."
        >
          <ServiceEditorForm
            agentId={agentId}
            initialServices={initialServices}
          />
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="Give Feedback"
        description="Submit ERC-8004 reputation feedback."
      >
        <FeedbackForm erc8004AgentId={erc8004AgentId} clientCfg={clientCfg} />
      </CollapsibleSection>
    </div>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  description,
  className,
  comingSoon,
  defaultOpen,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  comingSoon?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div
      className={`rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => !comingSoon && setOpen((v) => !v)}
        disabled={comingSoon}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-800/40 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            {title}
            {comingSoon && (
              <span className="text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                Coming soon
              </span>
            )}
          </h3>
          <p className="text-gray-500 text-xs mt-0.5">{description}</p>
        </div>
        <span className="text-gray-500 ml-4 flex-shrink-0 text-xs">
          {!comingSoon && (open ? "▲" : "▼")}
        </span>
      </button>
      {open && !comingSoon && (
        <div className="pt-4 px-5 pb-5 pt-1 border-t border-gray-800 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

function ActionCard({
  title,
  description,
  className,
  comingSoon,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  comingSoon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-4 ${comingSoon ? "opacity-60" : ""} ${className ?? ""}`}
    >
      <div>
        <h3 className="font-semibold flex items-center gap-2">
          {title}
          {comingSoon && (
            <span className="text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
              Coming soon
            </span>
          )}
        </h3>
        <p className="text-gray-500 text-sm">{description}</p>
      </div>
      {!comingSoon && children}
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
  if (result.error) return <ErrorBox message={result.error} />;
  return (
    <p className="text-xs text-green-400 bg-green-950/40 px-3 py-2 rounded-lg">
      ✓{" "}
      {result.tokenId !== undefined
        ? `Token ID: #${result.tokenId.toString()}`
        : result.txHash
          ? `Tx: ${result.txHash}`
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
  disabled,
}: {
  isPending: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={isPending || !!disabled}
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
  erc8004AgentId,
  clientCfg,
}: {
  erc8004AgentId?: string;
  clientCfg: ActionClientConfig;
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
          if (!clientCfg.reputationRegistryAddress)
            return { error: "Reputation registry is not configured." };

          if (!chainId)
            return { error: "Connect your wallet before submitting feedback." };
          if (!erc8004AgentId || erc8004AgentId === "0") {
            return {
              error:
                "This agent is not linked to an ERC-8004 identity, so reputation feedback is unavailable.",
            };
          }

          const form = e.currentTarget;
          const valueStr = (
            form.elements.namedItem("value") as HTMLInputElement
          ).value;
          const tag1 = (
            (form.elements.namedItem("tag1") as HTMLInputElement)?.value ?? ""
          ).trim();
          const tag2 = (
            (form.elements.namedItem("tag2") as HTMLInputElement)?.value ?? ""
          ).trim();
          const feedbackFile =
            (form.elements.namedItem("feedbackFile") as HTMLInputElement)
              ?.files?.[0] ?? null;
          const prepared = await prepareFeedback({
            agentId: erc8004AgentId,
            value: parseFloat(valueStr),
            tag1,
            tag2,
            feedbackJson: feedbackJson || undefined,
            feedbackFile,
          });
          if ("error" in prepared) return { error: prepared.error };

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
            address: clientCfg.reputationRegistryAddress,
            abi: REPUTATION_REGISTRY_ABI,
            functionName: "giveFeedback",
            args: [
              BigInt(erc8004AgentId),
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
      {erc8004AgentId && erc8004AgentId !== "0" ? (
        <p className="text-xs text-gray-500 font-mono">
          ERC-8004 agent #{erc8004AgentId}
        </p>
      ) : (
        <p className="text-xs text-amber-400/80">
          This agent is not linked to ERC-8004 reputation.
        </p>
      )}
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

function TransferForm({
  tokenId,
  erc8004AgentId,
  teeOracleUrl,
  recipientAgents,
  clientCfg,
}: {
  tokenId: string;
  erc8004AgentId?: string;
  teeOracleUrl: string;
  recipientAgents: TransferRecipientAgent[];
  clientCfg: ActionClientConfig;
}) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { getViemClients, switchChain } = useWallet();
  const normalizedOracleUrl = teeOracleUrl.trim().replace(/\/+$/, "");
  const [recipientSelection, setRecipientSelection] = useState(
    recipientAgents[0]?.agentId ?? "",
  );
  const selectedRecipient = recipientAgents.find(
    (agent) => agent.agentId === recipientSelection,
  );
  const selectedRecipientMissingOracle =
    !!selectedRecipient && !selectedRecipient.teeOracleUrl;
  const canTransferToSelectedAgent =
    !!selectedRecipient && !!selectedRecipient.teeOracleUrl && !!erc8004AgentId;

  if (!normalizedOracleUrl) {
    return (
      <p className="text-xs text-amber-400/80">
        Add a <span className="font-mono">teeOracle</span> service URL before
        transferring encrypted agents.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const rawFormData = new FormData(e.currentTarget);
        run(async () => {
          const selectedRecipientId = String(
            rawFormData.get("recipientAgentId") ?? "",
          );
          const formRecipient = recipientAgents.find(
            (agent) => agent.agentId === selectedRecipientId,
          );
          if (!formRecipient) {
            return { error: "Select a recipient agent." };
          }
          const recipientAddress = formRecipient.owner;
          const recipientOracleUrl = (formRecipient.teeOracleUrl ?? "")
            .trim()
            .replace(/\/+$/, "");

          if (!recipientOracleUrl) {
            return { error: "Selected recipient agent has no teeOracle URL." };
          }
          if (!erc8004AgentId || erc8004AgentId === "0") {
            return {
              error: "This agent has no linked ERC-8004 identity to transfer.",
            };
          }

          await switchChain();
          const { publicClient, walletClient } = await getViemClients();
          if (!clientCfg.registryAddress) {
            return { error: "AgentRegistry is not configured." };
          }
          if (!clientCfg.identityRegistryAddress) {
            return { error: "ERC-8004 IdentityRegistry is not configured." };
          }
          const erc8004TokenId = BigInt(erc8004AgentId);
          const identityOwner = (await publicClient.readContract({
            address: clientCfg.identityRegistryAddress,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "ownerOf",
            args: [erc8004TokenId],
          })) as `0x${string}`;
          if (
            identityOwner.toLowerCase() !==
            walletClient.account!.address.toLowerCase()
          ) {
            return {
              error:
                "Connected wallet does not own the linked ERC-8004 identity.",
            };
          }
          const [approvedAddress, approvedForAll] = await Promise.all([
            publicClient.readContract({
              address: clientCfg.identityRegistryAddress,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: "getApproved",
              args: [erc8004TokenId],
            }) as Promise<`0x${string}`>,
            publicClient.readContract({
              address: clientCfg.identityRegistryAddress,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: "isApprovedForAll",
              args: [walletClient.account!.address, clientCfg.registryAddress],
            }) as Promise<boolean>,
          ]);
          const hasIdentityApproval =
            approvedForAll ||
            approvedAddress.toLowerCase() ===
              clientCfg.registryAddress.toLowerCase();
          if (!hasIdentityApproval) {
            const approvalHash = await walletClient.writeContract({
              address: clientCfg.identityRegistryAddress,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: "approve",
              args: [clientCfg.registryAddress, erc8004TokenId],
              chain: walletClient.chain,
              account: walletClient.account!,
            });
            await publicClient.waitForTransactionReceipt({
              hash: approvalHash,
            });
          }

          // 1. Fetch the oracle's address + public key for EIP-712 domain.
          const addrRes = await fetch(`${normalizedOracleUrl}/address`);
          if (!addrRes.ok) {
            return {
              error: `Could not reach oracle at ${normalizedOracleUrl}/address (${addrRes.status})`,
            };
          }
          const { address: oracleAddress } = (await addrRes.json()) as {
            address: string;
            publicKey?: string;
          };

          // 2. Sign the EIP-712 ReencryptRequest so the oracle can verify ownership.
          const chainId = await publicClient.getChainId();
          const deadline = Math.floor(Date.now() / 1000) + 3600;
          const td = buildReencryptTypedData({
            oracleAddress: oracleAddress as `0x${string}`,
            chainId,
            tokenId: BigInt(tokenId),
            from: walletClient.account!.address,
            to: recipientAddress,
            deadline,
          });
          const oracleSignature = await walletClient.signTypedData({
            account: walletClient.account!,
            ...td,
          });

          // 3. Prepare transfer via server action (oracle call happens inside).
          const prepared = await prepareTransferAgent({
            tokenId,
            to: recipientAddress,
            oracleUrl: normalizedOracleUrl,
            recipientOracleUrl,
            oracleSignature,
            oracleDeadline: String(deadline),
          });
          if ("error" in prepared) return { error: prepared.error };

          const accessPayloads = prepared.accessPayloads ?? [];
          const ownershipProofs = prepared.ownershipProofs ?? [];
          const from = prepared.from!;
          const to = prepared.to!;
          const tId = BigInt(prepared.tokenId!);
          const deadlineBig = prepared.deadline!;

          // 4. Sign each access proof (recipient acknowledgement of blob hash).
          const proofs = await signAccessPayloads(
            (digest) =>
              walletClient.signMessage({
                account: walletClient.account!,
                message: digest,
              }),
            accessPayloads,
            ownershipProofs,
            { from, to, tokenId: tId, deadline: deadlineBig },
          );

          const hash = await walletClient.writeContract({
            address: prepared.contractAddress!,
            abi: AGENT_REGISTRY_ABI,
            functionName: "iTransferFromWithIdentity",
            args: [from, to, tId, proofs],
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
      <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 space-y-1">
        <p className="text-xs font-semibold text-gray-300">
          Transfer to registered agent
        </p>
      </div>
      {recipientAgents.length > 0 && (
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Recipient Agent from Redis
          </label>
          <select
            name="recipientAgentId"
            value={recipientSelection}
            onChange={(event) => setRecipientSelection(event.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 focus:outline-none focus:border-violet-600 text-sm"
          >
            {recipientAgents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.name} #{agent.agentId}
                {agent.teeOracleUrl ? "" : " - no teeOracle"}
              </option>
            ))}
          </select>
        </div>
      )}
      {recipientAgents.length === 0 ? (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
          <p className="text-xs text-amber-300/90">
            No other cached agents found in Redis for this chain. Create or sync
            another agent before transferring.
          </p>
        </div>
      ) : selectedRecipient ? (
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-gray-500">Owner</span>
            <span className="font-mono text-gray-300 truncate">
              {selectedRecipient.owner}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-gray-500">teeOracle</span>
            <span className="font-mono text-gray-300 truncate">
              {selectedRecipient.teeOracleUrl ?? "-"}
            </span>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
          <p className="text-xs text-amber-300/90">
            Select a recipient agent from Redis.
          </p>
        </div>
      )}
      {!erc8004AgentId || erc8004AgentId === "0" ? (
        <p className="text-xs text-amber-400/80">
          This agent has no linked ERC-8004 identity, so combined transfer is
          unavailable.
        </p>
      ) : null}
      {selectedRecipientMissingOracle && (
        <p className="text-xs text-amber-400/80">
          Selected agent has no teeOracle service.
        </p>
      )}
      <SubmitButton
        isPending={isPending}
        label="Transfer"
        disabled={!canTransferToSelectedAgent}
      />
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
  const [builtServices, setBuiltServices] = useState<ServiceEditorEntry[]>([]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const prepared = await prepareUpdateAgentServices({
            tokenId: agentId,
            servicesJson: builtServices,
          });
          if ("error" in prepared) return { error: prepared.error };
          const { erc8004RegistryAddress, erc8004AgentId, tokenUri } = prepared;

          await switchChain();
          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: erc8004RegistryAddress,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "setAgentURI",
            args: [BigInt(erc8004AgentId), tokenUri],
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
      <ServiceEditorPanel
        initialServices={initialServices}
        onChange={setBuiltServices}
      />

      <SubmitButton isPending={isPending} label="Save Services" />
      <ResultBanner result={result} />
    </form>
  );
}

// ─── Run Oracle ───────────────────────────────────────────────────────────────

type OracleRunResult = {
  agentId: string;
  result: Record<string, unknown>;
  timestamp: number;
  quote: string;
  event_log: string;
};

function RunOracleForm({
  agentId,
  teeOracleUrl,
  onNewRun,
  clientCfg,
}: {
  agentId: string;
  teeOracleUrl: string;
  onNewRun?: (run: CachedOracleRun) => void;
  clientCfg: ActionClientConfig;
}) {
  const { chainId, getViemClients, switchChain } = useWallet();
  const [payloadJson, setPayloadJson] = useState(
    '{\n  "claim": "Was Ethereum above $2000 on January 1st, 2023?"\n}',
  );
  const [isPending, setIsPending] = useState(false);
  const [runResult, setRunResult] = useState<{
    data?: OracleRunResult;
    error?: string;
  } | null>(null);

  const payloadError = validateJsonInput(payloadJson);

  if (!teeOracleUrl) {
    return (
      <p className="text-xs text-amber-400/80">
        No TEE oracle configured — add a{" "}
        <span className="font-mono">teeOracle</span> service URL in{" "}
        <strong>Edit Services</strong> first.
      </p>
    );
  }

  async function handleRun(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (payloadError) return;
    setIsPending(true);
    setRunResult(null);

    try {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(payloadJson) as Record<string, unknown>;
      } catch {
        setRunResult({ error: "Invalid JSON payload." });
        return;
      }

      const trimmedUrl = teeOracleUrl.trim().replace(/\/$/, "");

      // 1. Get oracle address for EIP-712 domain
      const addrRes = await fetch(`${trimmedUrl}/address`);
      if (!addrRes.ok)
        throw new Error(`GET /address failed: ${addrRes.status}`);
      const { address: oracleAddress } = (await addrRes.json()) as {
        address: string;
      };

      // 2. Deadline = now + 5 min
      const deadline = Math.floor(Date.now() / 1000) + 300;

      // 3. Sign EIP-712 RunRequest
      await switchChain();
      const { walletClient } = await getViemClients();
      const actualChainId = walletClient.chain?.id ?? chainId ?? 0;
      const tdRun = buildRunTypedData({
        oracleAddress: oracleAddress as `0x${string}`,
        chainId: actualChainId,
        agentId: BigInt(agentId),
        payload,
        deadline,
      });
      const signature = await walletClient.signTypedData({
        ...tdRun,
        account: walletClient.account!,
      });

      // 5. POST /run
      const res = await fetch(`${trimmedUrl}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          payload,
          signature,
          deadline,
          registryAddress: clientCfg.registryAddress,
        }),
      });
      const data = (await res.json()) as OracleRunResult & { error?: string };
      if (!res.ok || data.error) {
        setRunResult({
          error:
            (data as { error?: string }).error ?? `Oracle error ${res.status}`,
        });
      } else {
        setRunResult({ data });
        // Persist to Redis (best-effort — don't block on failure).
        const cachedRun: CachedOracleRun = {
          oracleAddress,
          payload,
          ...data,
        };
        void recordOracleRun(cachedRun);
        onNewRun?.(cachedRun);
      }
    } catch (err) {
      setRunResult({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleRun(e)} className="space-y-3">
      <p
        className="text-xs text-gray-500 font-mono truncate"
        title={teeOracleUrl}
      >
        oracle: {teeOracleUrl}
      </p>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Payload JSON</label>
        <textarea
          value={payloadJson}
          onChange={(e) => setPayloadJson(e.target.value)}
          rows={6}
          className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 font-mono placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm resize-y"
        />
        {payloadError && (
          <p className="text-xs text-red-400 mt-1">{payloadError}</p>
        )}
      </div>
      <p className="text-xs text-gray-600">
        Your wallet signs an EIP-712 message proving ownership of agent #
        {agentId}. The oracle verifies on-chain ownership before executing.
      </p>
      <SubmitButton isPending={isPending} label="Sign & Run" />
      {runResult?.error && (
        <ErrorBox title="Oracle error" message={runResult.error} />
      )}
    </form>
  );
}

// ─── Oracle run history ──────────────────────────────────────────────────────

function OracleRunCard({
  run,
  agentId,
  erc8004AgentId,
  teeOracleUrl,
  clientCfg,
}: {
  run: CachedOracleRun;
  agentId: string;
  /** ERC-8004 Identity Registry agent ID — used for the validationRequest contract call. */
  erc8004AgentId?: string;
  teeOracleUrl: string;
  clientCfg: ActionClientConfig;
}) {
  const { getViemClients, switchChain } = useWallet();
  const [open, setOpen] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [valError, setValError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    is_valid?: boolean;
    unavailable?: boolean;
    error?: string;
  } | null>(null);

  // Pre-compute the requestHash for this run so we can check if already requested.
  const runMeta = {
    payload: run.payload,
    outcome: run.result.outcome,
    quote: run.quote,
    timestamp: run.timestamp,
    agentId: erc8004AgentId ?? agentId,
  };
  const runRequestHash = runMeta
    ? keccak256(toBytes(JSON.stringify(runMeta)))
    : null;

  const hasOracleSource = !!run.oracleAddress || !!teeOracleUrl;
  const canRequestValidation =
    !!clientCfg.validationRegistryAddress && hasOracleSource;

  const summary = (() => {
    if (run.result.outcome?.verdict) return String(run.result.outcome.verdict);
    if (run.result.outcome?.statusCode)
      return `HTTP ${String(run.result.outcome.statusCode)}`;
    return null;
  })();

  const summaryColor =
    run.result.outcome?.verdict === "YES"
      ? "text-green-400"
      : run.result.outcome?.verdict === "NO"
        ? "text-red-400"
        : "text-gray-400";

  async function handleVerify() {
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const trimmedUrl = teeOracleUrl.trim().replace(/\/$/, "");
      const res = await fetch(`${trimmedUrl}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote: run.quote, event_log: run.event_log }),
      });
      const data = (await res.json()) as {
        is_valid?: boolean;
        unavailable?: boolean;
        detail?: unknown;
        error?: string;
      };
      if (!res.ok) {
        setVerifyResult({
          error: data.error ?? `Verify failed: HTTP ${res.status}`,
        });
      } else {
        setVerifyResult({
          is_valid: data.is_valid,
          unavailable: data.unavailable,
        });
      }
    } catch (err) {
      setVerifyResult({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleRequestValidation(e: React.FormEvent) {
    e.preventDefault();
    if (!runMeta || !runRequestHash) return;
    setIsValidating(true);
    setValError(null);
    try {
      const requestURI = `data:application/json;base64,${btoa(JSON.stringify(runMeta))}`;
      const requestHash = runRequestHash;

      if (!clientCfg.registryAddress)
        throw new Error("AgentRegistry is not configured.");
      if (!clientCfg.validationRegistryAddress)
        throw new Error("ValidationRegistry is not configured.");

      await switchChain();
      const { publicClient, walletClient } = await getViemClients();
      if (!erc8004AgentId)
        throw new Error(
          "Agent is not registered with ERC-8004. Register it before requesting validation.",
        );

      const verifierAddress = (await publicClient.readContract({
        address: clientCfg.registryAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: "verifier",
      })) as Address;
      const teeVerifierAddress = await publicClient.readContract({
        address: verifierAddress,
        abi: VERIFIER_TEE_VERIFIER_ABI,
        functionName: "teeVerifier",
      });

      const txHash = await walletClient.writeContract({
        address: clientCfg.validationRegistryAddress,
        abi: VALIDATION_REGISTRY_ABI,
        functionName: "validationRequest",
        args: [
          teeVerifierAddress,
          BigInt(erc8004AgentId),
          requestURI,
          requestHash,
        ],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setSubmitted(true);
    } catch (err) {
      setValError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsValidating(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex flex-col gap-1.5 px-3 py-2 hover:bg-gray-800/30 transition-colors text-left"
      >
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            <span className="text-xs font-mono text-violet-400 bg-violet-950/40 px-0.5 py-0.5 rounded shrink-0">
              Outcome:
            </span>
            {summary && (
              <span
                className={`text-xs font-semibold shrink-0 ${summaryColor}`}
              >
                {summary}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-gray-600">
              {new Date(run.timestamp * 1000).toLocaleString("en-US")}
            </span>
            <span className="text-gray-500 text-[10px]">
              {open ? "▲" : "▼"}
            </span>
          </div>
        </div>
        {run.payload && Object.keys(run.payload).length > 0 && (
          <div className="w-full rounded bg-gray-900/80 px-2 py-1.5 space-y-0.5">
            {Object.entries(run.payload).map(([k, v]) => (
              <div key={k} className="flex gap-1.5 text-xs font-mono min-w-0">
                <span className="text-violet-400 shrink-0">{k}:</span>
                <span className="text-gray-300 truncate">
                  {typeof v === "object" && v !== null
                    ? JSON.stringify(v)
                    : String(v)}
                </span>
              </div>
            ))}
          </div>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-800 space-y-2">
          {Object.keys(run.result).length > 0 && (
            <pre className="text-xs font-mono text-gray-300 bg-gray-950/60 rounded p-2 overflow-auto max-h-36">
              {JSON.stringify(run.result, null, 2)}
            </pre>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 font-mono">
            {run.oracleAddress && <span>oracle {run.oracleAddress}</span>}
            {run.txHash && <span>tx {run.txHash.slice(0, 18)}</span>}
          </div>
          {run.quote && (
            <div className="flex gap-2">
              <p className="text-xs text-gray-500 break-all font-mono">
                quote: {run.quote.slice(0, 50)}…
              </p>
              {run.event_log && teeOracleUrl && (
                <>
                  <button
                    type="button"
                    disabled={isVerifying}
                    onClick={() => void handleVerify()}
                    className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-[11px] font-medium transition-colors"
                  >
                    {isVerifying ? "…" : "verify"}
                  </button>
                  {verifyResult && (
                    <span
                      className={`shrink-0 text-xs font-semibold ${
                        verifyResult.unavailable
                          ? "text-gray-500"
                          : verifyResult.error
                            ? "text-red-400"
                            : verifyResult.is_valid
                              ? "text-green-400"
                              : "text-yellow-400"
                      }`}
                    >
                      {verifyResult.unavailable
                        ? "n/a"
                        : verifyResult.error
                          ? verifyResult.error
                          : verifyResult.is_valid
                            ? "✓"
                            : "✗"}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          {submitted && (
            <div className="pt-1 border-t border-gray-800">
              <p className="text-xs text-amber-400/70 font-mono">
                submitted — waiting for indexer…
              </p>
            </div>
          )}
          <form
            onSubmit={(e) => void handleRequestValidation(e)}
            className="space-y-2 pt-1"
          >
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isValidating && canRequestValidation}
                className="px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-xs font-medium transition-colors"
              >
                {isValidating ? "Submitting…" : "Validate On-chain"}
              </button>
            </div>
            {valError && <ErrorBox message={valError} />}
          </form>
        </div>
      )}
    </div>
  );
}

function OracleRunHistory({
  runs,
  agentId,
  erc8004AgentId,
  teeOracleUrl,
  clientCfg,
}: {
  runs: CachedOracleRun[];
  agentId: string;
  erc8004AgentId?: string;
  teeOracleUrl: string;
  clientCfg: ActionClientConfig;
}) {
  if (!runs.length) return null;
  return (
    <div className="space-y-1.5">
      {runs.map((run, idx) => (
        <OracleRunCard
          key={`${run.timestamp}-${idx}`}
          run={run}
          agentId={agentId}
          erc8004AgentId={erc8004AgentId}
          teeOracleUrl={teeOracleUrl}
          clientCfg={clientCfg}
        />
      ))}
    </div>
  );
}

// ─── Pending Validations Panel ────────────────────────────────────────────────

function parsePayload(requestURI: string): Record<string, unknown> | null {
  try {
    const prefix = "data:application/json;base64,";
    if (requestURI.startsWith(prefix)) {
      return JSON.parse(atob(requestURI.slice(prefix.length))) as Record<
        string,
        unknown
      >;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function formatUnknown(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function ValidationJobRow({
  job,
  erc8004AgentId,
  oracleUrl,
  onComplete,
  clientCfg,
}: {
  job: PendingValidation;
  erc8004AgentId: string;
  oracleUrl: string;
  onComplete: (
    requestHash: string,
    response: {
      score?: number;
      txHash?: string;
      responseURI?: string;
      responseHash?: string;
      tag?: string;
      reasoning?: string;
      evidence?: Record<string, unknown>;
    } | null,
  ) => void;
  clientCfg: ActionClientConfig;
}) {
  const { chainId, getViemClients } = useWallet();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payload = parsePayload(job.requestURI);
  const trimmedUrl = oracleUrl.trim().replace(/\/$/, "");

  async function handleValidate() {
    if (!payload) {
      setError("Cannot decode payload from requestURI.");
      return;
    }
    setIsProcessing(true);
    setError(null);
    try {
      const { walletClient } = await getViemClients();

      // Fetch the oracle's TEE-derived wallet address for EIP-712 domain.
      // We cannot use job.validatorAddress here — it may be the TEEVerifier contract.
      if (!trimmedUrl) throw new Error("Oracle URL is not configured.");
      const addrRes = await fetch(`${trimmedUrl}/address`);
      if (!addrRes.ok)
        throw new Error(`GET /address failed: ${addrRes.status}`);
      const { address: oracleWallet } = (await addrRes.json()) as {
        address: string;
      };

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tdValidate = buildValidateTypedData({
        oracleAddress: oracleWallet as `0x${string}`,
        chainId: chainId ?? 0,
        erc8004AgentId: BigInt(erc8004AgentId),
        requestHash: job.requestHash as `0x${string}`,
        payload,
        deadline,
      });
      const signature = await walletClient.signTypedData({
        ...tdValidate,
        account: walletClient.account!,
      });

      const res = await fetch(`${trimmedUrl}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          erc8004AgentId,
          requestHash: job.requestHash,
          payload,
          validationRegistryAddress: clientCfg.validationRegistryAddress,
          signature,
          deadline,
        }),
      });

      const data = (await res.json()) as {
        error?: string;
        score?: number;
        txHash?: string;
        reasoning?: string;
        responseURI?: string;
        responseHash?: string;
        tag?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error ?? `Oracle returned HTTP ${res.status}`);
        return;
      }

      onComplete(job.requestHash, {
        score: data.score,
        txHash: data.txHash,
        responseURI: data.responseURI,
        responseHash: data.responseHash,
        tag: data.tag,
        reasoning: data.reasoning,
        evidence: {
          score: data.score,
          reasoning: data.reasoning,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-950/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-mono text-gray-500 truncate">
          {job.requestHash.slice(0, 20)}…
        </p>
        <button
          type="button"
          disabled={isProcessing}
          onClick={() => void handleValidate()}
          className="shrink-0 px-3 py-1 rounded bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-xs font-medium transition-colors"
        >
          {isProcessing ? "Validating…" : "Validate"}
        </button>
      </div>
      {payload && (
        <pre className="text-xs text-gray-400 bg-gray-900/60 rounded p-2 overflow-x-auto max-h-24">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

function PendingValidationsPanel({
  agentId: _agentId,
  erc8004AgentId,
  pending,
  teeOracleUrl,
  onComplete,
  clientCfg,
}: {
  agentId: string;
  erc8004AgentId?: string;
  pending: PendingValidation[];
  teeOracleUrl: string;
  onComplete: (
    requestHash: string,
    response: {
      score?: number;
      txHash?: string;
      responseURI?: string;
      responseHash?: string;
      tag?: string;
      reasoning?: string;
      evidence?: Record<string, unknown>;
    } | null,
  ) => void;
  clientCfg: ActionClientConfig;
}) {
  const oracleUrl = teeOracleUrl.trim().replace(/\/+$/, "");
  const pendingItems = pending.filter((j) => !j.response);
  const completedItems = pending.filter((j) => !!j.response);

  if (!pending.length) {
    return (
      <p className="text-xs text-gray-500">
        No pending validations. Use &ldquo;Request Validation&rdquo; on a run
        above to create one.
      </p>
    );
  }

  if (!erc8004AgentId) {
    return (
      <p className="text-xs text-amber-400/80">
        Agent is not registered with ERC-8004 — register it before validating.
      </p>
    );
  }

  if (!oracleUrl) {
    return (
      <p className="text-xs text-amber-400/80">
        Add a <span className="font-mono">teeOracle</span> service URL before
        sending validation jobs to the oracle.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {pendingItems.length > 0 && (
        <>
          <h4 className="text-sm font-semibold text-gray-300">
            Pending ({pendingItems.length})
          </h4>
          <div className="space-y-2">
            {pendingItems.map((job) => (
              <ValidationJobRow
                key={job.requestHash}
                job={job}
                erc8004AgentId={erc8004AgentId}
                oracleUrl={oracleUrl}
                onComplete={onComplete}
                clientCfg={clientCfg}
              />
            ))}
          </div>
        </>
      )}

      {completedItems.length > 0 && (
        <>
          <h4 className="text-sm font-semibold text-gray-300">
            Completed ({completedItems.length})
          </h4>
          <div className="space-y-2">
            {completedItems.map((job) => {
              const payload = parsePayload(job.requestURI);
              const llmOutcome = payload?.outcome;
              const validationReasoning =
                job.response!.reasoning ??
                (typeof job.response!.evidence?.reasoning === "string"
                  ? job.response!.evidence.reasoning
                  : undefined);
              const scoreColor =
                job.response!.score >= 70
                  ? "text-green-400"
                  : job.response!.score >= 40
                    ? "text-yellow-400"
                    : "text-red-400";
              return (
                <div
                  key={job.requestHash}
                  className="rounded-lg border border-gray-700 bg-gray-950/40 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-mono text-gray-500 truncate">
                      {job.requestHash.slice(0, 20)}…
                    </p>
                    <span
                      className={`text-xs font-semibold shrink-0 ${scoreColor}`}
                    >
                      {job.response!.score}/100
                    </span>
                  </div>
                  {llmOutcome !== undefined && (
                    <div className="rounded bg-gray-900/60 p-2">
                      <p className="text-[11px] font-semibold text-gray-500 mb-1">
                        LLM outcome
                      </p>
                      <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words overflow-x-auto max-h-32">
                        {formatUnknown(llmOutcome)}
                      </pre>
                    </div>
                  )}
                  {validationReasoning && (
                    <div className="rounded bg-gray-900/60 p-2">
                      <p className="text-[11px] font-semibold text-gray-500 mb-1">
                        Validation reasoning
                      </p>
                      <p className="text-xs text-gray-300 whitespace-pre-wrap break-words">
                        {validationReasoning}
                      </p>
                    </div>
                  )}
                  {job.response!.txHash && (
                    <p className="text-[11px] font-mono text-gray-600 truncate">
                      tx {job.response!.txHash}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
