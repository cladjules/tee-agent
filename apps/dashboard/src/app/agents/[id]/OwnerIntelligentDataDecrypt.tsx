"use client";

import { useState, useTransition } from "react";
import { decryptAgentIntelligentData } from "@/lib/actions/registry";
import { useWallet } from "@/components/wallet/WalletProvider";

/**
 * Browser-safe entry point for @open-agents-toolkit/agent.
 * Pure helpers with no Node.js dependencies — safe for client bundles.
 *
 * For ABIs use: @open-agents-toolkit/agent/abis
 */

export function buildDecryptMessage(
  agentId: string,
  ownerAddress: string,
  signedAt: number,
): string {
  return `Open Agents Toolkit decrypt request\nagentId:${agentId}\nowner:${ownerAddress.toLowerCase()}\nsignedAt:${signedAt}`;
}

type Props = {
  agentId: string;
  owner: string;
  entries: Array<{
    name?: string;
    dataDescription: string;
    dataHash: `0x${string}`;
  }>;
};

type DecryptedEntry = {
  name?: string;
  dataDescription: string;
  dataHash: `0x${string}`;
  plaintext?: unknown;
  error?: string;
};

export default function OwnerIntelligentDataDecrypt({
  agentId,
  owner,
  entries,
}: Props) {
  const { address, getViemClients } = useWallet();
  const [result, setResult] = useState<{
    data: DecryptedEntry[];
    error?: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const isOwner = !!address && address.toLowerCase() === owner.toLowerCase();
  const decryptedByHash = new Map(
    (result?.data ?? []).map((entry) => [entry.dataHash.toLowerCase(), entry]),
  );

  return (
    <div className="space-y-3">
      {isOwner && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              try {
                const { walletClient } = await getViemClients();
                const signedAt = Date.now();
                const message = buildDecryptMessage(agentId, owner, signedAt);
                const signature = await walletClient.signMessage({
                  account: walletClient.account!,
                  message,
                });
                const response = await decryptAgentIntelligentData({
                  agentId,
                  ownerAddress: owner as `0x${string}`,
                  signedAt,
                  signature,
                });
                setResult(response);
              } catch (error) {
                setResult({
                  data: [],
                  error:
                    error instanceof Error
                      ? error.message
                      : "Failed to decrypt intelligent data.",
                });
              }
            });
          }}
          className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 cursor-pointer"
        >
          {isPending ? "Decrypting..." : "Decrypt Intelligent Data"}
        </button>
      )}

      {!address && (
        <p className="text-xs text-gray-500">
          Connect your wallet to request owner-only decryption.
        </p>
      )}

      {address && !isOwner && (
        <p className="text-xs text-gray-500">
          Only the current owner can decrypt and view intelligent data
          plaintext.
        </p>
      )}

      {result?.error && (
        <p className="text-xs text-red-400 bg-red-950/40 px-3 py-2 rounded-lg">
          {result.error}
        </p>
      )}

      <div className="space-y-3">
        {entries.map((entry, idx) => {
          const decrypted = decryptedByHash.get(entry.dataHash.toLowerCase());
          const entryName =
            decrypted?.name || entry.name || `Entry #${idx + 1}`;

          return (
            <div
              key={`${entry.dataHash}:${idx}`}
              className="rounded-lg border border-gray-800 bg-gray-950/40 p-4 space-y-2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-gray-500">{entryName}</span>
              </div>
              <p className="text-xs text-gray-500">Proof Hash</p>
              <p className="text-xs text-gray-300 break-all font-mono">
                {entry.dataHash}
              </p>
              <p className="text-xs text-gray-500">Address / URI</p>
              <p className="text-xs text-gray-300 break-all font-mono">
                {entry.dataDescription}
              </p>

              {decrypted && (
                <>
                  <p className="text-xs text-gray-500">Decrypted Value</p>
                  {decrypted.error ? (
                    <p className="text-xs text-red-400">{decrypted.error}</p>
                  ) : (
                    <pre className="text-xs text-gray-200 bg-gray-900/70 border border-gray-800 rounded p-3 overflow-auto">
                      {JSON.stringify(decrypted.plaintext, null, 2)}
                    </pre>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
