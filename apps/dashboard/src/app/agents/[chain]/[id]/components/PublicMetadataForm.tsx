"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentService } from "@tee-agent/agent/types";
import { AGENT_REGISTRY_ABI } from "@tee-agent/agent/abis";
import {
  AgentMetadataForm,
  type AgentMetadataFormValue,
} from "@/components/AgentMetadataForm";
import { useWallet } from "@/providers/WalletProvider";
import { prepareUpdateAgentPublicMetadata } from "@/lib/actions/agents";
import {
  BackgroundActionModal,
  ResultBanner,
  SubmitButton,
  useActionState,
} from "./ActionUI";

export function PublicMetadataForm({
  agentId,
  chainId,
  initialMetadata,
  createdAt,
  services,
}: {
  agentId: string;
  chainId: number;
  initialMetadata: AgentMetadataFormValue;
  createdAt?: number;
  services: readonly AgentService[];
}) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { getWalletClient } = useWallet();
  const [metadata, setMetadata] =
    useState<AgentMetadataFormValue>(initialMetadata);
  const [showBackgroundNotice, setShowBackgroundNotice] = useState(false);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(async () => {
          const walletClient = await getWalletClient();
          if (!walletClient) {
            return { error: "Connect your wallet" };
          }

          const prepared = await prepareUpdateAgentPublicMetadata({
            chainId,
            tokenId: agentId,
            name: metadata.name,
            description: metadata.description,
            imageUrl: metadata.imageUrl || undefined,
            agentType: metadata.agentType || undefined,
            services: services.map((service) => ({
              name: service.name,
              endpoint: service.endpoint,
              ...(service.version ? { version: service.version } : {}),
              ...(service.skills ? { skills: [...service.skills] } : {}),
              ...(service.domains ? { domains: [...service.domains] } : {}),
            })),
            createdAt,
          });
          if ("error" in prepared) return { error: prepared.error };

          setShowBackgroundNotice(true);

          const hash = await walletClient.writeContract({
            address: prepared.contractAddress,
            abi: AGENT_REGISTRY_ABI,
            functionName: "setTokenURI",
            args: [BigInt(prepared.tokenId), prepared.publicMetadataUri],
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
      <BackgroundActionModal
        open={showBackgroundNotice}
        onClose={() => setShowBackgroundNotice(false)}
      />
      <AgentMetadataForm value={metadata} onChange={setMetadata} />
      <SubmitButton isPending={isPending} label="Save ERC-721 Metadata" />
      <ResultBanner result={result} />
    </form>
  );
}
