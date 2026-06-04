import type { Address } from "viem";

export type ActionClientConfig = {
  registryAddress?: Address;
  teeVerifierAddress?: Address;
  identityRegistryAddress?: Address;
  reputationRegistryAddress?: Address;
  validationRegistryAddress?: Address;
};

