"use client";

import { useState } from "react";
import type { AgentService } from "@tee-agent/agent/types";
import { getClientConfigForChain } from "@/lib/config";
import { useWallet } from "@/providers/WalletProvider";
import type { CachedOracleRun } from "@/lib/agent-cache";
import type { ValidationResponse } from "@/lib/actions/agents";
import type { AgentMetadataFormValue } from "@/components/AgentMetadataForm";
import { TransferForm } from "./TransferForm";
import { CollapsibleSection, ProcessActionStep } from "./Widgets";
import { PublicMetadataForm } from "./PublicMetadataForm";
import { FeedbackForm } from "./FeedbackForm";
import { ServiceEditorForm } from "./ServiceEditorForm";
import { RunOracleForm } from "./RunOracleForm";
import { OracleRunHistory } from "./OracleRunHistory";
import { ValidationResponsesPanel } from "./ValidationResponsesPanel";

interface Props {
  agentId: string;
  chainId: number;
  erc8004AgentId?: string;
  owner: string;
  initialServices: readonly AgentService[];
  initialPublicMetadata: AgentMetadataFormValue;
  initialPublicMetadataCreatedAt?: number;
  initialRuns?: CachedOracleRun[];
  initialValidationResponses?: ValidationResponse[];
}

export default function AgentDetailActions({
  agentId,
  chainId,
  erc8004AgentId,
  owner,
  initialServices,
  initialPublicMetadata,
  initialPublicMetadataCreatedAt,
  initialRuns,
  initialValidationResponses,
}: Props) {
  const { address } = useWallet();
  const clientCfg = getClientConfigForChain(chainId);
  const isOwner = !!address && address.toLowerCase() === owner.toLowerCase();
  const [runs, setRuns] = useState<CachedOracleRun[]>(initialRuns ?? []);
  const validationResponses = initialValidationResponses ?? [];
  const [feedbackDraftValidation, setFeedbackDraftValidation] =
    useState<ValidationResponse>();

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
          title="Run your oracle with a question"
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
            chainId={chainId}
            erc8004AgentId={erc8004AgentId}
            teeOracleUrl={teeOracleUrl}
            canRun={isOwner}
            runDisabledReason={runDisabledReason}
            onNewRun={(run) => setRuns((prev) => [run, ...prev])}
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
              validationResponses={validationResponses}
              clientCfg={clientCfg}
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
            onUseForFeedback={setFeedbackDraftValidation}
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
        <div className="space-y-4">
          <CollapsibleSection
            title="Edit ERC-721 Metadata"
            description="Update NFT metadata used by tokenURI, marketplaces, and the public metadata URI."
          >
            <PublicMetadataForm
              agentId={agentId}
              chainId={chainId}
              initialMetadata={initialPublicMetadata}
              createdAt={initialPublicMetadataCreatedAt}
              services={initialServices}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="Edit Services"
            description="Update the ERC-8004 service list and refresh the ERC-721 service traits."
          >
            <ServiceEditorForm
              agentId={agentId}
              chainId={chainId}
              initialServices={initialServices}
            />
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}
