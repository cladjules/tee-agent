"use server";

import { cookies } from "next/headers";
import { ACTIVE_CHAIN_COOKIE } from "@/lib/config";

/**
 * Persists the wallet's active chain ID to a cookie so RSC pages can read it.
 * Called by <ChainSync> whenever the RainbowKit chain changes.
 */
export async function setActiveChain(chainId: number): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_CHAIN_COOKIE, chainId.toString(), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
