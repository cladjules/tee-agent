import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys tee-agent contracts:
 *   - TeeVerifier         (validates TEE oracle proofs)
 *   - Verifier            (validates ERC-7857 transfer proofs)
 *   - AgentRegistry       (ERC-7857 agent NFT with encrypted data)
 *   - ValidationRegistry  (ERC-8004 validation requests and responses)
 *
 * ERC-8004 singletons used (not deployed here — pass via parameters file):
 *   Mainnet  Identity:    0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *   Mainnet  Reputation:  0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
 *   Testnet  Identity:    0x8004A818BFB912233c491871b3d84c89A494BD9e
 *   Testnet  Reputation:  0x8004B663056A597Dffe9eCcC1965A193B7388713
 *
 * Parameters (set via --parameters flag for live networks):
 *   identityRegistryAddress  — official ERC-8004 Identity Registry passed to the AgentRegistry
 *                              constructor; zero disables co-registration (default for local)
 *
 * Run:
 *   npm run deploy:baseSepolia
 *   npm run deploy:base
 */
export default buildModule("TeeAgent", (m) => {
  const deployer = m.getAccount(0);

  const identityRegistryAddress = m.getParameter(
    "identityRegistryAddress",
    "0x0000000000000000000000000000000000000000",
  );

  const dcapAttestationAddress = m.getParameter(
    "dcapAttestationAddress",
    "0xaDdeC7e85c2182202b66E331f2a4A0bBB2cEEa1F",
  );
  const teeVerifier = m.contract("TeeVerifier", [
    deployer,
    dcapAttestationAddress,
  ]);

  const verifier = m.contract("Verifier", [deployer, teeVerifier]);

  const agentRegistry = m.contract("AgentRegistry", [
    "Tee Agent",
    "OAT",
    deployer,
    verifier,
    identityRegistryAddress,
  ]);

  const validationRegistry = m.contract("ValidationRegistry");

  return {
    agentRegistry,
    verifier,
    teeVerifier,
    validationRegistry,
  };
});
