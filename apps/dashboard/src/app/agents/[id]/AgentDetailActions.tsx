"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { keccak256, toBytes } from "viem";
import type { AgentService } from "@tee-agent/agent/types";
import {
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
} from "@tee-agent/agent/abis";
import { buildRunTypedData } from "@tee-agent/agent/typed-data";
import { useWallet } from "@/components/wallet/WalletProvider";
import {
  prepareUpdateAgentServices,
  recordOracleRun,
} from "@/lib/actions/agents";
import { prepareFeedback } from "@/lib/actions/registry";
import type { CachedOracleRun } from "@/lib/agent-cache";
import type { ValidationResponse } from "@/lib/actions/agents";
import {
  ServiceEditorPanel,
  type ServiceEditorEntry,
} from "@/components/ServiceEditorPanel";
import { ErrorBox } from "@/components/ErrorBox";
import { TransferForm } from "./TransferForm";
import {
  BackgroundActionModal,
  Field,
  ResultBanner,
  SubmitButton,
  useActionState,
  validateJsonInput,
} from "./action-ui";
import type { ActionClientConfig } from "./action-types";

interface Props {
  agentId: string;
  /** ERC-8004 Identity Registry agent ID — used for ValidationRegistry calls. */
  erc8004AgentId?: string;
  owner: string;
  initialServices: readonly AgentService[];
  initialRuns?: CachedOracleRun[];
  initialValidationResponses?: ValidationResponse[];
  clientCfg: ActionClientConfig;
}

