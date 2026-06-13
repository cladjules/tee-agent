import ContractAddresses from "@/components/ContractAddresses";
import DeveloperQuickstart from "@/components/home/DeveloperQuickstart";
import FeatureStrip from "@/components/home/FeatureStrip";
import ProcessDiagram from "@/components/home/ProcessDiagram";

export const dynamic = "force-dynamic";

export default function DocsPage() {
  return (
    <div className="space-y-14">
      <section className="max-w-3xl space-y-3 pt-4">
        <p className="font-mono text-xs text-violet-400">Docs</p>
        <h1 className="text-4xl font-bold tracking-tight text-slate-100 md:text-5xl">
          Build With Tee Agent
        </h1>
        <p className="text-sm leading-6 text-slate-500 md:text-base md:leading-7">
          Deploy contracts, run a Phala Cloud TDX oracle, mint ERC-8004
          compatible agents with ERC-7857 private data, then validate and move
          them without exposing encrypted skills.
        </p>
      </section>

      <FeatureStrip />
      <ProcessDiagram />
      <DeveloperQuickstart />
      <ContractAddresses />

      <section className="max-w-3xl space-y-4">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-wider text-cyan-400">
            Feedback Verification
          </p>
          <h2 className="text-2xl font-semibold text-slate-100">
            Verify feedback with its URI
          </h2>
          <p className="text-sm leading-6 text-slate-500">
            Feedback rows can be checked against the on-chain validation
            registry by sending the `feedbackURI` to the dashboard verifier. The
            verifier decodes the ERC-8004 feedback JSON, reads the validation
            response, and confirms it came from the configured TEE verifier.
          </p>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs leading-5 text-slate-300">
          <code>{`await fetch("https://teeagent.xyz/api/verify", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ feedbackURI }),
});`}</code>
        </pre>
      </section>

      <section className="max-w-3xl space-y-4">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-wider text-violet-400">
            MCP
          </p>
          <h2 className="text-2xl font-semibold text-slate-100">
            Operate agents from AI clients
          </h2>
          <p className="text-sm leading-6 text-slate-500">
            `@tee-agent/mcp` exposes stdio and Streamable HTTP tools for
            creating metadata, minting, running oracles, requesting validation,
            submitting feedback, and verifying feedback. Write-oriented tools
            return calldata for the caller to submit with their own wallet.
          </p>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs leading-5 text-slate-300">
          <code>{`Hosted Streamable HTTP:
POST https://teeagent.xyz/api/mcp`}</code>
        </pre>
        <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs leading-5 text-slate-300">
          <code>{`Local stdio:
{
  "mcpServers": {
    "tee-agent": {
      "command": "node",
      "args": ["apps/mcp/dist/index.js"]
    }
  }
}`}</code>
        </pre>
      </section>
    </div>
  );
}
