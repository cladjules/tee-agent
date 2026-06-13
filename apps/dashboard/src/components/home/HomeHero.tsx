export default function HomeHero() {
  return (
    <div className="relative pt-8 pb-4">
      <div className="absolute -left-10 top-0 w-[500px] h-[350px] bg-violet-900/10 blur-[100px] rounded-full pointer-events-none" />
      <div className="relative space-y-6 max-w-3xl">
        <h1 className="text-6xl md:text-7xl font-bold tracking-tight leading-[1.05]">
          <span className="gradient-text-animated">Tee</span>{" "}
          <span className="text-slate-200">Agent</span>
        </h1>
        <p className="text-lg text-slate-400 leading-relaxed max-w-xl">
          An 8004scan-compatible agent explorer upgraded with Validation
          Registry and ERC-7857 private skills, all encrypted and secured by a
          Phala Cloud TDX oracle verified on-chain through Automata DCAP.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <a
            href="https://www.teeagent.xyz/agents/new"
            className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm"
          >
            Mint Agent →
          </a>
          <a
            href="/docs"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-slate-700 hover:border-violet-700 hover:bg-violet-950/30 text-slate-300 hover:text-white font-semibold transition-all text-sm"
          >
            Read Docs →
          </a>
        </div>
      </div>
    </div>
  );
}
