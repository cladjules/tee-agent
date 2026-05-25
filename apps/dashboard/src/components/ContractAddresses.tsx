import { cfg } from "@/lib/config";
const EXPLORER: Record<string, string> = {
  base: "https://basescan.org/address",
  baseSepolia: "https://sepolia.basescan.org/address",
};

function AddrRow({
  label,
  address,
  explorer,
  tag,
  isFirst,
}: {
  label: string;
  address: string | undefined;
  explorer: string;
  tag?: string;
  isFirst?: boolean;
}) {
  if (!address) return null;
  return (
    <tr className={`border-t border-gray-800 ${isFirst ? "border-t-0" : ""}`}>
      <td className="py-2 pr-6 text-sm text-gray-400 whitespace-nowrap align-top">
        {label}
        {tag && (
          <span className="ml-2 text-xs font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700">
            {tag}
          </span>
        )}
      </td>
      <td className="py-2 text-sm font-mono text-gray-200 break-all">
        <a
          href={`${explorer}/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-violet-400 transition-colors"
        >
          {address}
        </a>
      </td>
    </tr>
  );
}

const EXPLORER_ROOT: Record<string, string> = {
  base: "https://basescan.org",
  baseSepolia: "https://sepolia.basescan.org",
};

export default function ContractAddresses() {
  const explorer = EXPLORER[cfg.network] ?? EXPLORER.baseSepolia;
  const explorerRoot = EXPLORER_ROOT[cfg.network] ?? EXPLORER_ROOT.baseSepolia;
  const networkLabel = cfg.network === "base" ? "Base" : "Base Sepolia";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold text-gray-100">
          Deployed Contracts
        </h2>
        <a
          href={explorerRoot}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono px-2 py-0.5 rounded-full border bg-gray-900 border-gray-700 text-gray-400 hover:text-violet-400 hover:border-violet-700 transition-colors"
        >
          {networkLabel} · {cfg.chain.id} ↗
        </a>
      </div>
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 px-5 py-1">
        <table className="w-full">
          <tbody>
            <AddrRow
              isFirst
              label="AgentRegistry"
              address={cfg.registryAddress}
              explorer={explorer}
            />
            <AddrRow
              label="TeeVerifier"
              address={cfg.teeVerifierAddress}
              explorer={explorer}
            />
            <AddrRow
              label="ValidationRegistry"
              address={cfg.validationAddress}
              explorer={explorer}
            />
            <AddrRow
              label="Identity Registry"
              address={cfg.identityRegistryAddress}
              explorer={explorer}
              tag="ERC-8004"
            />
            <AddrRow
              label="Reputation Registry"
              address={cfg.reputationAddress}
              explorer={explorer}
              tag="ERC-8004"
            />
          </tbody>
        </table>
      </div>
    </div>
  );
}