export default function AgentDetailActions({
  agentId,
  erc8004AgentId,
  owner,
  initialServices,
  initialRuns,
  initialValidationResponses,
  clientCfg,
}: Props) {
  const { address } = useWallet();
  const isOwner = !!address && address.toLowerCase() === owner.toLowerCase();
  const [runs, setRuns] = useState<CachedOracleRun[]>(initialRuns ?? []);
  const validationResponses = initialValidationResponses ?? [];
  const [feedbackDraftValidation, setFeedbackDraftValidation] =
    useState<CompletedValidationSummary>();
  function addRun(run: CachedOracleRun) {
    setRuns((prev) => [run, ...prev]);
  }
  const teeOracleUrl =
    initialServices.find((s) => s.name === "teeOracle")?.endpoint ?? "";
  const completedValidationCount = validationResponses.length;
  const runDisabledReason = !address
    ? "Connect the owner wallet to run this oracle."
    : !isOwner
      ? "Only the current agent owner can run this oracle."
      : undefined;
  const feedbackDisabledReason = !address
    ? "Connect a non-owner wallet to give feedback."
    : isOwner
      ? "Owners cannot give feedback to their own agent."
      : undefined;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-100">
            Run, Validate, Feedback
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Run the oracle, verify the TEE proof when needed, request validation
            on a specific run, then submit ERC-8004 feedback.
          </p>
        </div>

        <ProcessActionStep
          step="1"
          title="Run your oracle with a claim"
          accessLabel="Owner only"
          status={
            isOwner
              ? runs.length > 0
                ? `${runs.length} run${runs.length === 1 ? "" : "s"}`
                : "ready"
              : address
                ? "owner only"
                : "connect owner"
          }
        >
          <RunOracleForm
            agentId={agentId}
            erc8004AgentId={erc8004AgentId}
            teeOracleUrl={teeOracleUrl}
            canRun={isOwner}
            runDisabledReason={runDisabledReason}
            onNewRun={addRun}
          />
        </ProcessActionStep>

        <ProcessActionStep
          step="2"
          title="Pick a run to validate"
          accessLabel="Any wallet"
          status={runs.length > 0 ? "available" : "after run"}
        >
          {runs.length > 0 ? (
            <OracleRunHistory
              runs={runs}
              erc8004AgentId={erc8004AgentId}
              teeOracleUrl={teeOracleUrl}
              clientCfg={clientCfg}
              validationResponses={validationResponses}
            />
          ) : (
            <p className="text-xs text-gray-500">
              Run the oracle first. Each run will show its proof and validation
              controls here.
            </p>
          )}
        </ProcessActionStep>

        <ProcessActionStep
          step="3"
          title="Validation results"
          accessLabel="Oracle"
          status={
            completedValidationCount > 0
              ? `${completedValidationCount} complete`
              : "after validation"
          }
        >
          <p className="text-xs text-gray-500">
            Completed ValidationResponse events appear here with the matching
            run output when we still have that run locally.
          </p>
          <ValidationResponsesPanel
            responses={validationResponses}
            runs={runs}
            erc8004AgentId={erc8004AgentId}
            onUseForFeedback={(response) =>
              setFeedbackDraftValidation(
                completedValidationFromResponse(response),
              )
            }
            canUseForFeedback={!feedbackDisabledReason}
            feedbackDisabledReason={feedbackDisabledReason}
          />
        </ProcessActionStep>

        <ProcessActionStep
          step="4"
          title="Give feedback from the validation"
          accessLabel="Wallet"
          status={
            isOwner
              ? "self-review disabled"
              : !address
                ? "connect wallet"
                : feedbackDraftValidation
                  ? `${feedbackDraftValidation.score}/100`
                  : "after validation"
          }
        >
          <FeedbackForm
            erc8004AgentId={erc8004AgentId}
            clientCfg={clientCfg}
            prefillValidation={feedbackDraftValidation}
            canSubmitFeedback={!feedbackDisabledReason}
            feedbackDisabledReason={feedbackDisabledReason}
          />
        </ProcessActionStep>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  clientCfg={clientCfg}
                />
              </div>

              <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                      Oracle Key
                    </h4>
                    <p
                      className="text-xs text-gray-500 font-mono truncate"
                      title={teeOracleUrl}
                    >
                      {teeOracleUrl || "No teeOracle service"}
                    </p>
                  </div>
                  <span className="text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 shrink-0">
                    Coming soon
                  </span>
                </div>
                <button
                  type="button"
                  disabled
                  className="px-4 py-2 rounded-lg bg-gray-800 text-gray-500 text-sm font-semibold cursor-not-allowed"
                >
                  Rotate Oracle
                </button>
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
    </div>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

type CompletedValidationSummary = {
  requestHash: string;
  score: number;
  txHash?: string;
  responseURI?: string;
  responseHash?: string;
  tag?: string;
  reasoning?: string;
  evidence?: Record<string, unknown>;
};

function completedValidationFromResponse(
  response: ValidationResponse,
): CompletedValidationSummary {
  return {
    requestHash: response.requestHash,
    score: response.score,
    txHash: response.txHash,
    responseURI: response.responseURI,
    responseHash: response.responseHash,
    tag: response.tag,
    reasoning:
      response.reasoning ??
      (typeof response.evidence?.reasoning === "string"
        ? response.evidence.reasoning
        : undefined),
    evidence: response.evidence,
  };
}

function ProcessActionStep({
  step,
  title,
  accessLabel,
  status,
  children,
}: {
  step: string;
  title: string;
  accessLabel: string;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40 overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900/40">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
            Step {step}
          </p>
          <h3 className="text-sm font-semibold text-gray-100 mt-0.5">
            {title}
          </h3>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
          <span className="text-[10px] font-mono rounded border border-gray-700 bg-gray-950 px-1.5 py-0.5 text-gray-500">
            {accessLabel}
          </span>
          <span className="text-[10px] font-mono rounded border border-gray-700 bg-gray-950 px-1.5 py-0.5 text-gray-500">
            {status}
          </span>
        </div>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

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

// ─── Forms ────────────────────────────────────────────────────────────────────

function FeedbackForm({
  erc8004AgentId,
  clientCfg,
  prefillValidation,
  canSubmitFeedback,
  feedbackDisabledReason,
}: {
  erc8004AgentId?: string;
  clientCfg: ActionClientConfig;
  prefillValidation?: CompletedValidationSummary;
  canSubmitFeedback: boolean;
  feedbackDisabledReason?: string;
}) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { chainId, getViemClients, switchChain } = useWallet();
  const [showBackgroundNotice, setShowBackgroundNotice] = useState(false);
  const [feedbackValue, setFeedbackValue] = useState("");
  const [feedbackJson, setFeedbackJson] = useState(
    '{\n  "summary": "Great response quality",\n  "details": { "latencyMs": 820 }\n}',
  );

  useEffect(() => {
    if (!prefillValidation) return;
    setFeedbackValue(
      Math.max(0, Math.min(1, prefillValidation.score / 100)).toFixed(2),
    );
    setFeedbackJson(
      JSON.stringify(
        {
          summary: `Validation score ${prefillValidation.score}/100`,
          validation: {
            requestHash: prefillValidation.requestHash,
            responseHash: prefillValidation.responseHash,
            score: prefillValidation.score,
            reasoning: prefillValidation.reasoning,
            txHash: prefillValidation.txHash,
          },
        },
        null,
        2,
      ),
    );
  }, [prefillValidation]);

  const feedbackJsonError = validateJsonInput(feedbackJson);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          if (!canSubmitFeedback) {
            return {
              error:
                feedbackDisabledReason ??
                "Feedback is unavailable for this wallet.",
            };
          }
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

          setShowBackgroundNotice(true);
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
      <BackgroundActionModal
        open={showBackgroundNotice}
        onClose={() => setShowBackgroundNotice(false)}
      />
      {erc8004AgentId && erc8004AgentId !== "0" ? (
        <p className="text-xs text-gray-500 font-mono">
          ERC-8004 agent #{erc8004AgentId}
        </p>
      ) : (
        <p className="text-xs text-amber-400/80">
          This agent is not linked to ERC-8004 reputation.
        </p>
      )}
      {!canSubmitFeedback && feedbackDisabledReason ? (
        <p className="rounded border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300/80">
          {feedbackDisabledReason}
        </p>
      ) : null}
      {!canSubmitFeedback ? (
        <ResultBanner result={result} />
      ) : (
        <>
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
              value={feedbackValue}
              onChange={(event) => setFeedbackValue(event.target.value)}
              placeholder="0.8"
              required
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
            />
            {prefillValidation && (
              <p className="text-xs text-gray-500 mt-1">
                Populated from validation{" "}
                <span className="font-mono">
                  {prefillValidation.requestHash.slice(0, 12)}…
                </span>{" "}
                at{" "}
                <span className="font-mono">{prefillValidation.score}/100</span>
                .
              </p>
            )}
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
        </>
      )}
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
  const initialTeeOracleUrl =
    initialServices.find((service) => service.name === "teeOracle")?.endpoint ??
    "";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const nextTeeOracleUrl =
            builtServices.find((service) => service.name === "teeOracle")
              ?.endpoint ?? "";
          if (nextTeeOracleUrl !== initialTeeOracleUrl) {
            return {
              error:
                "Changing teeOracle requires Oracle Rotation, not a services edit.",
            };
          }
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
        lockTeeOracle
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

function buildRunValidationPayload(
  run: CachedOracleRun,
  erc8004AgentId: string,
) {
  const payload = {
    payload: run.payload,
    outcome: run.result.outcome,
    quote: run.quote,
    timestamp: run.timestamp,
    agentId: erc8004AgentId,
  };
  return {
    payload,
    requestURI: `data:application/json;base64,${btoa(JSON.stringify(payload))}`,
    requestHash: keccak256(toBytes(JSON.stringify(payload))),
  };
}

function RunOracleForm({
  agentId,
  erc8004AgentId,
  teeOracleUrl,
  canRun,
  runDisabledReason,
  onNewRun,
}: {
  agentId: string;
  erc8004AgentId?: string;
  teeOracleUrl: string;
  canRun: boolean;
  runDisabledReason?: string;
  onNewRun?: (run: CachedOracleRun) => void;
}) {
  const { getViemClients, switchChain } = useWallet();
  const [payloadJson, setPayloadJson] = useState(
    '{\n  "claim": "Was Ethereum above $2000 on January 1st, 2023?"\n}',
  );
  const [isPending, setIsPending] = useState(false);
  const [showBackgroundNotice, setShowBackgroundNotice] = useState(false);
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

  if (!erc8004AgentId || erc8004AgentId === "0") {
    return (
      <p className="text-xs text-amber-400/80">
        This agent has no linked ERC-8004 identity, so oracle runs are
        unavailable.
      </p>
    );
  }
  const linkedErc8004AgentId = erc8004AgentId;

  if (!canRun) {
    return (
      <div className="space-y-2">
        <p
          className="text-xs text-gray-500 font-mono truncate"
          title={teeOracleUrl}
        >
          Oracle: {teeOracleUrl}
        </p>
        <p className="rounded border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300/80">
          {runDisabledReason ??
            "Only the current agent owner can run this oracle."}
        </p>
      </div>
    );
  }

  async function handleRun(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canRun) {
      setRunResult({
        error:
          runDisabledReason ??
          "Only the current agent owner can run this oracle.",
      });
      return;
    }
    if (payloadError) return;
    setIsPending(true);
    setRunResult(null);

    try {
      setShowBackgroundNotice(true);
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
      const { publicClient, walletClient } = await getViemClients();
      const actualChainId = await publicClient.getChainId();
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

      const recorded = await recordOracleRun(
        {
          agentId,
          erc8004AgentId: linkedErc8004AgentId,
          teeOracleUrl: trimmedUrl,
          payload,
          signature,
          deadline,
        },
        actualChainId,
      );
      if (!recorded.ok) {
        setRunResult({ error: recorded.error });
        return;
      }
      const runData = {
        agentId: recorded.run.agentId,
        result: recorded.run.result,
        timestamp: recorded.run.timestamp,
        quote: recorded.run.quote ?? "",
        event_log: recorded.run.event_log ?? "",
      };
      setRunResult({ data: runData });
      onNewRun?.(recorded.run);
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
      <BackgroundActionModal
        open={showBackgroundNotice}
        onClose={() => setShowBackgroundNotice(false)}
      />
      <p
        className="text-xs text-gray-500 font-mono truncate"
        title={teeOracleUrl}
      >
        Oracle: {teeOracleUrl}
      </p>
      {runDisabledReason && (
        <p className="rounded border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300/80">
          {runDisabledReason}
        </p>
      )}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Claim JSON</label>
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
        {agentId}. The oracle runs the claim and stores the run so you can
        validate it on demand.
      </p>
      <SubmitButton
        isPending={isPending}
        label="Sign & Run"
        disabled={!canRun || !!payloadError}
      />
      {runResult?.error && (
        <ErrorBox title="Oracle error" message={runResult.error} />
      )}
    </form>
  );
}

// ─── Oracle run history ──────────────────────────────────────────────────────

function OracleRunCard({
  run,
  erc8004AgentId,
  teeOracleUrl,
  clientCfg,
  knownResponse,
}: {
  run: CachedOracleRun;
  erc8004AgentId?: string;
  teeOracleUrl: string;
  clientCfg: ActionClientConfig;
  knownResponse: ValidationResponse | undefined;
}) {
  const router = useRouter();
  const { address, getViemClients, switchChain } = useWallet();
  const [open, setOpen] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRequestingValidation, setIsRequestingValidation] = useState(false);
  const [showBackgroundNotice, setShowBackgroundNotice] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<{
    is_valid?: boolean;
    unavailable?: boolean;
    error?: string;
  } | null>(null);
  const claim = claimFromRunPayload(run.payload);

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
  const canVerify = !!run.quote && !!run.event_log && !!teeOracleUrl;
  const validationStatus = knownResponse
    ? `Validated ${knownResponse.score}/100`
    : "Not validated";
  const validationStatusColor = knownResponse
    ? "text-green-400"
    : "text-gray-600";
  const validationButtonLabel = knownResponse
    ? "Validated"
    : isRequestingValidation
      ? "Requesting..."
      : "Request validation";
  const requestDisabledReason = knownResponse
    ? "Already validated."
    : !address
      ? "Connect wallet."
      : !erc8004AgentId || erc8004AgentId === "0"
        ? "Missing ERC-8004 identity."
        : !clientCfg.validationRegistryAddress || !clientCfg.teeVerifierAddress
          ? "Validation contracts are not configured."
          : undefined;

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

  async function handleRequestValidation() {
    if (
      requestDisabledReason ||
      !erc8004AgentId ||
      erc8004AgentId === "0" ||
      !clientCfg.validationRegistryAddress ||
      !clientCfg.teeVerifierAddress
    ) {
      return;
    }

    setIsRequestingValidation(true);
    setValidationError(null);
    setShowBackgroundNotice(true);
    try {
      const linkedErc8004AgentId = erc8004AgentId;
      const validationRegistryAddress = clientCfg.validationRegistryAddress;
      const teeVerifierAddress = clientCfg.teeVerifierAddress;
      const validation = buildRunValidationPayload(run, linkedErc8004AgentId);
      await switchChain();
      const { publicClient, walletClient } = await getViemClients();
      const hash = await walletClient.writeContract({
        address: validationRegistryAddress,
        abi: VALIDATION_REGISTRY_ABI,
        functionName: "validationRequest",
        args: [
          teeVerifierAddress,
          BigInt(linkedErc8004AgentId),
          validation.requestURI,
          validation.requestHash,
        ],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      router.refresh();
    } catch (err) {
      setValidationError(
        err instanceof Error ? err.message : "Unknown validation request error",
      );
    } finally {
      setIsRequestingValidation(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40 overflow-hidden">
      <BackgroundActionModal
        open={showBackgroundNotice}
        onClose={() => setShowBackgroundNotice(false)}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex flex-col gap-2 px-3 py-2 hover:bg-gray-800/30 transition-colors text-left"
      >
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="min-w-0 space-y-1">
            {claim ? (
              <div className="flex gap-1.5 text-xs min-w-0">
                <span className="font-mono text-violet-400 bg-violet-950/40 px-1 py-0.5 rounded shrink-0">
                  Claim
                </span>
                <span className="text-gray-200 truncate">{claim}</span>
              </div>
            ) : (
              <p className="text-xs text-gray-500 font-mono">No claim</p>
            )}
            <div className="flex items-center gap-2 min-w-0 overflow-hidden">
              <span className="text-xs font-mono text-gray-500 shrink-0">
                Outcome
              </span>
              {summary && (
                <span
                  className={`text-xs font-semibold shrink-0 ${summaryColor}`}
                >
                  {summary}
                </span>
              )}
            </div>
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
        {run.payload &&
          Object.entries(run.payload).some(([key]) => key !== "claim") && (
            <div className="w-full rounded bg-gray-900/80 px-2 py-1.5 space-y-0.5">
              {Object.entries(run.payload)
                .filter(([key]) => key !== "claim")
                .map(([k, v]) => (
                  <div
                    key={k}
                    className="flex gap-1.5 text-xs font-mono min-w-0"
                  >
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <span className={validationStatusColor}>{validationStatus}</span>
          {verifyResult && (
            <span
              className={`font-semibold ${
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
                ? "verify unavailable"
                : verifyResult.error
                  ? verifyResult.error
                  : verifyResult.is_valid
                    ? "proof valid"
                    : "proof invalid"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={isRequestingValidation || !!requestDisabledReason}
            onClick={() => void handleRequestValidation()}
            title={requestDisabledReason}
            className="rounded bg-violet-600 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
          >
            {validationButtonLabel}
          </button>
          {canVerify && (
            <button
              type="button"
              disabled={isVerifying}
              onClick={() => void handleVerify()}
              className="rounded bg-gray-700 px-2 py-1 text-[11px] font-medium text-gray-100 transition-colors hover:bg-gray-600 disabled:opacity-50"
            >
              {isVerifying ? "Verifying..." : "Verify proof (quote + log)"}
            </button>
          )}
        </div>
      </div>
      {validationError && (
        <div className="border-t border-gray-800 px-3 py-2">
          <ErrorBox
            title="Validation request error"
            message={validationError}
          />
        </div>
      )}
      {open && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-800 space-y-2">
          {Object.keys(run.result).length > 0 && (
            <pre className="text-xs font-mono text-gray-300 bg-gray-950/60 rounded p-2 overflow-auto max-h-36">
              {JSON.stringify(run.result, null, 2)}
            </pre>
          )}
          <div>
            <p className="text-xs text-gray-500 break-all font-mono">
              Oracle: {run.oracleAddress}
              <br />
              Quote: {run.quote?.slice(0, 80)}…
              <br />
              Event: {run.event_log?.slice(0, 80)}…
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function OracleRunHistory({
  runs,
  erc8004AgentId,
  teeOracleUrl,
  clientCfg,
  validationResponses,
}: {
  runs: CachedOracleRun[];
  erc8004AgentId?: string;
  teeOracleUrl: string;
  clientCfg: ActionClientConfig;
  validationResponses: ValidationResponse[];
}) {
  if (!runs.length) return null;
  return (
    <div className="space-y-1.5">
      {runs.map((run, idx) => {
        const validationPayload = erc8004AgentId
          ? buildRunValidationPayload(run, erc8004AgentId)
          : null;
        const knownResponse = validationPayload
          ? validationResponses.find(
              (response) =>
                response.requestHash.toLowerCase() ===
                validationPayload.requestHash.toLowerCase(),
            )
          : undefined;
        return (
          <OracleRunCard
            key={`${run.timestamp}-${idx}`}
            run={run}
            erc8004AgentId={erc8004AgentId}
            teeOracleUrl={teeOracleUrl}
            clientCfg={clientCfg}
            knownResponse={knownResponse}
          />
        );
      })}
    </div>
  );
}

// ─── Validation responses panel ───────────────────────────────────────────────

function formatUnknown(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function claimFromRunPayload(
  payload: Record<string, unknown> | undefined,
): string | null {
  const claim = payload?.claim;
  if (claim === undefined) return null;
  return formatUnknown(claim);
}

function validationResponsePayload(
  response: ValidationResponse,
): Record<string, unknown> {
  const evidence = response.evidence ?? {};
  return {
    score: response.score,
    reasoning:
      response.reasoning ??
      (typeof evidence.reasoning === "string" ? evidence.reasoning : undefined),
    tag: response.tag,
    responseHash: response.responseHash,
  };
}

function runForValidationResponse(
  response: ValidationResponse,
  runs: CachedOracleRun[],
  erc8004AgentId?: string,
): CachedOracleRun | undefined {
  if (!erc8004AgentId) return undefined;
  return runs.find(
    (run) =>
      buildRunValidationPayload(
        run,
        erc8004AgentId,
      ).requestHash.toLowerCase() === response.requestHash.toLowerCase(),
  );
}

function ValidationResponsesPanel({
  responses,
  runs,
  erc8004AgentId,
  onUseForFeedback,
  canUseForFeedback,
  feedbackDisabledReason,
}: {
  responses: ValidationResponse[];
  runs: CachedOracleRun[];
  erc8004AgentId?: string;
  onUseForFeedback?: (response: ValidationResponse) => void;
  canUseForFeedback: boolean;
  feedbackDisabledReason?: string;
}) {
  if (!responses.length) {
    return (
      <p className="text-xs text-gray-500">
        No validation responses yet. Use Request validation on a run in Step 2,
        then refresh once the oracle has responded.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {responses.map((response) => {
        const matchedRun = runForValidationResponse(
          response,
          runs,
          erc8004AgentId,
        );
        const claim = claimFromRunPayload(matchedRun?.payload);
        const llmOutcome = matchedRun?.result.outcome;
        const validationResponse = validationResponsePayload(response);
        const validationReasoning =
          response.reasoning ??
          (typeof response.evidence?.reasoning === "string"
            ? response.evidence.reasoning
            : undefined);
        const scoreColor =
          response.score >= 70
            ? "text-green-400"
            : response.score >= 40
              ? "text-yellow-400"
              : "text-red-400";
        return (
          <div
            key={response.requestHash}
            className="rounded-lg border border-gray-700 bg-gray-950/40 p-3 space-y-2"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-mono text-gray-500 truncate">
                {response.requestHash.slice(0, 20)}…
              </p>
              <span className={`text-xs font-semibold shrink-0 ${scoreColor}`}>
                {response.score}/100
              </span>
            </div>
            {claim && (
              <div className="rounded bg-gray-900/60 p-2">
                <p className="text-[11px] font-semibold text-gray-500 mb-1">
                  Claim
                </p>
                <p className="text-xs text-gray-300 whitespace-pre-wrap break-words">
                  {claim}
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              <div className="rounded bg-gray-900/60 p-2">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-[11px] font-semibold text-gray-500">
                    Initial output
                  </p>
                  <span className="text-[10px] font-mono text-gray-600">
                    run
                  </span>
                </div>
                {llmOutcome !== undefined ? (
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words overflow-x-auto max-h-32">
                    {formatUnknown(llmOutcome)}
                  </pre>
                ) : (
                  <p className="text-xs text-gray-600">
                    Matching run not available locally.
                  </p>
                )}
              </div>
              <div className="rounded bg-gray-900/60 p-2">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-[11px] font-semibold text-gray-500">
                    Validation response
                  </p>
                  <span className={`text-[10px] font-mono ${scoreColor}`}>
                    {response.score}/100
                  </span>
                </div>
                <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words overflow-x-auto max-h-32">
                  {formatUnknown(validationResponse)}
                </pre>
              </div>
            </div>
            {validationReasoning && (
              <p className="text-xs text-gray-400 whitespace-pre-wrap break-words">
                {validationReasoning}
              </p>
            )}
            {response.txHash && (
              <p className="text-[11px] font-mono text-gray-600 truncate">
                tx {response.txHash}
              </p>
            )}
            {onUseForFeedback && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!canUseForFeedback}
                  onClick={() => onUseForFeedback(response)}
                  className="rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-default disabled:bg-gray-700 disabled:text-gray-400"
                >
                  Use for feedback
                </button>
                {!canUseForFeedback && feedbackDisabledReason ? (
                  <span className="text-xs text-amber-300/80">
                    {feedbackDisabledReason}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
