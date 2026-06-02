"use client";

import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import type { Address, PublicClient, WalletClient } from "viem";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { getPublicClient, getWalletClient } from "@wagmi/core";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "@/lib/wagmi";
import { clientCfg } from "@/lib/client-config";

const TARGET_CHAIN_ID = clientCfg.chain.id as 8453 | 84532;

// ── Types (kept stable so all consumers compile unchanged) ────────────────────

type WalletStatus = "idle" | "connecting" | "connected";

interface WalletContextValue {
  address: Address | null;
  chainId: number | null;
  status: WalletStatus;
  /** Opens the RainbowKit connect modal (or resolves immediately if already connected). */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchChain: () => Promise<void>;
  getViemClients: () => Promise<{
    address: Address;
    publicClient: PublicClient;
    walletClient: WalletClient;
  }>;
}

// ── QueryClient singleton ─────────────────────────────────────────────────────

const queryClient = new QueryClient();

// ── Provider ──────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWallet(): WalletContextValue {
  const { address: rawAddress, chainId: rawChainId, status } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();

  // Keep these available for getViemClients (they're hooks so must be at top level).
  // The actual wagmi action functions handle the async calls below.

  const address = rawAddress ?? null;
  const chainId = rawChainId ?? null;
  const walletStatus: WalletStatus =
    status === "connected"
      ? "connected"
      : status === "connecting" || status === "reconnecting"
        ? "connecting"
        : "idle";

  const connect = useCallback(async () => {
    if (rawAddress) return; // already connected
    openConnectModal?.();
  }, [rawAddress, openConnectModal]);

  const disconnect = useCallback(async () => {
    await disconnectAsync();
  }, [disconnectAsync]);

  const switchChain = useCallback(async () => {
    await switchChainAsync({ chainId: TARGET_CHAIN_ID });
  }, [switchChainAsync]);

  const getViemClients = useCallback(async () => {
    if (!rawAddress) throw new Error("Wallet not connected.");
    const publicClient = getPublicClient(wagmiConfig, {
      chainId: TARGET_CHAIN_ID,
    });

    let walletClient: WalletClient | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        walletClient = (await getWalletClient(wagmiConfig, {
          chainId: TARGET_CHAIN_ID,
        })) as WalletClient | undefined;
        if (walletClient?.chain?.id === TARGET_CHAIN_ID) break;
      } catch (err) {
        lastError = err;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    if (!walletClient) throw new Error("Wallet client unavailable.");
    if (walletClient.chain?.id !== TARGET_CHAIN_ID) {
      throw lastError instanceof Error
        ? lastError
        : new Error(
            `Wallet is not on ${clientCfg.chain.name}. Switch networks and try again.`,
          );
    }

    return {
      address: rawAddress,
      publicClient: publicClient as PublicClient,
      walletClient: walletClient as WalletClient,
    };
  }, [rawAddress]);

  return useMemo(
    () => ({
      address,
      chainId,
      status: walletStatus,
      connect,
      disconnect,
      switchChain,
      getViemClients,
    }),
    [
      address,
      chainId,
      walletStatus,
      connect,
      disconnect,
      switchChain,
      getViemClients,
    ],
  );
}
