"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentConfig } from "@tee-agent/agent/types";
import { REPUTATION_REGISTRY_ABI } from "@tee-agent/agent/abis";
import { useWallet } from "@/providers/WalletProvider";
import { prepareFeedback } from "@/lib/actions/registry";
import {
  BackgroundActionModal,
  ResultBanner,
  SubmitButton,
  useActionState,
} from "./ActionUI";
import type { ValidationResponse } from "@/lib/actions/agents";

function Field({
  label,
  name,
  placeholder,
}: {
  label: string;
  name: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        name={name}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
      />
    </div>
  );
}

export function FeedbackForm({
  erc8004AgentId,
  clientCfg,
  prefillValidation,
  canSubmitFeedback,
  feedbackDisabledReason,
}: {
  erc8004AgentId?: string;
  clientCfg: AgentConfig;
  prefillValidation?: ValidationResponse;
  canSubmitFeedback: boolean;
  feedbackDisabledReason?: string;
}) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { getWalletClient } = useWallet();
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
            reasoning:
              prefillValidation.reasoning ??
              (typeof prefillValidation.evidence?.reasoning === "string"
                ? prefillValidation.evidence.reasoning
                : undefined),
            txHash: prefillValidation.txHash,
          },
        },
        null,
        2,
      ),
    );
  }, [prefillValidation]);

  const feedbackJsonError = (() => {
    if (!feedbackJson.trim()) return null;
    try {
      JSON.parse(feedbackJson);
      return null;
    } catch {
      return "Invalid JSON.";
    }
  })();
  return (
    <form
      onSubmit={async (e) => {
        const walletClient = await getWalletClient();
        if (!walletClient) {
          return { error: "Connect your wallet" };
        }

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
            chainId: clientCfg.chain.id,
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
          await walletClient.waitForTransactionReceipt({ hash });
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
