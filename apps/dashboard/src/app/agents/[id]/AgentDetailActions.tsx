"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { keccak256 } from "viem";
import type { AgentService } from "@tee-agent/agent/types";
import {
  AGENT_REGISTRY_ABI,
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
} from "@tee-agent/agent/abis";
import { useWallet } from "@/components/wallet/WalletProvider";
import {
  prepareTransferAgent,
  prepareUpdateAgentServices,
  recordOracleRun,
  markValidationComplete,
  fetchPendingValidationsForAgent,
  markRunValidationRequested,
} from "@/lib/actions/agents";
import { prepareFeedback } from "@/lib/actions/registry";
import type { PendingValidation, CachedOracleRun } from "@/lib/agent-cache";
import {
  ServiceEditorPanel,
  type ServiceEditorEntry,
} from "@/components/ServiceEditorPanel";
import { ErrorBox } from "@/components/ErrorBox";
import { clientCfg } from "@/lib/client-config";

interface Props {
  agentId: string;
  owner: string;
  initialServices: readonly AgentService[];
  initialRuns?: CachedOracleRun[];
  initialPendingValidations?: PendingValidation[];
}

export default function AgentDetailActions({
  agentId,
  owner,
  initialServices,
  initialRuns,
  initialPendingValidations,
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
  function removePending(requestHash: string) {
    setPending((prev) => prev.filter((j) => j.requestHash !== requestHash));
  }
  function updateRunValidation(timestamp: number, requestHash: string) {
    setRuns((prev) =>
      prev.map((r) =>
        r.timestamp === timestamp
          ? { ...r, validationRequestHash: requestHash }
          : r,
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
            teeOracleUrl={teeOracleUrl}
            onValidationRequested={updateRunValidation}
          />
          {runs.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-800" />
          )}
          <RunOracleForm
            agentId={agentId}
            teeOracleUrl={teeOracleUrl}
            onNewRun={addRun}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title="Pending Validations"
          description="Sign and send queued validation requests to the oracle."
          className="md:col-span-2"
        >
          <PendingValidationsPanel
            agentId={agentId}
            pending={pending}
            onComplete={(requestHash, run) => {
              removePending(requestHash);
              if (run) addRun(run);
            }}
            onRefresh={async () => {
              const fresh = await fetchPendingValidationsForAgent(agentId);
              setPending(fresh);
            }}
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
                <TransferForm tokenId={agentId} />
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
        <FeedbackForm agentId={agentId} />
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

function FeedbackForm({ agentId }: { agentId: string }) {
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
          if (!clientCfg.reputationAddress)
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
            address: clientCfg.reputationAddress,
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
        const rawFormData = new FormData(e.currentTarget);
        run(async () => {
          await switchChain();
          const { publicClient, walletClient } = await getViemClients();

          // 1. Fetch the oracle's address + public key for EIP-712 domain.
          const oracleUrl =
            process.env.NEXT_PUBLIC_ORACLE_URL ?? "http://localhost:3001";
          const addrRes = await fetch(`${oracleUrl}/address`);
          if (!addrRes.ok) {
            return {
              error: `Could not reach oracle at ${oracleUrl}/address (${addrRes.status})`,
            };
          }
          const { address: oracleAddress } = (await addrRes.json()) as {
            address: string;
            publicKey?: string;
          };

          // 2. Sign the EIP-712 ReencryptRequest so the oracle can verify ownership.
          const chainId = await publicClient.getChainId();
          const deadline = Math.floor(Date.now() / 1000) + 3600;
          const oracleSignature = await walletClient.signTypedData({
            account: walletClient.account!,
            domain: {
              name: "TeeAgentOracle",
              version: "1",
              chainId,
              verifyingContract: oracleAddress as `0x${string}`,
            },
            types: {
              ReencryptRequest: [
                { name: "tokenId", type: "uint256" },
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "deadline", type: "uint256" },
              ],
            },
            primaryType: "ReencryptRequest",
            message: {
              tokenId: BigInt(tokenId),
              from: walletClient.account!.address,
              to: (rawFormData.get("to") as string).trim() as `0x${string}`,
              deadline: BigInt(deadline),
            },
          });

          // 3. Prepare transfer via server action (oracle call happens inside).
          const formData = new FormData();
          formData.set("tokenId", tokenId);
          formData.set("to", rawFormData.get("to") as string);
          formData.set(
            "newOwnerPublicKey",
            rawFormData.get("newOwnerPublicKey") as string,
          );
          formData.set("oracleSignature", oracleSignature);
          formData.set("oracleDeadline", String(deadline));
          const prepared = await prepareTransferAgent(formData);
          if (prepared.error) return { error: prepared.error };

          const accessPayloads = prepared.accessPayloads ?? [];
          const ownershipProofs = prepared.ownershipProofs ?? [];
          const from = prepared.from!;
          const to = prepared.to!;
          const tId = BigInt(prepared.tokenId!);
          const deadlineBig = prepared.deadline!;

          // 4. Sign each access proof (recipient acknowledgement of blob hash).
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
              tokenId: tId,
              deadline: deadlineBig,
            })),
          );

          const hash = await walletClient.writeContract({
            address: prepared.contractAddress!,
            abi: AGENT_REGISTRY_ABI,
            functionName: "iTransferFrom",
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
      <Field label="Recipient Address *" name="to" placeholder="0x…" required />
      <Field
        label="Recipient Public Key *"
        name="newOwnerPublicKey"
        placeholder="0x02… (compressed secp256k1)"
        required
      />
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
  const [builtServices, setBuiltServices] = useState<ServiceEditorEntry[]>([]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData();
        formData.set("tokenId", agentId);
        formData.set("servicesJson", JSON.stringify(builtServices));
        run(async () => {
          const prepared = await prepareUpdateAgentServices(formData);
          if (prepared.error !== undefined) return { error: prepared.error };
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

function AuthorizeUsageForm({ tokenId }: { tokenId: string }) {
  const { isPending, result, run } = useActionState();
  const { getViemClients, switchChain } = useWallet();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          if (!clientCfg.registryAddress)
            return { error: "Agent registry is not configured." };
          const formData = new FormData(e.currentTarget);
          const user = (formData.get("user") as string | null)?.trim() as
            | `0x${string}`
            | undefined;
          if (!user) return { error: "User address is required." };

          await switchChain();
          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: clientCfg.registryAddress,
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

function RevokeAuthForm({ tokenId }: { tokenId: string }) {
  const { isPending, result, run } = useActionState();
  const { getViemClients, switchChain } = useWallet();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          if (!clientCfg.registryAddress)
            return { error: "Agent registry is not configured." };
          await switchChain();
          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: clientCfg.registryAddress,
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

// ─── Run Oracle ───────────────────────────────────────────────────────────────

type OracleRunResult = {
  agentId: string;
  type: string;
  result: Record<string, unknown>;
  timestamp: number;
  signature: string;
};

function RunOracleForm({
  agentId,
  teeOracleUrl,
  onNewRun,
}: {
  agentId: string;
  teeOracleUrl: string;
  onNewRun?: (run: CachedOracleRun) => void;
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

      // 3. payloadHash = keccak256(UTF-8 bytes of JSON.stringify(payload))
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      const payloadHash = keccak256(payloadBytes);

      // 4. Sign EIP-712 RunRequest
      await switchChain();
      const { walletClient } = await getViemClients();
      const actualChainId = walletClient.chain?.id ?? chainId ?? 0;
      const signature = await walletClient.signTypedData({
        domain: {
          name: "TeeAgentOracle",
          version: "1",
          chainId: BigInt(actualChainId),
          verifyingContract: oracleAddress as `0x${string}`,
        },
        types: {
          RunRequest: [
            { name: "agentId", type: "uint256" },
            { name: "payloadHash", type: "bytes32" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "RunRequest",
        message: {
          agentId: BigInt(agentId),
          payloadHash,
          deadline: BigInt(deadline),
        },
        account: walletClient.account!,
      });

      // 5. POST /run
      const res = await fetch(`${trimmedUrl}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, payload, signature, deadline }),
      });
      const data = (await res.json()) as OracleRunResult & { error?: string };
      if (!res.ok || data.error) {
        setRunResult({
          error:
            (data as { error?: string }).error ?? `Oracle error ${res.status}`,
        });
      } else {
        const run = data as OracleRunResult;
        setRunResult({ data: run });
        // Persist to Redis (best-effort — don't block on failure).
        const cachedRun: CachedOracleRun = {
          agentId,
          kind: "run",
          type: run.type,
          result: run.result,
          payload,
          proof: run.signature,
          timestamp: run.timestamp,
          oracleAddress,
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
      {runResult?.data && <OracleResultCard result={runResult.data} />}
    </form>
  );
}

// ─── Oracle run history ──────────────────────────────────────────────────────

function OracleRunCard({
  run,
  agentId,
  teeOracleUrl,
  onValidationRequested,
}: {
  run: CachedOracleRun;
  agentId: string;
  teeOracleUrl: string;
  onValidationRequested: (timestamp: number, requestHash: string) => void;
}) {
  const { getViemClients, switchChain } = useWallet();
  const [open, setOpen] = useState(false);
  const [showValidate, setShowValidate] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [valError, setValError] = useState<string | null>(null);

  // Validation is possible if:
  // - this is a run (not a validate record), not yet requested
  // - a validation registry is configured
  // - we have an oracle address (cached from run) or a teeOracle service URL to look one up
  const hasOracleSource = !!run.oracleAddress || !!teeOracleUrl;
  const canRequestValidation =
    run.kind === "run" &&
    !run.validationRequestHash &&
    !!clientCfg.validationAddress &&
    hasOracleSource;

  const summary = (() => {
    if (run.kind === "validate" && run.score !== undefined)
      return `Score ${run.score}/100`;
    if (run.result.verdict) return String(run.result.verdict);
    if (run.result.statusCode) return `HTTP ${String(run.result.statusCode)}`;
    return null;
  })();

  const summaryColor =
    run.score !== undefined
      ? run.score >= 70
        ? "text-green-400"
        : run.score >= 40
          ? "text-yellow-400"
          : "text-red-400"
      : run.result.verdict === "YES"
        ? "text-green-400"
        : run.result.verdict === "NO"
          ? "text-red-400"
          : "text-gray-400";

  async function handleRequestValidation(e: React.FormEvent) {
    e.preventDefault();
    setIsValidating(true);
    setValError(null);
    try {
      // requestURI encodes the run result + proof so the validating oracle has
      // everything it needs without the caller knowing the original input payload.
      const runMeta = {
        type: run.type,
        result: run.result,
        proof: run.proof,
        timestamp: run.timestamp,
        agentId,
      };
      const requestURI = `data:application/json;base64,${btoa(JSON.stringify(runMeta))}`;
      // requestHash = keccak256(run.proof) — stable unique ID for this run.
      const requestHash = keccak256(run.proof as `0x${string}`);

      // Prefer the oracle address cached from the original run; fall back to teeOracle service.
      let oracleAddress: string;
      if (run.oracleAddress) {
        oracleAddress = run.oracleAddress;
      } else {
        const trimmedUrl = teeOracleUrl.trim().replace(/\/$/, "");
        if (!trimmedUrl)
          throw new Error(
            "No oracle address cached and no teeOracle service configured.",
          );
        const addrRes = await fetch(`${trimmedUrl}/address`);
        if (!addrRes.ok)
          throw new Error(`GET /address failed: ${addrRes.status}`);
        ({ address: oracleAddress } = (await addrRes.json()) as {
          address: string;
        });
      }

      await switchChain();
      const { publicClient, walletClient } = await getViemClients();
      const txHash = await walletClient.writeContract({
        address: clientCfg.validationAddress!,
        abi: VALIDATION_REGISTRY_ABI,
        functionName: "validationRequest",
        args: [
          oracleAddress as `0x${string}`,
          BigInt(agentId),
          requestURI,
          requestHash,
        ],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      void markRunValidationRequested(agentId, run.timestamp, requestHash);
      onValidationRequested(run.timestamp, requestHash);
      setShowValidate(false);
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
        className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-800/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <span className="text-xs font-mono text-violet-400 bg-violet-950/40 px-1.5 py-0.5 rounded shrink-0">
            {run.type}
          </span>
          {run.kind === "validate" && (
            <span className="text-xs text-blue-400 border border-blue-900 bg-blue-950/30 px-1.5 py-0.5 rounded shrink-0">
              validate
            </span>
          )}
          {run.validationRequestHash && (
            <span className="text-xs text-amber-400 border border-amber-900/50 bg-amber-950/30 px-1.5 py-0.5 rounded shrink-0">
              validation pending
            </span>
          )}
          {summary && (
            <span className={`text-xs font-semibold shrink-0 ${summaryColor}`}>
              {summary}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-600">
            {new Date(run.timestamp * 1000).toLocaleString("en-US")}
          </span>
          <span className="text-gray-500 text-[10px]">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-800 space-y-2">
          {Object.keys(run.result).length > 0 && (
            <pre className="text-xs font-mono text-gray-300 bg-gray-950/60 rounded p-2 overflow-auto max-h-36">
              {JSON.stringify(run.result, null, 2)}
            </pre>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 font-mono">
            {run.oracleAddress && (
              <span>oracle {run.oracleAddress.slice(0, 10)}…</span>
            )}
            {run.runBy && <span>by {run.runBy.slice(0, 10)}…</span>}
            {run.txHash && <span>tx {run.txHash.slice(0, 18)}…</span>}
          </div>
          {run.proof && (
            <details>
              <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 select-none">
                TEE proof
              </summary>
              <p className="mt-1 text-xs font-mono text-gray-500 break-all bg-gray-950/60 rounded p-2">
                {run.proof}
              </p>
            </details>
          )}
          {run.validationRequestHash && (
            <div className="pt-1 border-t border-gray-800">
              <p className="text-xs text-amber-400/70 font-mono">
                validation requested · {run.validationRequestHash.slice(0, 20)}…
              </p>
            </div>
          )}
          {canRequestValidation && (
            <div className="pt-1 border-t border-gray-800">
              {!showValidate ? (
                <button
                  type="button"
                  onClick={() => setShowValidate(true)}
                  className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                >
                  + Request Validation
                </button>
              ) : (
                <form
                  onSubmit={(e) => void handleRequestValidation(e)}
                  className="space-y-2 pt-1"
                >
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={isValidating}
                      className="px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-xs font-medium transition-colors"
                    >
                      {isValidating ? "Submitting…" : "Submit On-chain"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowValidate(false);
                        setValError(null);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600 text-xs text-gray-400 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                  {valError && <ErrorBox message={valError} />}
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OracleRunHistory({
  runs,
  agentId,
  teeOracleUrl,
  onValidationRequested,
}: {
  runs: CachedOracleRun[];
  agentId: string;
  teeOracleUrl: string;
  onValidationRequested: (timestamp: number, requestHash: string) => void;
}) {
  if (!runs.length) return null;
  return (
    <div className="space-y-1.5">
      {runs.map((run, idx) => (
        <OracleRunCard
          key={`${run.timestamp}-${idx}`}
          run={run}
          agentId={agentId}
          teeOracleUrl={teeOracleUrl}
          onValidationRequested={onValidationRequested}
        />
      ))}
    </div>
  );
}

function OracleResultCard({ result }: { result: OracleRunResult }) {
  const { type, result: data, timestamp, signature } = result;

  function renderResult() {
    if (type === "prediction-verifier") {
      const r = data as {
        verdict?: string;
        confidence?: number;
        reasoning?: string;
      };
      const verdictStyle =
        r.verdict === "YES"
          ? "text-green-400 bg-green-950/40 border-green-900"
          : r.verdict === "NO"
            ? "text-red-400 bg-red-950/40 border-red-900"
            : "text-gray-400 bg-gray-800 border-gray-700";
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-sm font-bold border ${verdictStyle}`}
            >
              {r.verdict}
            </span>
            <span className="text-sm text-gray-400">
              Confidence:{" "}
              <span className="text-white font-semibold">{r.confidence}%</span>
            </span>
          </div>
          {r.reasoning && (
            <p className="text-sm text-gray-300 leading-relaxed">
              {r.reasoning}
            </p>
          )}
        </div>
      );
    }

    if (type === "web-fetcher") {
      const r = data as {
        url?: string;
        statusCode?: number;
        value?: string;
        contentHash?: string;
        llmAnalysis?: string;
      };
      return (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
                (r.statusCode ?? 0) < 400
                  ? "bg-green-950/40 text-green-400"
                  : "bg-red-950/40 text-red-400"
              }`}
            >
              {r.statusCode}
            </span>
            <span className="text-gray-500 truncate font-mono text-xs">
              {r.url}
            </span>
          </div>
          {r.value && (
            <p className="text-gray-200 font-mono text-xs bg-gray-950/60 rounded p-2 overflow-auto max-h-32">
              {r.value}
            </p>
          )}
          {r.llmAnalysis && (
            <p className="text-gray-300 text-sm">{r.llmAnalysis}</p>
          )}
        </div>
      );
    }

    return (
      <pre className="text-xs font-mono text-gray-300 bg-gray-950/60 rounded p-3 overflow-auto max-h-48">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-violet-400 bg-violet-950/40 px-2 py-0.5 rounded">
          {type}
        </span>
        <span className="text-xs text-gray-600">
          {new Date(timestamp * 1000).toLocaleTimeString()}
        </span>
      </div>
      {renderResult()}
      <details className="mt-1">
        <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 select-none">
          TEE proof
        </summary>
        <p className="mt-1.5 text-xs font-mono text-gray-500 break-all bg-gray-950/60 rounded p-2">
          {signature}
        </p>
      </details>
    </div>
  );
}

// ─── Pending Validations Panel ────────────────────────────────────────────────

function PendingValidationsPanel({
  agentId,
  pending,
  onComplete,
  onRefresh,
}: {
  agentId: string;
  pending: PendingValidation[];
  onComplete: (requestHash: string, run: CachedOracleRun | null) => void;
  onRefresh: () => Promise<void>;
}) {
  const { chainId, getViemClients } = useWallet();
  const [oracleUrl, setOracleUrl] = useState(() => clientCfg.oracleUrl);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [results, setResults] = useState<
    Record<string, { score?: number; txHash?: string; error?: string }>
  >({});

  if (!pending.length) {
    return (
      <p className="text-xs text-gray-500">
        No pending validations. Use &ldquo;Request Validation&rdquo; on a run
        above to create one.
      </p>
    );
  }

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

  async function handleValidateAll(e: React.FormEvent) {
    e.preventDefault();
    if (!pending.length || isProcessing) return;
    setIsProcessing(true);

    const { walletClient } = await getViemClients();
    const trimmedUrl = oracleUrl.trim().replace(/\/$/, "");

    for (const job of pending) {
      const payload = parsePayload(job.requestURI);
      if (!payload) {
        setResults((r) => ({
          ...r,
          [job.requestHash]: {
            error: "Cannot decode payload from requestURI.",
          },
        }));
        continue;
      }

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const payloadHash = keccak256(
        new TextEncoder().encode(JSON.stringify(payload)),
      );

      try {
        const signature = await walletClient.signTypedData({
          domain: {
            name: "TeeAgentOracle",
            version: "1",
            chainId: BigInt(chainId ?? 0),
            verifyingContract: job.validatorAddress as `0x${string}`,
          },
          types: {
            ValidateRequest: [
              { name: "agentId", type: "uint256" },
              { name: "requestHash", type: "bytes32" },
              { name: "payloadHash", type: "bytes32" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: "ValidateRequest",
          message: {
            agentId: BigInt(agentId),
            requestHash: job.requestHash as `0x${string}`,
            payloadHash,
            deadline: BigInt(deadline),
          },
          account: walletClient.account!,
        });

        const res = await fetch(`${trimmedUrl}/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId,
            requestHash: job.requestHash,
            payload,
            validationRegistryAddress: clientCfg.validationAddress,
            registryAddress: clientCfg.registryAddress,
            signature,
            deadline,
          }),
        });

        type OracleValidateResponse = {
          score?: number;
          result?: Record<string, unknown>;
          proof?: string;
          txHash?: string;
          error?: string;
        };
        const data = (await res.json()) as OracleValidateResponse;

        if (!res.ok || data.error) {
          setResults((r) => ({
            ...r,
            [job.requestHash]: {
              error: data.error ?? `Oracle returned HTTP ${res.status}`,
            },
          }));
          continue;
        }

        const run: CachedOracleRun = {
          agentId,
          kind: "validate",
          type: "validation",
          result: data.result ?? {},
          score: data.score,
          proof: data.proof ?? "",
          timestamp: Math.floor(Date.now() / 1000),
          txHash: data.txHash,
        };
        await markValidationComplete(agentId, job.requestHash, run);
        setResults((r) => ({
          ...r,
          [job.requestHash]: { score: data.score, txHash: data.txHash },
        }));
        onComplete(job.requestHash, run);
      } catch (err) {
        setResults((r) => ({
          ...r,
          [job.requestHash]: {
            error: err instanceof Error ? err.message : "Failed.",
          },
        }));
      }
    }

    setIsProcessing(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-300">
          Pending Validations ({pending.length})
        </h4>
        <button
          type="button"
          disabled={isRefreshing}
          onClick={async () => {
            setIsRefreshing(true);
            await onRefresh();
            setIsRefreshing(false);
          }}
          className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50 transition-colors"
        >
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="space-y-2">
        {pending.map((job) => {
          const payload = parsePayload(job.requestURI);
          const jobResult = results[job.requestHash];
          return (
            <div
              key={job.requestHash}
              className="rounded-lg border border-gray-700 bg-gray-950/40 p-3 space-y-2"
            >
              <p className="text-xs font-mono text-gray-500 break-all">
                {job.requestHash.slice(0, 20)}…
              </p>
              {payload && (
                <pre className="text-xs text-gray-400 bg-gray-900/60 rounded p-2 overflow-x-auto max-h-24">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              )}
              {jobResult && (
                <p
                  className={`text-xs ${
                    jobResult.error ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {jobResult.error
                    ? jobResult.error
                    : `Score: ${jobResult.score ?? "n/a"}${jobResult.txHash ? ` · tx: ${jobResult.txHash.slice(0, 12)}…` : ""}`}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => void handleValidateAll(e)}
        className="space-y-3 pt-1"
      >
        <div>
          <label className="block text-xs text-gray-400 mb-1">Oracle URL</label>
          <input
            type="url"
            value={oracleUrl}
            onChange={(e) => setOracleUrl(e.target.value)}
            placeholder="https://your-cvm.phala.network"
            required
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={!pending.length || isProcessing}
          className="w-full px-4 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          {isProcessing ? "Validating…" : `Validate All (${pending.length})`}
        </button>
      </form>
    </div>
  );
}
