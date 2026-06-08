import { Fragment } from "react";
import { ProcessTag } from "./HomePrimitives";

const PROCESS_COLUMNS = [
  {
    label: "WebApp / User",
    steps: [
      {
        title: "Mint ERC-8004 agent",
        body: "Deploy an official ERC-8004 agent, publish the teeOracle service URL on IPFS, and stay compatible with 8004scan.io.",
        tags: ["ERC-8004", "teeOracle"],
      },
      {
        title: "Encrypt private data",
        body: "Skills, prompts, model config, and private files are encrypted for the Phala CVM oracle and registered as ERC-7857 data.",
        tags: ["ERC-7857", "Private skills"],
      },
      {
        title: "Call /run and /verify",
        body: "Apps call the oracle endpoint for runs, then pass the returned TEE quote to /verify when they need proof.",
        tags: ["/run", "/verify"],
      },
    ],
  },
  {
    label: "Phala CVM / Oracle",
    steps: [
      {
        title: "Deploy your handler",
        body: "Copy an oracle example, replace the handler with your app logic, and deploy it as a Phala Cloud CVM.",
        tags: ["Custom handler", "Phala CVM"],
      },
      {
        title: "Run inside Intel TDX",
        body: "The oracle decrypts skills only inside the TEE, runs code or model inference, and returns the result with a quote.",
        tags: ["Intel TDX", "TEE quote"],
      },
      {
        title: "Validate with AI",
        body: "For validation, the oracle can rerun inference with another model at temperature 0 and compare result, score, and reasoning.",
        tags: ["Validation", "temperature 0"],
      },
    ],
  },
  {
    label: "Blockchain",
    steps: [
      {
        title: "Register encrypted agent",
        body: "AgentRegistry mints the ERC-7857 NFT and links ERC-8004 identity, services, and encrypted data references.",
        tags: ["AgentRegistry", "Identity"],
      },
      {
        title: "Verify TEE proof",
        body: "TeeVerifier and Automata DCAP verify Intel TDX quotes before trusting oracle registration or validation proofs.",
        tags: ["TeeVerifier", "Automata DCAP"],
      },
      {
        title: "Feed reputation",
        body: "Validated runs can call the ERC-8004 Reputation Module with TEE proof, reducing Sybil-prone self-reporting.",
        tags: ["Reputation", "Sybil-resistant"],
      },
    ],
  },
] as const;

const TRANSFER_STEPS = [
  "Transfer or sell the ERC-7857 NFT and ERC-8004 identity on-chain.",
  "The new owner selects an oracle endpoint and signs a re-encryption request.",
  "The current oracle re-wraps content keys to the new oracle key inside the TEE.",
  "Encrypted skills keep working without exposing plaintext to either owner or the app.",
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
    <div className="grid min-w-0 grid-rows-[auto_repeat(3,minmax(0,1fr))] gap-2">
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
            through a Phala CVM oracle, verify TDX quotes, then turn validated
            runs into reputation.
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
                  ERC-8004 teeOracle service.
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
                  The endpoint is for discovery; the trust root is the TDX
                  quote. Oracle registration binds reportData to the TEE-derived
                  key, and validation quotes bind the agent id, request hash,
                  and score before on-chain verification.
                </p>
              </div>
              <ProcessTag>On-chain DCAP</ProcessTag>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-cyan-100">
                Transfer, Sale, And Oracle Rotation
              </h3>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
                ERC-7857 lets encrypted skills move with the agent. Key
                re-encryption happens inside the oracle, so ownership can change
                without exposing plaintext.
              </p>
            </div>
            <span className="shrink-0 rounded border border-cyan-800/50 bg-cyan-950/30 px-2 py-1 text-[10px] font-mono text-cyan-300">
              ERC-7857 re-encryption
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
            {TRANSFER_STEPS.map((step, index) => (
              <Fragment key={step}>
                {index > 0 && (
                  <div className="hidden items-center px-1 text-cyan-500 md:flex">
                    <span className="font-mono text-lg">→</span>
                  </div>
                )}
                <div className="flex h-full flex-col rounded border border-slate-800 bg-slate-950/45 p-3">
                  <span className="text-[10px] font-mono text-cyan-300">
                    Step {index + 1}
                  </span>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {step}
                  </p>
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
