import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { NETWORK_CONFIG } from "@tee-agent/agent/network";
import type { Chain } from "viem";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
if (!walletConnectProjectId) {
  throw new Error("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required.");
}

const chains = Object.values(NETWORK_CONFIG).map(
  (network) => network.chain,
) as unknown as [Chain, ...Chain[]];

export const wagmiConfig = getDefaultConfig({
  appName: "Tee Agent",
  projectId: walletConnectProjectId,
  chains,
  ssr: true,
});
