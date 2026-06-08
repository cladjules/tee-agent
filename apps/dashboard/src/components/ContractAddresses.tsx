import { getDeploymentForChain } from "@/lib/config";
import { DEFAULT_NETWORK, NETWORK_CONFIG } from "@tee-agent/agent/network";

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
    <div className="grid grid-cols-[minmax(6rem,8rem)_minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded-md border border-slate-800/70 bg-slate-950/35 px-2.5 py-2">
      <div className="min-w-0 leading-none">
        <span className="block truncate text-xs font-medium text-slate-300">
          {label}
        </span>
        <span className="mt-1 block text-[9px] uppercase tracking-wide text-slate-600">
          {scope === "global" ? "Global" : "Tee Agent"} · {tag}
        </span>
      </div>
      <a
        href={`${explorer}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        title={address}
        className="block min-w-0 truncate rounded border border-slate-800/80 bg-slate-950/60 px-2 py-1.5 text-[11px] font-mono text-slate-400 transition-colors hover:text-violet-300"
      >
        {address}
      </a>
    </div>
  );
}

export default function ContractAddresses() {
  const deployedChains = [
    DEFAULT_NETWORK,
    ...Object.values(NETWORK_CONFIG).filter(
      (network) => network !== DEFAULT_NETWORK,
    ),
  ]
    .map((network) => {
      const chainId = network.chain.id;
      const deployment = getDeploymentForChain(chainId);
      return {
        chainId,
        deployment,
        network,
      };
    })
    .filter(
      ({ deployment }) =>
        deployment.agentRegistry ||
        deployment.teeVerifier ||
        deployment.validationRegistry,
    );

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Contract Addresses
        </h2>
      </div>
      {deployedChains.map(({ chainId, deployment, network }) => (
        <div key={chainId} className="glass-card rounded-lg px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <a
                href={network.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono text-violet-400 transition-colors hover:text-violet-300"
              >
                {network.label} · {chainId} ↗
              </a>
            </div>
            <span className="rounded border border-slate-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-600">
              Live
            </span>
          </div>
          <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
            <ContractRow
              label="AgentRegistry"
              address={deployment.agentRegistry}
              explorer={network.explorerUrl}
              tag="ERC-7857"
              scope="ours"
            />
            <ContractRow
              label="Reputation Registry"
              address={network.reputationRegistryAddress}
              explorer={network.explorerUrl}
              tag="ERC-8004"
              scope="global"
            />
            <ContractRow
              label="TeeVerifier"
              address={deployment.teeVerifier}
              explorer={network.explorerUrl}
              tag="ERC-7857 + ERC-8004"
              scope="ours"
            />
            <ContractRow
              label="Identity Registry"
              address={network.identityRegistryAddress}
              explorer={network.explorerUrl}
              tag="ERC-8004"
              scope="global"
            />
            <ContractRow
              label="ValidationRegistry"
              address={deployment.validationRegistry}
              explorer={network.explorerUrl}
              tag="ERC-8004"
              scope="ours"
            />
          </div>
        </div>
      ))}
    </section>
  );
}
