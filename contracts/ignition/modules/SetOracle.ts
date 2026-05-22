import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployModule from "./Deploy.js";

/**
 * SetOracle — Register a Phala Cloud TEE oracle's ECDSA signing address with TEEVerifier.
 *
 * Ignition resolves the TEEVerifier address automatically from the prior Deploy run.
 *
 * Run after Deploy:
 *   npm run setOracle:baseSepolia -- --parameters '{"oracleAddress":"0x..."}'
 */
export default buildModule("SetOracle", (m) => {
  const { teeVerifier } = m.useModule(DeployModule);

  const oracleAddress = m.getParameter("oracleAddress");

  // contractAt narrows the type to ContractDeploymentFuture, which m.call requires.
  m.call(teeVerifier, "updateOracleAddress", [oracleAddress], {
    id: "RegisterOracle",
  });

  return { teeVerifier };
});
