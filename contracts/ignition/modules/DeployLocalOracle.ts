import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys Arbitrum Sepolia development contracts for a locally running oracle.
 *
 * This path intentionally deploys a separate AgentRegistry/TeeVerifier pair
 * wired to MockDcapAttestation so the local tappd simulator can exercise the
 * same quote/proof flow as production without requiring real DCAP acceptance.
 */
export default buildModule("TeeAgent", (m) => {
  const deployer = m.getAccount(0);

  const identityRegistryAddress = m.getParameter("identityRegistryAddress");

  const mockDcapAttestation = m.contract("MockDcapAttestation");
  const teeVerifier = m.contract("TeeVerifier", [
    deployer,
    mockDcapAttestation,
    0,
  ]);

  const agentRegistry = m.contract(
    "AgentRegistry",
    ["Tee Agent", "OAT", deployer, teeVerifier, identityRegistryAddress],
    { after: [teeVerifier] },
  );

  const validationRegistry = m.contract("ValidationRegistry", [], {
    after: [agentRegistry],
  });

  return {
    agentRegistry,
    mockDcapAttestation,
    teeVerifier,
    validationRegistry,
  };
});
