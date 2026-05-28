import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, baseSepolia } from "viem/chains";

export const wagmiConfig = getDefaultConfig({
  appName: "Tee Agent",
  // Get a free project ID at https://cloud.walletconnect.com
  projectId:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "demo_project_id",
  chains: [base, baseSepolia],
  ssr: true,
});
