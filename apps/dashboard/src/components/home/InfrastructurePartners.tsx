const PARTNERS = [
  {
    name: "Pinata IPFS",
    mark: "IPFS",
    tone: "border-cyan-500/25 bg-cyan-500/10 text-cyan-300",
    description:
      "Pins public ERC-8004 agent metadata and teeOracle service URLs.",
  },
  {
    name: "0G Storage",
    mark: "0G",
    tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    description:
      "Stores encrypted ERC-7857 skills, prompts, models, and private blobs.",
  },
  {
    name: "Phala CVM",
    mark: "TDX",
    tone: "border-violet-500/25 bg-violet-500/10 text-violet-300",
    description:
      "Runs oracle code inside Intel TDX so private agent data stays sealed.",
  },
  {
    name: "Automata DCAP",
    mark: "DCAP",
    tone: "border-sky-500/25 bg-sky-500/10 text-sky-300",
    description:
      "Verifies TDX quotes on-chain before oracle results become trusted.",
  },
  {
    name: "Arbitrum",
    mark: "ARB",
    tone: "border-blue-500/25 bg-blue-500/10 text-blue-300",
    description:
      "Hosts the agent NFTs, validation module, verifier, and reputation flow.",
  },
  {
    name: "ERC-8004 / ERC-7857",
    mark: "ERC",
    tone: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    description:
      "Combines agent identity, reputation, validation, and encrypted ownership.",
  },
] as const;

export default function InfrastructurePartners() {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
            Powered by
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-100">
            Infrastructure we build on
          </h2>
        </div>
        <p className="max-w-xl text-sm leading-6 text-slate-500">
          Each layer has one job: public identity, encrypted storage, TEE
          compute, hardware proof, and settlement.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PARTNERS.map((partner) => (
          <article
            key={partner.name}
            className="glass-card flex min-h-32 gap-4 rounded-xl p-4"
          >
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border font-mono text-[11px] font-semibold ${partner.tone}`}
            >
              {partner.mark}
            </div>
            <div className="min-w-0 space-y-1.5">
              <h3 className="text-sm font-semibold text-slate-100">
                {partner.name}
              </h3>
              <p className="text-xs leading-5 text-slate-500">
                {partner.description}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
