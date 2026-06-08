"use client";

/**
 * Keeps the server-side active chain cookie in sync with the RainbowKit wallet chain.
 * Renders nothing — mount once in the root layout inside <WalletProvider>.
 *
 * When the user switches networks in their wallet:
 *   1. useChainId() detects the change
 *   2. setActiveChain() persists it to a cookie via Server Action
 *   3. router.refresh() causes RSC pages to re-render with the new chain's data
 */

import { useEffect, useRef } from "react";
import { useChainId } from "wagmi";
import { useRouter } from "next/navigation";
import { setActiveChain } from "@/lib/actions/network";

export default function ChainSync() {
  const chainId = useChainId();
  const router = useRouter();
  const prevChainId = useRef<number | null>(null);

  useEffect(() => {
    if (prevChainId.current !== null && prevChainId.current !== chainId) {
      setActiveChain(chainId).then(() => router.refresh());
    }
    prevChainId.current = chainId;
  }, [chainId, router]);

  return null;
}
