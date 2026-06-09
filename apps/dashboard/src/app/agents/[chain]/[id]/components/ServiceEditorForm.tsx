"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentService } from "@tee-agent/agent/types";
import { IDENTITY_REGISTRY_ABI } from "@tee-agent/agent/abis";
import {
  ServiceEditorPanel,
  type ServiceEditorEntry,
} from "@/components/ServiceEditorPanel";
import { useWallet } from "@/providers/WalletProvider";
import { prepareUpdateAgentServices } from "@/lib/actions/agents";
import { ResultBanner, SubmitButton, useActionState } from "./ActionUI";

export function ServiceEditorForm({
  agentId,
  chainId,
  initialServices,
}: {
  agentId: string;
  chainId: number;
  initialServices: readonly AgentService[];
}) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { getWalletClient } = useWallet();
  const [builtServices, setBuiltServices] = useState<ServiceEditorEntry[]>([]);
  const initialTeeOracleUrl =
    initialServices.find((service) => service.name === "teeOracle")?.endpoint ??
    "";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const walletClient = await getWalletClient();
          if (!walletClient) {
            return { error: "Connect your wallet" };
          }

          const nextTeeOracleUrl =
            builtServices.find((service) => service.name === "teeOracle")
              ?.endpoint ?? "";
          if (nextTeeOracleUrl !== initialTeeOracleUrl) {
            return {
              error:
                "Changing teeOracle requires Oracle Rotation, not a services edit.",
            };
          }
          const prepared = await prepareUpdateAgentServices({
            chainId,
            tokenId: agentId,
            servicesJson: builtServices,
          });
          if ("error" in prepared) return { error: prepared.error };
          const { erc8004RegistryAddress, erc8004AgentId, tokenUri } = prepared;

          const hash = await walletClient.writeContract({
            address: erc8004RegistryAddress,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "setAgentURI",
            args: [BigInt(erc8004AgentId), tokenUri],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await walletClient.waitForTransactionReceipt({ hash });
          router.refresh();
          return { txHash: hash };
        });
      }}
      className="space-y-4"
    >
      <ServiceEditorPanel
        initialServices={initialServices}
        onChange={setBuiltServices}
        lockTeeOracle
      />

      <SubmitButton isPending={isPending} label="Save Services" />
      <ResultBanner result={result} />
    </form>
  );
}
