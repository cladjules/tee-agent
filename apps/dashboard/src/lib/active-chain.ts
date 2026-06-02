/**
 * Server-side helper: reads the active EVM chain ID from the request cookie.
 *
 * The cookie is set by the `setActiveChain` Server Action (actions/network.ts),
 * which is called by the `<ChainSync>` client component whenever the RainbowKit
 * wallet chain changes. RSC pages and Server Actions read this value to determine
 * which network's data to return.
 *
 * Falls back to baseSepolia when no cookie is present.
 */

import { cookies } from "next/headers";
import {
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  getDeploymentForChain,
} from "./client-config";

export { BASE_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID };

export const ACTIVE_CHAIN_COOKIE = "active_chain_id";
export const SUPPORTED_CHAIN_IDS = [
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
] as const;

export function isConfiguredChainId(chainId: number): boolean {
  if (!(SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId)) {
    return false;
  }
  return !!getDeploymentForChain(chainId).agentRegistry;
}

export const CONFIGURED_CHAIN_IDS = SUPPORTED_CHAIN_IDS.filter((id) =>
  isConfiguredChainId(id),
);

export const DEFAULT_CHAIN_ID = isConfiguredChainId(BASE_SEPOLIA_CHAIN_ID)
  ? BASE_SEPOLIA_CHAIN_ID
  : (CONFIGURED_CHAIN_IDS[0] ?? BASE_SEPOLIA_CHAIN_ID);

export async function getActiveChainId(): Promise<number> {
  const store = await cookies();
  const val = store.get(ACTIVE_CHAIN_COOKIE)?.value;
  const id = val ? parseInt(val, 10) : NaN;
  return isConfiguredChainId(id) ? id : DEFAULT_CHAIN_ID;
}
