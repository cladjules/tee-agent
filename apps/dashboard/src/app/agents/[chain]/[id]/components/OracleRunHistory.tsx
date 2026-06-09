"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { keccak256, toBytes } from "viem";
import type { AgentConfig } from "@tee-agent/agent/types";
import { VALIDATION_REGISTRY_ABI } from "@tee-agent/agent/abis";
import type { CachedOracleRun } from "@/lib/agent-cache";
import type { ValidationResponse } from "@/lib/actions/agents";
import { ErrorBox } from "@/components/ErrorBox";
import { useWallet } from "@/providers/WalletProvider";
import { BackgroundActionModal } from "./ActionUI";

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
  clientCfg: AgentConfig;
  knownResponse: ValidationResponse | undefined;
}) {
  const router = useRouter();
  const { address, getWalletClient } = useWallet();
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
  const claim =
    run.payload?.claim === undefined ? null : String(run.payload.claim);

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
      const walletClient = await getWalletClient();
      if (!walletClient) {
        setValidationError("Connect your wallet");
        return;
      }
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
      await walletClient.waitForTransactionReceipt({ hash });

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

export function OracleRunHistory({
  runs,
  erc8004AgentId,
  teeOracleUrl,
  validationResponses,
  clientCfg,
}: {
  runs: CachedOracleRun[];
  erc8004AgentId?: string;
  teeOracleUrl: string;
  validationResponses: ValidationResponse[];
  clientCfg: AgentConfig;
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
