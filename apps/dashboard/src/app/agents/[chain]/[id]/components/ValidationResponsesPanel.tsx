"use client";

import { keccak256, toBytes } from "viem";
import type { CachedOracleRun } from "@/lib/agent-cache";
import type { ValidationResponse } from "@/lib/actions/agents";

export function ValidationResponsesPanel({
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
        const matchedRun = erc8004AgentId
          ? runs.find((run) => {
              const payload = {
                payload: run.payload,
                outcome: run.result.outcome,
                quote: run.quote,
                timestamp: run.timestamp,
                agentId: erc8004AgentId,
              };
              return (
                keccak256(toBytes(JSON.stringify(payload))).toLowerCase() ===
                response.requestHash.toLowerCase()
              );
            })
          : undefined;
        const claim =
          matchedRun?.payload?.claim === undefined
            ? null
            : String(matchedRun.payload.claim);
        const llmOutcome = matchedRun?.result.outcome;
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
                    {JSON.stringify(llmOutcome, null, 2)}
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
                  {JSON.stringify(response, null, 2)}
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
