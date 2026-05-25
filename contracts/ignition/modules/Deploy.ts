import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys open-agents-toolkit contracts:
 *   - TeeVerifier         (holds the TEE oracle signing address)
 *   - Verifier            (IERC7857DataVerifier — validates TransferValidityProof[])
 *   - AgentRegistry       (ERC-7857 agent NFT with ERC-8004 co-registration)
 *   - ValidationRegistry  (ERC-8004 on-chain validation requests — our own deployment)
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
 * After deployment on live networks:
 *   Call TeeVerifier.updateOracleAddress(realOracleAddress) to point at the Phala CVM.
 *
 * Run:
 *   npm run deploy:baseSepolia
 *   npm run deploy:base
 */
export default buildModule("OpenAgentsToolkit", (m) => {
  const deployer = m.getAccount(0);

  // Zero address = co-registration disabled (default for local Hardhat node).
  // Set via parameters file: testnet 0x8004A818… / mainnet 0x8004A169…
  const identityRegistryAddress = m.getParameter(
    "identityRegistryAddress",
    "0x0000000000000000000000000000000000000000",
  );

  // ── TEE oracle verifier ────────────────────────────────────────────────────
  // admin = deployer; teeOracleAddress = deployer as placeholder until the
  // real Phala oracle address is known.  Update via updateOracleAddress().
  // dcapAttestationAddress: Automata AutomataDcapAttestationFee — chain-specific.
  //   Base & Base Sepolia: 0xaDdeC7e85c2182202b66E331f2a4A0bBB2cEEa1F
  const dcapAttestationAddress = m.getParameter(
    "dcapAttestationAddress",
    "0xaDdeC7e85c2182202b66E331f2a4A0bBB2cEEa1F",
  );
  const teeVerifier = m.contract("TeeVerifier", [
    deployer,
    deployer,
    dcapAttestationAddress,
  ]);

  // ── ERC-7857 data verifier ─────────────────────────────────────────────────
  const verifier = m.contract("Verifier", [deployer, teeVerifier]);

  // ── ERC-7857 agent NFT registry ───────────────────────────────────────────
  const agentRegistry = m.contract("AgentRegistry", [
    "Open Agents Toolkit",
    "OAT",
    deployer,
    verifier,
    identityRegistryAddress, // ERC-8004 Identity Registry (immutable)
  ]);

  // ── ERC-8004 validation registry ──────────────────────────────────────────
  const validationRegistry = m.contract("ValidationRegistry", [agentRegistry]);

  return {
    agentRegistry,
    verifier,
    teeVerifier,
    validationRegistry,
  };
});
