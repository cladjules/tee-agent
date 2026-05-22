import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys open-agents-toolkit contracts:
 *   - TeeVerifier         (holds the TEE oracle signing address)
 *   - Verifier            (IERC7857DataVerifier — validates TransferValidityProof[])
 *   - AgentRegistry       (ERC-7857 agent NFT with ERC-8004 co-registration)
 *   - ValidationRegistry  (ERC-8004 on-chain validation requests — our own deployment)
 *
 * ERC-8004 singletons used (not deployed — official CREATE2 addresses, same on all chains):
 *   Identity Registry:   0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *   Reputation Registry: 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
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
  // Set to 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 for live networks via parameters file.
  const identityRegistryAddress = m.getParameter(
    "identityRegistryAddress",
    "0x0000000000000000000000000000000000000000",
  );

  // ── TEE oracle verifier ────────────────────────────────────────────────────
  // admin = deployer; teeOracleAddress = deployer as placeholder until the
  // real Phala oracle address is known.  Update via updateOracleAddress().
  const teeVerifier = m.contract("TeeVerifier", [deployer, deployer]);

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
