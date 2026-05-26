"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { keccak256 } from "viem";
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
import { prepareFeedback } from "@/lib/actions/registry";

interface Props {
  agentId: string;
  registryAddress?: `0x${string}`;
  reputationAddress?: `0x${string}`;
  validationAddress?: `0x${string}`;
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
  validationAddress,
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

            <ActionCard
              title="Run Oracle"
              description="Sign an EIP-712 message as the agent owner and invoke the TEE oracle."
              className="md:col-span-2"
            >
              <RunOracleForm
                agentId={agentId}
                registryAddress={registryAddress}
              />
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
              <ValidationForm
                agentId={agentId}
                registryAddress={registryAddress}
                validationAddress={validationAddress}
              />
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
        EIP-8004 services. Fill in the endpoints you support.
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

type ValidationResult = {
  score?: number;
  result?: Record<string, unknown>;
  proof?: string;
  txHash?: string;
  error?: string;
};

function ValidationForm({
  agentId,
  registryAddress,
  validationAddress,
}: {
  agentId: string;
  registryAddress?: `0x${string}`;
  validationAddress?: `0x${string}`;
}) {
  const { chainId, getViemClients, switchChain } = useWallet();
  const [oracleUrl, setOracleUrl] = useState(
    () => process.env.NEXT_PUBLIC_ORACLE_URL ?? "",
  );
  const [payloadJson, setPayloadJson] = useState(
    '{\n  "claim": "Your claim here"\n}',
  );
  const [isPending, setIsPending] = useState(false);
  const [valResult, setValResult] = useState<ValidationResult | null>(null);

  const payloadError = validateJsonInput(payloadJson);

  async function handleValidate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (payloadError) return;
    setIsPending(true);
    setValResult(null);

    try {
      if (!validationAddress) {
        setValResult({ error: "Validation registry is not configured." });
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(payloadJson) as Record<string, unknown>;
      } catch {
        setValResult({ error: "Invalid JSON payload." });
        return;
      }

      const trimmedUrl = oracleUrl.trim().replace(/\/$/, "");
      if (!trimmedUrl) {
        setValResult({ error: "Oracle URL is required." });
        return;
      }

      // 1. Get oracle address — this becomes the validatorAddress on-chain
      const addrRes = await fetch(`${trimmedUrl}/address`);
      if (!addrRes.ok)
        throw new Error(`GET /address failed: ${addrRes.status}`);
      const { address: oracleAddress } = (await addrRes.json()) as {
        address: string;
      };

      // 2. requestHash = keccak256 of the canonical payload JSON
      //    payloadHash commits payload into the EIP-712 signature
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      const requestHash = keccak256(payloadBytes);
      const payloadHash = requestHash;

      // 3. Sign EIP-712 ValidateRequest
      const deadline = Math.floor(Date.now() / 1000) + 300;
      await switchChain();
      const { publicClient, walletClient } = await getViemClients();
      const signature = await walletClient.signTypedData({
        domain: {
          name: "ArcaneAgentsOracle",
          version: "1",
          chainId: BigInt(chainId ?? 0),
          verifyingContract: oracleAddress as `0x${string}`,
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
          requestHash,
          payloadHash,
          deadline: BigInt(deadline),
        },
        account: walletClient.account!,
      });

      // 4. Open the validation request on-chain
      const requestTxHash = await walletClient.writeContract({
        address: validationAddress,
        abi: VALIDATION_REGISTRY_ABI,
        functionName: "validationRequest",
        args: [
          oracleAddress as `0x${string}`,
          BigInt(agentId),
          "",
          requestHash,
        ],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      await publicClient.waitForTransactionReceipt({ hash: requestTxHash });

      // 5. Call oracle /validate — oracle runs the skill and closes the request on-chain
      const res = await fetch(`${trimmedUrl}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          requestHash,
          payload,
          validationRegistryAddress: validationAddress,
          registryAddress,
          signature,
          deadline,
        }),
      });
      const data = (await res.json()) as ValidationResult;
      if (!res.ok || data.error) {
        setValResult({
          error: data.error ?? `Oracle error ${res.status}`,
        });
      } else {
        setValResult(data);
      }
    } catch (err) {
      setValResult({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleValidate(e)} className="space-y-3">
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
      <div>
        <label className="block text-xs text-gray-400 mb-1">Payload JSON</label>
        <textarea
          value={payloadJson}
          onChange={(e) => setPayloadJson(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 font-mono placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm resize-y"
        />
        {payloadError && (
          <p className="text-xs text-red-400 mt-1">{payloadError}</p>
        )}
      </div>
      <p className="text-xs text-gray-600">
        The oracle runs your agent&apos;s skill on the payload and posts the
        score to ValidationRegistry. You sign ownership proof; the oracle
        computes the result.
      </p>
      <SubmitButton isPending={isPending} label="Sign & Validate" />
      {valResult?.error && (
        <p className="text-xs text-red-400 bg-red-950/40 px-3 py-2 rounded-lg">
          {valResult.error}
        </p>
      )}
      {valResult && !valResult.error && (
        <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">Score</span>
            <span
              className={`px-3 py-1 rounded-full text-sm font-bold border ${
                (valResult.score ?? 0) >= 70
                  ? "text-green-400 bg-green-950/40 border-green-900"
                  : (valResult.score ?? 0) >= 40
                    ? "text-yellow-400 bg-yellow-950/40 border-yellow-900"
                    : "text-red-400 bg-red-950/40 border-red-900"
              }`}
            >
              {valResult.score ?? "—"} / 100
            </span>
          </div>
          {valResult.result && (
            <pre className="text-xs font-mono text-gray-300 bg-gray-950/60 rounded p-3 overflow-auto max-h-40">
              {JSON.stringify(valResult.result, null, 2)}
            </pre>
          )}
          {valResult.txHash && (
            <p className="text-xs text-gray-500 font-mono break-all">
              tx: {valResult.txHash}
            </p>
          )}
          {valResult.proof && (
            <details>
              <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 select-none">
                TEE proof
              </summary>
              <p className="mt-1.5 text-xs font-mono text-gray-500 break-all bg-gray-950/60 rounded p-2">
                {valResult.proof}
              </p>
            </details>
          )}
        </div>
      )}
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
}: {
  agentId: string;
  registryAddress?: `0x${string}`;
}) {
  const { chainId, getViemClients, switchChain } = useWallet();
  const [oracleUrl, setOracleUrl] = useState(
    () => process.env.NEXT_PUBLIC_ORACLE_URL ?? "",
  );
  const [payloadJson, setPayloadJson] = useState(
    '{\n  "claim": "Was Ethereum above $2000 on January 1st, 2023?"\n}',
  );
  const [isPending, setIsPending] = useState(false);
  const [runResult, setRunResult] = useState<{
    data?: OracleRunResult;
    error?: string;
  } | null>(null);

  const payloadError = validateJsonInput(payloadJson);

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

      const trimmedUrl = oracleUrl.trim().replace(/\/$/, "");
      if (!trimmedUrl) {
        setRunResult({ error: "Oracle URL is required." });
        return;
      }

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
          name: "ArcaneAgentsOracle",
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
        setRunResult({ data: data as OracleRunResult });
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
        <div className="text-xs text-red-400 bg-red-950/40 px-3 py-2 rounded-lg space-y-1">
          <p className="font-semibold">Oracle error</p>
          <pre className="whitespace-pre-wrap break-all font-mono text-red-300">
            {runResult.error}
          </pre>
        </div>
      )}
      {runResult?.data && <OracleResultCard result={runResult.data} />}
    </form>
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
