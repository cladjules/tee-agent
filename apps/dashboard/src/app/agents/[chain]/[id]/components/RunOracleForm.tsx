"use client";

import { useMemo, useState } from "react";
import type React from "react";
import { buildRunTypedData } from "@tee-agent/agent/typed-data";
import type { CachedOracleRun, TdxProof } from "@/lib/agent-cache";
import { ErrorBox } from "@/components/ErrorBox";
import { useWallet } from "@/providers/WalletProvider";
import { recordOracleRun } from "@/lib/actions/agents";
import { BackgroundActionModal, SubmitButton } from "./ActionUI";

type OracleRunResult = {
  agentId: string;
  result: Record<string, unknown>;
  timestamp: number;
  proof: TdxProof | undefined;
};

const runPayloadPresets = {
  evidence: {
    label: "Prediction with evidence",
    fieldLabel: "Evidence-backed question JSON",
    hint: "Fetch the evidence URL inside the TEE, then answer the question from that source.",
    json: '{\n  "question": "Will ETH close above $4,000 on May 30, 2026?",\n  "url": "https://api.coingecko.com/api/v3/coins/ethereum/market_chart/range?vs_currency=usd&from=1780099200&to=1780185600"\n}',
  },
  research: {
    label: "Prediction with web research",
    fieldLabel: "Prediction research JSON",
    hint: "No evidence URL: the prediction oracle searches the web, reads the top results, then answers.",
    json: '{\n  "question": "Will Donald Trump still be president of the United States on May 24, 2026?"\n}',
  },
  web: {
    label: "Simple Web Oracle",
    fieldLabel: "Web oracle input JSON",
    hint: "Use this with the web-data-oracle example to fetch JSON and extract a dot-path selector.",
    json: '{\n  "url": "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",\n  "selector": "ethereum.usd"\n}',
  },
} as const;

type RunPayloadPreset = keyof typeof runPayloadPresets;

export function RunOracleForm({
  agentId,
  chainId: agentChainId,
  erc8004AgentId,
  teeOracleUrl,
  canRun,
  runDisabledReason,
  onNewRun,
}: {
  agentId: string;
  chainId: number;
  erc8004AgentId?: string;
  teeOracleUrl: string;
  canRun: boolean;
  runDisabledReason?: string;
  onNewRun?: (run: CachedOracleRun) => void;
}) {
  const { getWalletClient, chainId } = useWallet();
  const [payloadPreset, setPayloadPreset] =
    useState<RunPayloadPreset>("evidence");
  const [payloadJson, setPayloadJson] = useState<string>(
    runPayloadPresets.evidence.json,
  );
  const [isPending, setIsPending] = useState(false);
  const [showBackgroundNotice, setShowBackgroundNotice] = useState(false);
  const [runResult, setRunResult] = useState<{
    data?: OracleRunResult;
    error?: string;
  } | null>(null);

  const payloadError = useMemo(() => {
    if (!payloadJson.trim()) return null;
    try {
      JSON.parse(payloadJson);
      return null;
    } catch {
      return "Invalid JSON.";
    }
  }, [payloadJson]);

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
      const walletClient = await getWalletClient();
      if (!walletClient || !chainId) {
        setRunResult({ error: "Connect your wallet" });
        return;
      }
      const tdRun = buildRunTypedData({
        oracleAddress: oracleAddress as `0x${string}`,
        chainId,
        agentId: BigInt(agentId),
        payload,
        deadline,
      });
      const signature = await walletClient.signTypedData({
        ...tdRun,
        account: walletClient.account!,
      });

      const recorded = await recordOracleRun({
        chainId: agentChainId,
        agentId,
        erc8004AgentId: linkedErc8004AgentId,
        teeOracleUrl: trimmedUrl,
        payload,
        signature,
        deadline,
      });
      if (!recorded.ok) {
        setRunResult({ error: recorded.error });
        return;
      }
      const runData = {
        agentId: recorded.run.agentId,
        result: recorded.run.result,
        timestamp: recorded.run.timestamp,
        proof: recorded.run.proof,
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
      <div className="inline-flex overflow-hidden rounded-lg border border-gray-700 bg-gray-900 p-0.5">
        {Object.entries(runPayloadPresets).map(([key, preset]) => {
          const selected = payloadPreset === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                const next = key as RunPayloadPreset;
                setPayloadPreset(next);
                setPayloadJson(runPayloadPresets[next].json);
                setRunResult(null);
              }}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                selected ? "text-gray-100" : "text-gray-400 hover:text-gray-100"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          {runPayloadPresets[payloadPreset].fieldLabel}
        </label>
        <textarea
          value={payloadJson}
          onChange={(e) => setPayloadJson(e.target.value)}
          rows={6}
          className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 font-mono placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm resize-y"
        />
        {payloadError && (
          <p className="text-xs text-red-400 mt-1">{payloadError}</p>
        )}
        <p className="mt-1 text-xs text-gray-600">
          {runPayloadPresets[payloadPreset].hint}
        </p>
      </div>
      <p className="text-xs text-gray-600">
        Your wallet signs an EIP-712 message proving ownership of agent #
        {agentId}. The oracle runs the payload and stores the run so you can
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
