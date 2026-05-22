"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Address, Chain, PublicClient, WalletClient } from "viem";
import { custom, createPublicClient, createWalletClient } from "viem";
import { base, baseSepolia } from "viem/chains";
import { APP_CHAIN } from "@/lib/config";

type ProviderLike = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};

type WalletStatus = "idle" | "connecting" | "connected";

type EIP6963ProviderInfo = {
  rdns: string;
};

type EIP6963ProviderDetail = {
  info: EIP6963ProviderInfo;
  provider: ProviderLike;
};

type EIP6963AnnounceEvent = CustomEvent<EIP6963ProviderDetail>;

interface WalletContextValue {
  address: Address | null;
  chainId: number | null;
  status: WalletStatus;
  connect: () => Promise<{ address: Address; chainId: number }>;
  disconnect: () => Promise<void>;
  switchChain: () => Promise<void>;
  getViemClients: () => Promise<{
    address: Address;
    publicClient: PublicClient;
    walletClient: WalletClient;
  }>;
}

const SESSION_KEY_PREFIX = "eip6963:";

const CHAIN_BY_ID: Record<string, Chain> = {
  [base.id.toString()]: base,
  [baseSepolia.id.toString()]: baseSepolia,
};

const WalletContext = createContext<WalletContextValue | null>(null);

let providersDiscoveryPromise: Promise<EIP6963ProviderDetail[]> | null = null;

async function discoverProviders(
  timeoutMs = 350,
): Promise<EIP6963ProviderDetail[]> {
  if (typeof window === "undefined") return [];
  if (providersDiscoveryPromise) return providersDiscoveryPromise;

  providersDiscoveryPromise = new Promise((resolve) => {
    const providersByRdns = new Map<string, EIP6963ProviderDetail>();

    const onAnnounceProvider = (event: Event) => {
      const detail = (event as EIP6963AnnounceEvent).detail;
      if (!detail?.info?.rdns || !detail?.provider) return;
      providersByRdns.set(detail.info.rdns, detail);
    };

    const finish = () => {
      window.removeEventListener(
        "eip6963:announceProvider",
        onAnnounceProvider as EventListener,
      );
      resolve(Array.from(providersByRdns.values()));
      providersDiscoveryPromise = null;
    };

    window.addEventListener(
      "eip6963:announceProvider",
      onAnnounceProvider as EventListener,
    );
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.setTimeout(finish, timeoutMs);
  });

  return providersDiscoveryPromise;
}

function findStoredProviderRdns() {
  if (typeof window === "undefined") return null;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(SESSION_KEY_PREFIX)) {
        return key.slice(SESSION_KEY_PREFIX.length);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function resolveChain(chainId: number): Chain {
  return (
    CHAIN_BY_ID[chainId] ??
    ({
      id: chainId,
      name: `Chain ${chainId}`,
      nativeCurrency: {
        decimals: 18,
        name: "Native Token",
        symbol: "ETH",
      },
      rpcUrls: {
        default: {
          http: [],
        },
      },
    } as Chain)
  );
}

async function resolveProvider(preferredRdns?: string | null) {
  const providers = await discoverProviders();
  if (providers.length === 0) {
    throw new Error("No EIP-6963 wallet found in this browser.");
  }

  return (
    (preferredRdns
      ? providers.find((entry) => entry.info.rdns === preferredRdns)
      : undefined) ?? providers[0]
  );
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const providerRef = useRef<ProviderLike | null>(null);
  const sessionRdnsRef = useRef<string | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<WalletStatus>("idle");

  const persistSession = useCallback(
    (nextAddress: Address, chainId: number, rdns: string) => {
      try {
        localStorage.setItem(
          SESSION_KEY_PREFIX + rdns,
          JSON.stringify({
            connectionMethod: "eip6963",
            address: nextAddress,
            chainId: chainId,
            sessionData: rdns,
            connectedAt: Date.now(),
          }),
        );
      } catch {
        // ignore storage errors
      }
    },
    [],
  );

  const clearSession = useCallback(() => {
    try {
      if (sessionRdnsRef.current) {
        localStorage.removeItem(SESSION_KEY_PREFIX + sessionRdnsRef.current);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const connect = useCallback(async () => {
    setStatus("connecting");
    const detail = await resolveProvider(
      sessionRdnsRef.current ?? findStoredProviderRdns(),
    );
    const provider = detail.provider as ProviderLike;
    const accounts = (await provider.request({
      method: "eth_requestAccounts",
    })) as string[];

    if (!accounts.length) {
      setStatus("idle");
      throw new Error("No wallet account was returned.");
    }

    const nextAddress = accounts[0] as Address;
    const hexChainId = (await provider.request({
      method: "eth_chainId",
    })) as string;
    const chainId = parseInt(hexChainId, 16);

    providerRef.current = provider;
    sessionRdnsRef.current = detail.info.rdns;
    setAddress(nextAddress);
    setChainId(chainId);
    setStatus("connected");
    persistSession(nextAddress, chainId, detail.info.rdns);

    return { address: nextAddress, chainId: chainId };
  }, [persistSession]);

  const disconnect = useCallback(async () => {
    clearSession();
    providerRef.current = null;
    sessionRdnsRef.current = null;
    setAddress(null);
    setChainId(null);
    setStatus("idle");
  }, [clearSession]);

  const getViemClients = useCallback(async () => {
    let nextAddress = address;

    if (!providerRef.current || !nextAddress) {
      const connected = await connect();
      nextAddress = connected.address;
    }

    const provider = providerRef.current;
    if (!provider || !nextAddress) {
      throw new Error("Wallet is not connected.");
    }

    const chain = APP_CHAIN;
    const transport = custom(provider);
    const walletClient = createWalletClient({
      account: nextAddress,
      chain,
      transport,
    });
    const publicClient = createPublicClient({ chain, transport });
    return { address: nextAddress, walletClient, publicClient };
  }, [address, chainId, connect]);

  const switchChain = useCallback(async () => {
    const { walletClient } = await getViemClients();
    try {
      await walletClient.switchChain({ id: APP_CHAIN.id });
    } catch (e) {
      const err = e as { code?: number };
      if (err?.code === 4902) {
        await walletClient.addChain({ chain: APP_CHAIN });
      } else throw e;
    }
  }, [getViemClients]);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const storedRdns = findStoredProviderRdns();
      if (!storedRdns) return;

      try {
        const detail = await resolveProvider(storedRdns);
        const provider = detail.provider as ProviderLike;
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as string[];
        if (!accounts.length || cancelled) {
          clearSession();
          return;
        }

        const nextAddress = accounts[0] as Address;
        const hexChainId = (await provider.request({
          method: "eth_chainId",
        })) as string;
        const chainId = parseInt(hexChainId, 16);

        providerRef.current = provider;
        sessionRdnsRef.current = detail.info.rdns;
        setAddress(nextAddress);
        setChainId(chainId);
        setStatus("connected");
        persistSession(nextAddress, chainId, detail.info.rdns);
      } catch {
        if (!cancelled) {
          clearSession();
          setStatus("idle");
        }
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [clearSession, persistSession]);

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      chainId,
      status,
      connect,
      disconnect,
      switchChain,
      getViemClients,
    }),
    [
      address,
      chainId,
      status,
      connect,
      disconnect,
      switchChain,
      getViemClients,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet must be used inside WalletProvider.");
  }
  return value;
}
