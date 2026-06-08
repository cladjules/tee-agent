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

      <ContractAddresses />
      <FeatureStrip />
      <ProcessDiagram />
      <DeveloperQuickstart />
    </div>
  );
}
