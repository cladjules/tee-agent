"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { publicActions } from "viem";
import type { Address, PublicActions, WalletClient } from "viem";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { getWalletClient as getWagmiWalletClient } from "@wagmi/core";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "@/lib/wagmi";
import { getAvailableChainId } from "@/lib/config";

// ── Types (kept stable so all consumers compile unchanged) ────────────────────

type WalletStatus =
  | "disconnected"
  | "connected"
  | "reconnecting"
  | "connecting";

interface WalletContextValue {
  address: Address | undefined;
  chainId: number | undefined;
  status: WalletStatus;
  /** Opens the RainbowKit connect modal (or resolves immediately if already connected). */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  walletClient: (WalletClient & PublicActions) | undefined;
  getWalletClient: () => Promise<(WalletClient & PublicActions) | undefined>;
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
  const { address, chainId: accountChainId, status } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const [walletClient, setWalletClient] = useState<
    (WalletClient & PublicActions) | undefined
  >();

  const activeChainId = getAvailableChainId(accountChainId);

  const connect = useCallback(async () => {
    if (address) return; // already connected
    openConnectModal?.();
  }, [address, openConnectModal]);

  const disconnect = useCallback(async () => {
    await disconnectAsync();
  }, [disconnectAsync]);

  const getWalletClient = useCallback(async () => {
    if (!address) {
      setWalletClient(undefined);
      return undefined;
    }

    if (activeChainId !== accountChainId) {
      await switchChainAsync({ chainId: activeChainId });
    }

    const nextWalletClient = (
      await getWagmiWalletClient(wagmiConfig, {
        chainId: activeChainId,
      })
    ).extend(publicActions);

    setWalletClient(nextWalletClient);
    return nextWalletClient;
  }, [activeChainId, address, accountChainId, switchChainAsync]);

  useEffect(() => {
    if (!address) {
      setWalletClient(undefined);
      return;
    }
    void getWalletClient().catch(() => setWalletClient(undefined));
  }, [address, activeChainId, getWalletClient]);

  return useMemo(
    () => ({
      address,
      chainId: activeChainId,
      status: status as WalletStatus,
      connect,
      disconnect,
      walletClient,
      getWalletClient,
    }),
    [
      address,
      activeChainId,
      status,
      connect,
      disconnect,
      walletClient,
      getWalletClient,
    ],
  );
}
