import ContractAddresses from "@/components/ContractAddresses";
import DeployCodeTeaser from "@/components/home/DeployCodeTeaser";
import FeatureStrip from "@/components/home/FeatureStrip";
import HomeHero from "@/components/home/HomeHero";
import RegisteredAgentsSection from "@/components/home/RegisteredAgentsSection";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div className="space-y-16">
      <HomeHero />
      <ContractAddresses />
      <FeatureStrip />
      <RegisteredAgentsSection />
      <DeployCodeTeaser />
    </div>
  );
}
