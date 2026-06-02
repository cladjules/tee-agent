"use server";

import { cookies } from "next/headers";
import {
  ACTIVE_CHAIN_COOKIE,
  DEFAULT_CHAIN_ID,
  isConfiguredChainId,
} from "@/lib/active-chain";

/**
 * Persists the wallet's active chain ID to a cookie so RSC pages can read it.
 * Called by <ChainSync> whenever the RainbowKit chain changes.
 */
export async function setActiveChain(chainId: number): Promise<void> {
  const nextChainId = isConfiguredChainId(chainId) ? chainId : DEFAULT_CHAIN_ID;
  const store = await cookies();
  store.set(ACTIVE_CHAIN_COOKIE, nextChainId.toString(), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
