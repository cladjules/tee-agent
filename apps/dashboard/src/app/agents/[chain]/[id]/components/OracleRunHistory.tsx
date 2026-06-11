"use client";

import { useMemo, useState } from "react";
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
    proof: run.proof,
    timestamp: run.timestamp,
    agentId: erc8004AgentId,
  };
  return {
    payload,
    requestURI: `data:application/json;base64,${btoa(JSON.stringify(payload))}`,
    requestHash: keccak256(toBytes(JSON.stringify(payload))),
  };
}

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function formatInlineValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

function RtmrMatch({
  label,
  value,
}: {
  label: string;
  value: boolean | undefined;
}) {
  if (value === undefined) return null;
  return (
    <span
      className={`rounded border px-1.5 py-0.5 ${
        value
          ? "border-green-900/70 bg-green-950/40 text-green-400"
          : "border-red-900/70 bg-red-950/40 text-red-400"
      }`}
    >
      {label} {value ? "match" : "mismatch"}
    </span>
  );
}

function hasRtmrResult(
  result: {
    isRtmr0Valid?: boolean;
    isRtmr1Valid?: boolean;
    isRtmr2Valid?: boolean;
    isRtmr3Valid?: boolean;
  } | null,
): boolean {
  return (
    result?.isRtmr0Valid !== undefined ||
    result?.isRtmr1Valid !== undefined ||
    result?.isRtmr2Valid !== undefined ||
    result?.isRtmr3Valid !== undefined
  );
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
    isValid?: boolean;
    isRtmr0Valid?: boolean;
    isRtmr1Valid?: boolean;
    isRtmr2Valid?: boolean;
    isRtmr3Valid?: boolean;
    unavailable?: boolean;
    error?: string;
  } | null>(null);
  const payloadPreviewRows = useMemo(
    () => (run.payload ? Object.entries(run.payload).slice(0, 3) : []),
    [run.payload],
  );

  const [summary, summaryColor] = useMemo(() => {
    let verdict: string | null = null;
    if (run.result.outcome?.verdict)
      verdict = String(run.result.outcome.verdict);
    if (run.result.outcome?.statusCode)
      verdict = `HTTP ${String(run.result.outcome.statusCode)}`;

    const lowerVerdict = verdict?.toLowerCase();
    const color =
      lowerVerdict === "yes" || lowerVerdict === "valid"
        ? "text-green-400"
        : lowerVerdict === "no" || lowerVerdict === "invalid"
          ? "text-red-400"
          : "text-gray-400";

    return [verdict, color] as const;
  }, [run.result.outcome]);

  const canVerify = !!run.proof && !!teeOracleUrl;
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
        body: JSON.stringify({ proof: run.proof }),
      });
      const data = (await res.json()) as {
        isValid?: boolean;
        is_valid?: boolean;
        isRtmr0Valid?: boolean;
        isRtmr1Valid?: boolean;
        isRtmr2Valid?: boolean;
        isRtmr3Valid?: boolean;
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
          isValid: data.isValid ?? data.is_valid,
          isRtmr0Valid: data.isRtmr0Valid,
          isRtmr1Valid: data.isRtmr1Valid,
          isRtmr2Valid: data.isRtmr2Valid,
          isRtmr3Valid: data.isRtmr3Valid,
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
            {payloadPreviewRows.length > 0 && (
              <div className="min-w-0 space-y-1">
                {payloadPreviewRows.map(([key, value]) => (
                  <div key={key} className="flex gap-1.5 text-xs min-w-0">
                    <span className="font-mono text-violet-400 rounded shrink-0">
                      {key}:
                    </span>
                    <span className="text-gray-200 truncate">
                      {formatInlineValue(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 min-w-0 overflow-hidden">
              <span className="text-xs font-mono text-gray-500 shrink-0">
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
      </button>
      <div className="flex flex-wrap items-start justify-between gap-2 border-t border-gray-800 px-3 py-2">
        <div className="min-w-0 space-y-1 text-xs font-mono">
          <div className={validationStatusColor}>
            Validation: {validationStatus}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {verifyResult && (
              <span
                className={`font-semibold ${
                  verifyResult.unavailable
                    ? "text-gray-500"
                    : verifyResult.error
                      ? "text-red-400"
                      : verifyResult.isValid
                        ? "text-green-400"
                        : "text-yellow-400"
                }`}
              >
                {verifyResult.unavailable
                  ? "verify unavailable"
                  : verifyResult.error
                    ? verifyResult.error
                    : verifyResult.isValid
                      ? "Proof valid"
                      : "Proof invalid"}
              </span>
            )}
            {verifyResult &&
              !verifyResult.error &&
              !verifyResult.unavailable && (
                <>
                  <RtmrMatch label="RTMR0" value={verifyResult.isRtmr0Valid} />
                  <RtmrMatch label="RTMR1" value={verifyResult.isRtmr1Valid} />
                  <RtmrMatch label="RTMR2" value={verifyResult.isRtmr2Valid} />
                  <RtmrMatch label="RTMR3" value={verifyResult.isRtmr3Valid} />
                </>
              )}
          </div>
          {hasRtmrResult(verifyResult) && (
            <p className="max-w-3xl text-[11px] leading-4 text-gray-500">
              RTMR0 checks the CVM hardware/firmware setup, RTMR1 the Linux
              kernel, RTMR2 kernel parameters and initrd/rootfs, and RTMR3 the
              dstack app compose/runtime events. Mismatches mean the proof was
              not produced by the same measured environment.
            </p>
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
              {isVerifying ? "Verifying..." : "Verify proof"}
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
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded border border-gray-800 bg-gray-950/60">
              <div className="border-b border-gray-800 px-2 py-1 text-[11px] font-mono uppercase tracking-wide text-gray-500">
                Original input
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words p-2 text-xs font-mono text-gray-300">
                {formatJson(run.payload)}
              </pre>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/60">
              <div className="border-b border-gray-800 px-2 py-1 text-[11px] font-mono uppercase tracking-wide text-gray-500">
                Outcome
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words p-2 text-xs font-mono text-gray-300">
                {formatJson(run.result.outcome ?? run.result)}
              </pre>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 break-all font-mono">
              Oracle: {run.oracleAddress}
              <br />
              Quote: {run.proof?.quote.slice(0, 80)}…
              <br />
              Event: {run.proof?.event_log.slice(0, 80)}…
              <br />
              VM config: {run.proof?.vm_config.slice(0, 80)}…
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
