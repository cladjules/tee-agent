import { ProcessTag } from "./HomePrimitives";

const PROCESS_COLUMNS = [
  {
    label: "WebApp / User",
    steps: [
      {
        title: "Deploy CVM + mint agent",
        body: "Deploy the Phala CVM oracle first, then mint an official ERC-8004 agent with the printed HTTPS endpoint published as its teeOracle service.",
        tags: ["Phala endpoint", "ERC-8004"],
      },
      {
        title: "Run your oracle and verify proof",
        body: "Apps call the oracle endpoint for owner-signed runs, then pass the returned proof bundle to /verify when they need off-chain proof.",
        tags: ["/run", "/verify"],
      },
      {
        title: "Request validation",
        body: "The app writes a ValidationRequest that points at TeeVerifier and references the run payload, output, score, quote, and request hash.",
        tags: ["ValidationRequest", "TeeVerifier"],
      },
      {
        title: "Transfer ownership",
        body: "When the agent is sold or transferred, the new owner chooses an oracle endpoint and signs the re-encryption flow.",
        tags: ["Transfer", "New owner"],
      },
    ],
  },
  {
    label: "Phala CVM / Oracle",
    steps: [
      {
        title: "Bring your handler",
        body: "Copy an oracle example, replace the handler with your app logic, and deploy it as a Phala Cloud CVM with the repo scripts.",
        tags: ["Custom handler", "Phala CVM"],
      },
      {
        title: "Run inside Intel TDX",
        body: "The oracle checks ownership, decrypts ERC-7857 data only inside the TEE, runs code or model inference, and returns the result with a TDX quote.",
        tags: ["Intel TDX", "TEE quote"],
      },
      {
        title: "Validate with AI",
        body: "For validation, the oracle can rerun inference with another model at temperature 0 and compare the original result, score, and reasoning.",
        tags: ["/validate", "temperature 0"],
      },
      {
        title: "Re-wrap keys in TEE",
        body: "The current oracle re-wraps ERC-7857 content keys to the new oracle key inside the TEE without exposing plaintext.",
        tags: ["Re-encryption", "TEE"],
      },
    ],
  },
  {
    label: "Blockchain",
    steps: [
      {
        title: "Publish identity + endpoint",
        body: "AgentRegistry mints ERC-7857 encrypted skills, links the official ERC-8004 identity, and publishes metadata on IPFS. Encoded hash on 0G Storage.",
        tags: ["ERC-7857", "8004scan"],
      },
      {
        title: "Verify TEE proof",
        body: "TeeVerifier and Automata DCAP verify Intel TDX quotes before trusting oracle registration, validation proofs, or transfer proofs.",
        tags: ["TeeVerifier", "Automata DCAP"],
      },
      {
        title: "Feed reputation",
        body: "Validated runs can feed ERC-8004 reputation with TEE proof, reducing Sybil-prone self-reporting from arbitrary wallets.",
        tags: ["Reputation", "Sybil-resistant"],
      },
      {
        title: "Move identity + data",
        body: "The ERC-7857 NFT and linked ERC-8004 identity move together, while encrypted data remains anchored on-chain.",
        tags: ["ERC-7857", "ERC-8004"],
      },
    ],
  },
] as const;

function ProcessStep({
  index,
  title,
  body,
  tags,
}: {
  index: number;
  title: string;
  body: string;
  tags: readonly string[];
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-800 bg-slate-950/45 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-violet-800/60 bg-violet-950/40 text-[10px] font-mono text-violet-300">
          {index}
        </span>
        <h4 className="text-sm font-semibold text-slate-100">{title}</h4>
      </div>
      <p className="text-xs leading-5 text-slate-500">{body}</p>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
        {tags.map((tag) => (
          <ProcessTag key={tag}>{tag}</ProcessTag>
        ))}
      </div>
    </div>
  );
}

function ProcessColumn({
  label,
  steps,
}: {
  label: string;
  steps: (typeof PROCESS_COLUMNS)[number]["steps"];
}) {
  return (
    <div className="grid min-w-0 grid-rows-[auto_repeat(4,minmax(0,1fr))] gap-2">
      <div className="rounded-lg border border-violet-900/40 bg-violet-950/20 px-3 py-2">
        <h3 className="text-sm font-semibold text-slate-100">{label}</h3>
      </div>
      {steps.map((step, index) => (
        <ProcessStep
          key={step.title}
          index={index + 1}
          title={step.title}
          body={step.body}
          tags={step.tags}
        />
      ))}
    </div>
  );
}

export default function ProcessDiagram() {
  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">
            8004scan, With Validation, Proof And Private Skills
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Start with official ERC-8004 discovery, run private encrypted skills
            through a Phala CVM oracle endpoint, verify TDX quotes, then turn
            validated runs into Sybil-resistant reputation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ProcessTag>ERC-8004</ProcessTag>
          <ProcessTag>ERC-7857</ProcessTag>
          <ProcessTag>Phala CVM</ProcessTag>
          <ProcessTag>Automata DCAP</ProcessTag>
        </div>
      </div>

      <div className="glass-card rounded-xl p-4 md:p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <ProcessColumn
            label={PROCESS_COLUMNS[0].label}
            steps={PROCESS_COLUMNS[0].steps}
          />
          <div className="hidden items-center text-violet-500 lg:flex">
            <span className="font-mono text-xl">→</span>
          </div>
          <ProcessColumn
            label={PROCESS_COLUMNS[1].label}
            steps={PROCESS_COLUMNS[1].steps}
          />
          <div className="hidden items-center text-violet-500 lg:flex">
            <span className="font-mono text-xl">→</span>
          </div>
          <ProcessColumn
            label={PROCESS_COLUMNS[2].label}
            steps={PROCESS_COLUMNS[2].steps}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-cyan-100">
                  Bring Your Own Oracle Handler
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Copy one of the oracle examples under{" "}
                  <code className="font-mono text-cyan-200">
                    apps/oracle/src/examples
                  </code>
                  , replace the handler with your app logic, then deploy it with{" "}
                  <code className="font-mono text-cyan-200">
                    npm run oracle:deploy
                  </code>
                  . The printed Phala HTTPS endpoint is the URL published as the
                  ERC-8004 teeOracle service and called by /run, /verify,
                  /validate, and re-encryption flows.
                </p>
              </div>
              <ProcessTag>Custom handler</ProcessTag>
            </div>
          </div>

          <div className="rounded-lg border border-violet-900/40 bg-violet-950/10 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-violet-100">
                  Hardware Trust Boundary
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  The endpoint is for discovery and execution; the trust root is
                  the TDX quote. Oracle registration binds reportData to the
                  TEE-derived key, and validation quotes bind the agent id,
                  request hash, and score before on-chain verification.
                </p>
              </div>
              <ProcessTag>On-chain DCAP</ProcessTag>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
