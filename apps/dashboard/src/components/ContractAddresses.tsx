import {
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  getDeploymentForChain,
} from "@/lib/client-config";
import { getNetworkConfigByChainId } from "@tee-agent/agent/config";

function ContractRow({
  label,
  address,
  explorer,
  tag,
}: {
  label: string;
  address: string | undefined;
  explorer: string;
  tag: string;
}) {
  if (!address) return null;
  return (
    <div className="grid grid-cols-[minmax(8rem,1fr)_5.5rem] lg:grid-cols-[11rem_5.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 py-3 border-t border-slate-800/80 first:border-t-0 items-center">
      <span className="text-sm font-medium text-slate-300 whitespace-nowrap">
        {label}
      </span>
      <span className="justify-self-start text-[10px] font-mono px-2 py-0.5 rounded border border-violet-900/50 text-violet-400 bg-violet-950/20 whitespace-nowrap">
        {tag}
      </span>
      <a
        href={`${explorer}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="col-span-2 lg:col-span-1 block min-w-0 overflow-x-auto whitespace-nowrap rounded-md border border-slate-800/80 bg-slate-950/50 px-3 py-2 text-xs font-mono text-slate-300 hover:text-violet-300 transition-colors"
      >
        {address}
      </a>
    </div>
  );
}

export default function ContractAddresses() {
  const deployedChains = [BASE_SEPOLIA_CHAIN_ID, BASE_CHAIN_ID]
    .map((chainId) => {
      const deployment = getDeploymentForChain(chainId);
      return {
        chainId,
        deployment,
        network: getNetworkConfigByChainId(chainId),
      };
    })
    .filter(
      ({ deployment }) =>
        deployment.agentRegistry || deployment.validationRegistry,
    );

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold text-slate-100">
          Deployed Contracts
        </h2>
      </div>
      {deployedChains.map(({ chainId, deployment, network }) => (
        <div key={chainId} className="glass-card rounded-xl px-5 py-4">
          <div className="pb-3">
            <a
              href={network.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono px-2.5 py-0.5 rounded-full border bg-violet-950/30 border-violet-900/50 text-violet-400 hover:text-violet-300 hover:border-violet-700 transition-colors"
            >
              {network.isTestnet ? "Base Sepolia" : "Base"} · {chainId} ↗
            </a>
          </div>
          <div>
            <ContractRow
              label="AgentRegistry"
              address={deployment.agentRegistry}
              explorer={network.explorerUrl}
              tag="ERC-7857"
            />
            <ContractRow
              label="ValidationRegistry"
              address={deployment.validationRegistry}
              explorer={network.explorerUrl}
              tag="ERC-8004"
            />
            <ContractRow
              label="Identity Registry"
              address={network.identityRegistryAddress}
              explorer={network.explorerUrl}
              tag="ERC-8004"
            />
            <ContractRow
              label="Reputation Registry"
              address={network.reputationRegistryAddress}
              explorer={network.explorerUrl}
              tag="ERC-8004"
            />
          </div>
        </div>
      ))}
    </section>
  );
}
