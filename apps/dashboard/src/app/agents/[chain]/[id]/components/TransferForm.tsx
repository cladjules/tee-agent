"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAddress, isAddress } from "viem";
import {
  AGENT_REGISTRY_ABI,
  IDENTITY_REGISTRY_ABI,
} from "@tee-agent/agent/abis";
import { buildReencryptTypedData } from "@tee-agent/agent/typed-data";
import {
  buildTransferAcceptance,
  buildTransferTxArgs,
  getTransferAccessPayloadsToSign,
} from "@tee-agent/agent/ops/transfer-acceptance";
import type { AgentConfig } from "@tee-agent/agent/types";
import { useWallet } from "@/providers/WalletProvider";
import {
  prepareTeeOracleServiceUpdate,
  prepareTransferOfferAgent,
} from "@/lib/actions/agents";
import { ResultBanner, useActionState } from "./ActionUI";

const ERC721_TRANSFER_ABI = [
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

function StepBox({
  index,
  label,
  actor,
  status,
  children,
}: {
  index: number;
  label: string;
  actor: string;
  status: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 text-gray-400 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide">
          Step {index}
        </span>
        <span className="text-[10px] font-mono">{actor}</span>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-gray-200">{label}</p>
        <p className="text-[11px] text-emerald-300/80">{status}</p>
      </div>
      {children}
    </div>
  );
}

async function oracleAddress(url: string): Promise<{
  address?: `0x${string}`;
  publicKey?: `0x${string}`;
}> {
  const res = await fetch(`${url}/address`);
  if (!res.ok) throw new Error(`GET ${url}/address failed: ${res.status}`);
  return (await res.json()) as {
    address?: `0x${string}`;
    publicKey?: `0x${string}`;
  };
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function requiredAddress(value: string, label: string): `0x${string}` {
  const trimmed = value.trim();
  if (!isAddress(trimmed)) throw new Error(`${label} is invalid.`);
  return getAddress(trimmed);
}

export function TransferForm({
  tokenId,
  erc8004AgentId,
  teeOracleUrl,
  clientCfg,
}: {
  tokenId: string;
  erc8004AgentId?: string;
  teeOracleUrl: string;
  clientCfg: AgentConfig;
}) {
  const router = useRouter();
  const transferState = useActionState();
  const keyState = useActionState();
  const { address, getWalletClient } = useWallet();
  const sourceOracleUrl = normalizeUrl(teeOracleUrl);
  const [recipient, setRecipient] = useState("");
  const [targetOracleUrl, setTargetOracleUrl] = useState(sourceOracleUrl);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [confirmReencode, setConfirmReencode] = useState(false);
  const registryAddress = clientCfg.registryAddress;
  const identityRegistryAddress = clientCfg.identityRegistryAddress;
  const targetOracleUrlNormalized = normalizeUrl(targetOracleUrl);
  const hasLinkedIdentity = !!erc8004AgentId && erc8004AgentId !== "0";
  const linkedErc8004AgentId = hasLinkedIdentity ? erc8004AgentId : undefined;
  const oracleChangeNeeded =
    !!sourceOracleUrl &&
    !!targetOracleUrlNormalized &&
    sourceOracleUrl !== targetOracleUrlNormalized;
  const transferStatus = address
    ? "Can be done now by the current owner"
    : "Connect the current owner wallet";
  const reencodeStatus = !hasLinkedIdentity
    ? "No linked ERC-8004 identity"
    : !sourceOracleUrl
      ? "Missing current teeOracle service"
      : oracleChangeNeeded
        ? "Needs the wallet that owns the agent now"
        : "Not needed for the current oracle";

  if (!registryAddress) {
    return (
      <p className="text-xs text-amber-400/80">AgentRegistry is missing.</p>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Transfer ownership first. If the new owner uses another oracle, run the
        re-encryption step from the wallet that owns the agent after transfer,
        so keys and the ERC-8004 teeOracle service move together.
      </p>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <StepBox
          index={1}
          label="Transfer ownership"
          actor="current owner"
          status={transferStatus}
        >
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Recipient wallet
            </label>
            <input
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="0x..."
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={confirmTransfer}
              onChange={(event) => setConfirmTransfer(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-700 bg-gray-900 text-violet-600 focus:ring-violet-600"
            />
            <span>
              I understand private data is not re-encrypted until Step 2 is
              completed by the new owner after transfer.
            </span>
          </label>

          <button
            type="button"
            disabled={
              transferState.isPending ||
              !address ||
              !recipient.trim() ||
              !confirmTransfer
            }
            onClick={() => {
              transferState.run(async () => {
                const to = requiredAddress(recipient, "Recipient wallet");
                if (hasLinkedIdentity && !identityRegistryAddress) {
                  return {
                    error: "ERC-8004 IdentityRegistry is not configured.",
                  };
                }

                const walletClient = await getWalletClient();
                if (!walletClient) {
                  return { error: "Connect your wallet" };
                }
                const from = walletClient.account!.address;

                const nftHash = await walletClient.writeContract({
                  address: registryAddress,
                  abi: AGENT_REGISTRY_ABI,
                  functionName: "transferFrom",
                  args: [from, to, BigInt(tokenId)],
                  chain: walletClient.chain,
                  account: walletClient.account!,
                });
                await walletClient.waitForTransactionReceipt({
                  hash: nftHash,
                });

                if (linkedErc8004AgentId && identityRegistryAddress) {
                  try {
                    const identityHash = await walletClient.writeContract({
                      address: identityRegistryAddress,
                      abi: ERC721_TRANSFER_ABI,
                      functionName: "transferFrom",
                      args: [from, to, BigInt(linkedErc8004AgentId)],
                      chain: walletClient.chain,
                      account: walletClient.account!,
                    });
                    await walletClient.waitForTransactionReceipt({
                      hash: identityHash,
                    });
                  } catch (err) {
                    router.refresh();
                    return {
                      error: `NFT transferred, but ERC-8004 transfer failed: ${
                        err instanceof Error ? err.message : "Unknown error"
                      }`,
                    };
                  }
                }

                router.refresh();
                return { txHash: nftHash };
              });
            }}
            className="w-full px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {transferState.isPending ? "Transferring..." : "Transfer ownership"}
          </button>
          <ResultBanner result={transferState.result} />
        </StepBox>

        <StepBox
          index={2}
          label="Re-encrypt and update oracle"
          actor="agent owner"
          status={reencodeStatus}
        >
          <div className="space-y-2 text-xs">
            <div>
              <span className="block text-gray-500">Current oracle</span>
              <span className="break-all font-mono text-gray-300">
                {sourceOracleUrl || "Not configured"}
              </span>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Target oracle URL
              </label>
              <input
                value={targetOracleUrl}
                onChange={(event) => setTargetOracleUrl(event.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
              />
            </div>
          </div>

          <label className="flex items-start gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={confirmReencode}
              onChange={(event) => setConfirmReencode(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-700 bg-gray-900 text-violet-600 focus:ring-violet-600"
            />
            <span>
              I understand this signs re-encryption and updates the private data
              for the selected oracle.
            </span>
          </label>

          <button
            type="button"
            disabled={
              keyState.isPending ||
              !address ||
              !sourceOracleUrl ||
              !oracleChangeNeeded ||
              !confirmReencode
            }
            onClick={() => {
              keyState.run(async () => {
                if (!sourceOracleUrl) {
                  return { error: "teeOracle URL is missing." };
                }
                if (!linkedErc8004AgentId) {
                  return {
                    error: "This agent has no linked ERC-8004 identity.",
                  };
                }
                if (!identityRegistryAddress) {
                  return {
                    error: "ERC-8004 IdentityRegistry is not configured.",
                  };
                }

                const nextTargetOracleUrl = normalizeUrl(targetOracleUrl);
                if (!nextTargetOracleUrl) {
                  return { error: "Target oracle URL is required." };
                }
                if (nextTargetOracleUrl === sourceOracleUrl) {
                  return {
                    error: "Target oracle already matches the current oracle.",
                  };
                }
                setTargetOracleUrl(nextTargetOracleUrl);

                const walletClient = await getWalletClient();
                if (!walletClient) {
                  return { error: "Connect your wallet" };
                }

                const owner = walletClient.account!.address;

                const [sourceOracle, targetOracle] = await Promise.all([
                  oracleAddress(sourceOracleUrl),
                  oracleAddress(nextTargetOracleUrl),
                ]);
                if (!sourceOracle.address) {
                  return { error: "Source oracle /address missing address." };
                }
                if (!targetOracle.publicKey) {
                  return { error: "Target oracle /address missing publicKey." };
                }

                const chainId = await walletClient.getChainId();
                const deadline = Math.floor(Date.now() / 1000) + 3600;
                const typedData = buildReencryptTypedData({
                  oracleAddress: sourceOracle.address,
                  chainId,
                  tokenId: BigInt(tokenId),
                  from: owner,
                  to: owner,
                  deadline,
                });
                const oracleSignature = await walletClient.signTypedData({
                  account: walletClient.account!,
                  ...typedData,
                });

                const offer = await prepareTransferOfferAgent({
                  chainId: clientCfg.chain.id,
                  tokenId,
                  to: owner,
                  oracleUrl: sourceOracleUrl,
                  recipientPublicKey: targetOracle.publicKey,
                  oracleSignature,
                  oracleDeadline: String(deadline),
                });
                if ("error" in offer) return { error: offer.error };

                const signatureRequests =
                  getTransferAccessPayloadsToSign(offer);
                const accessSignatures = await Promise.all(
                  signatureRequests.map(async ({ index, digest }) => ({
                    index,
                    proof: await walletClient.signMessage({
                      account: walletClient.account!,
                      message: digest,
                    }),
                  })),
                );
                const acceptance = buildTransferAcceptance(
                  offer,
                  accessSignatures,
                );

                const erc8004TokenId = BigInt(linkedErc8004AgentId);
                const [approvedAddress, approvedForAll] = await Promise.all([
                  walletClient.readContract({
                    address: identityRegistryAddress,
                    abi: IDENTITY_REGISTRY_ABI,
                    functionName: "getApproved",
                    args: [erc8004TokenId],
                  }),
                  walletClient.readContract({
                    address: identityRegistryAddress,
                    abi: IDENTITY_REGISTRY_ABI,
                    functionName: "isApprovedForAll",
                    args: [owner, offer.contractAddress],
                  }),
                ]);
                const hasIdentityApproval =
                  approvedForAll ||
                  approvedAddress.toLowerCase() ===
                    offer.contractAddress.toLowerCase();
                if (!hasIdentityApproval) {
                  const approvalHash = await walletClient.writeContract({
                    address: identityRegistryAddress,
                    abi: IDENTITY_REGISTRY_ABI,
                    functionName: "approve",
                    args: [offer.contractAddress, erc8004TokenId],
                    chain: walletClient.chain,
                    account: walletClient.account!,
                  });
                  await walletClient.waitForTransactionReceipt({
                    hash: approvalHash,
                  });
                }

                const txArgs = buildTransferTxArgs(acceptance);
                const publishHash = await walletClient.writeContract({
                  ...txArgs,
                  chain: walletClient.chain,
                  account: walletClient.account!,
                });
                await walletClient.waitForTransactionReceipt({
                  hash: publishHash,
                });

                const metadataUpdate = await prepareTeeOracleServiceUpdate({
                  chainId: clientCfg.chain.id,
                  erc8004AgentId: linkedErc8004AgentId,
                  teeOracleUrl: nextTargetOracleUrl,
                });
                if ("error" in metadataUpdate) {
                  router.refresh();
                  return {
                    error: `Sealed keys published, but teeOracle metadata update failed: ${metadataUpdate.error}`,
                  };
                }

                const updateHash = await walletClient.writeContract({
                  address: metadataUpdate.erc8004RegistryAddress,
                  abi: IDENTITY_REGISTRY_ABI,
                  functionName: "setAgentURI",
                  args: [
                    BigInt(metadataUpdate.erc8004AgentId),
                    metadataUpdate.tokenUri,
                  ],
                  chain: walletClient.chain,
                  account: walletClient.account!,
                });
                await walletClient.waitForTransactionReceipt({
                  hash: updateHash,
                });

                router.refresh();
                return { txHash: updateHash };
              });
            }}
            className="w-full px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {keyState.isPending
              ? "Re-encrypting..."
              : "Re-encrypt and update oracle"}
          </button>
          <ResultBanner result={keyState.result} />
        </StepBox>
      </div>
    </div>
  );
}
