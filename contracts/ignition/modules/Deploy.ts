import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys tee-agent contracts:
 *   - TeeVerifier         (validates ERC-7857 transfer proofs + ERC-8004 validations)
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
 *                              constructor; zero disables co-registration only when explicitly passed
 *   dcapAttestationAddress   — Automata DCAP attestation contract, or explicit mock address
 *   dcapTcbEvaluationDataNumber — Automata TCB evaluation data number.
 *                                 Use 0 for Automata standard().
 *
 * Run:
 *   npm run deploy:arbitrumSepolia
 */
export default buildModule("TeeAgent", (m) => {
  const deployer = m.getAccount(0);

  const identityRegistryAddress = m.getParameter("identityRegistryAddress");

  const dcapAttestationAddress = m.getParameter("dcapAttestationAddress");
  const dcapTcbEvaluationDataNumber = m.getParameter(
    "dcapTcbEvaluationDataNumber",
  );
  const teeVerifier = m.contract("TeeVerifier", [
    deployer,
    dcapAttestationAddress,
    dcapTcbEvaluationDataNumber,
  ]);

  const agentRegistry = m.contract("AgentRegistry", [
    "Tee Agent",
    "OAT",
    deployer,
    teeVerifier,
    identityRegistryAddress,
  ]);

  const validationRegistry = m.contract("ValidationRegistry");

  return {
    agentRegistry,
    teeVerifier,
    validationRegistry,
  };
});
