const FEATURES = [
  {
    badge: "ERC-8004",
    title: "Official agent identity",
    body: "Mint an ERC-8004 agent on the official registries, publish the teeOracle service on IPFS, and stay compatible with 8004scan.io.",
  },
  {
    badge: "ERC-8004 - Validation Registry",
    title: "Intel TDX - TEE-backed reputation",
    body: "Use a shared Validation Module with a TEE verifier/oracle to turn DCAP-backed results into Sybil-resistant feedback for the Reputation Module.",
  },
  {
    badge: "ERC-7857",
    title: "Intel TDX - TEE Encrypted private skills",
    body: "Encrypt agent data such as skills, prompts, and models so only your oracle can decode it, uploaded to 0G Storage, with secure re-encryption during ownership transfer.",
  },
] as const;

export default function FeatureStrip() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {FEATURES.map((feature) => (
        <div
          key={feature.title}
          className="glass-card p-5 rounded-xl space-y-3"
        >
          <span className="inline-block rounded-md border border-violet-800/30 bg-violet-950/50 px-2.5 py-0.5 font-mono text-xs text-violet-400">
            {feature.badge}
          </span>
          <h3 className="text-sm font-semibold text-slate-100">
            {feature.title}
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            {feature.body}
          </p>
        </div>
      ))}
    </div>
  );
}
