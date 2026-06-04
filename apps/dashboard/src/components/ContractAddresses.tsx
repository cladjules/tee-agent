import {
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  getDeploymentForChain,
  getNetworkMetaForChain,
} from "@/lib/client-config";

function ContractRow({
  label,
  address,
  explorer,
  tag,
  scope,
}: {
  label: string;
  address: string | undefined;
  explorer: string;
  tag: string;
  scope?: "ours" | "global";
}) {
  if (!address) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[11rem_minmax(11rem,max-content)_minmax(0,1fr)] gap-x-4 gap-y-2 py-3 border-t border-slate-800/80 first:border-t-0 items-center">
      <div className="min-w-0">
        <span className="block text-sm font-medium text-slate-300">
          {label}
        </span>
        {scope && (
          <span className="block pt-0.5 text-[10px] uppercase tracking-wide text-slate-600">
            {scope === "ours" ? "Tee Agent" : "Global"}
          </span>
        )}
      </div>
      <span className="justify-self-start text-[10px] font-mono px-2 py-0.5 rounded border border-violet-900/50 text-violet-400 bg-violet-950/20 whitespace-nowrap">
        {tag}
      </span>
      <a
        href={`${explorer}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block min-w-0 overflow-x-auto whitespace-nowrap rounded-md border border-slate-800/80 bg-slate-950/50 px-3 py-2 text-xs font-mono text-slate-300 hover:text-violet-300 transition-colors"
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
        network: getNetworkMetaForChain(chainId),
      };
    })
    .filter(
      ({ deployment }) =>
        deployment.agentRegistry ||
        deployment.teeVerifier ||
        deployment.validationRegistry,
    );

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold text-slate-100">
          Contract Addresses
        </h2>
      </div>
      {deployedChains.map(({ chainId, deployment, network }) => (
        <div key={chainId} className="glass-card rounded-xl px-5 py-4">
          <div>
            <div className="mb-3">
              <a
                href={network.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono px-2.5 py-0.5 rounded-full border bg-violet-950/30 border-violet-900/50 text-violet-400 hover:text-violet-300 hover:border-violet-700 transition-colors"
              >
                {network.label} · {chainId} ↗
              </a>
            </div>
            <ContractRow
              label="AgentRegistry"
              address={deployment.agentRegistry}
              explorer={network.explorerUrl}
              tag="ERC-7857"
              scope="ours"
            />
            <ContractRow
              label="TeeVerifier"
              address={deployment.teeVerifier}
              explorer={network.explorerUrl}
              tag="ERC-7857 + ERC-8004"
              scope="ours"
            />
            <ContractRow
              label="ValidationRegistry"
              address={deployment.validationRegistry}
              explorer={network.explorerUrl}
              tag="ERC-8004"
              scope="ours"
            />
          </div>
          <div className="pt-4">
            <div className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Global ERC-8004 contracts
            </div>
            <ContractRow
              label="Identity Registry"
              address={network.identityRegistryAddress}
              explorer={network.explorerUrl}
              tag="ERC-8004"
              scope="global"
            />
            <ContractRow
              label="Reputation Registry"
              address={network.reputationRegistryAddress}
              explorer={network.explorerUrl}
              tag="ERC-8004"
              scope="global"
            />
          </div>
        </div>
      ))}
    </section>
  );
}
