import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, baseSepolia } from "viem/chains";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
if (!walletConnectProjectId) {
  throw new Error("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required.");
}

export const wagmiConfig = getDefaultConfig({
  appName: "Tee Agent",
  projectId: walletConnectProjectId,
  chains: [base, baseSepolia],
  ssr: true,
});
