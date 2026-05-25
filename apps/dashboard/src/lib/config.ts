/** Centralised env-var access for server actions. Never import on the client. */

import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, type Chain } from "viem/chains";

export const NETWORKS = {
  base,
  baseSepolia,
} as const;

const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "baseSepolia") as
  | "base"
  | "baseSepolia";
export const APP_CHAIN: Chain = NETWORK === "base" ? base : baseSepolia;

/**
 * Official ERC-8004 singletons (Identity + Reputation only — we deploy our own ValidationRegistry).
 * Mainnet (Base):         identity 0x8004A169…  reputation 0x8004BAa1…
 * Testnets (Base Sepolia): identity 0x8004A818…  reputation 0x8004B663…
 */
const IDENTITY_REGISTRY_ADDRESS = (
  NETWORK === "base"
    ? "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
    : "0x8004A818BFB912233c491871b3d84c89A494BD9e"
) as `0x${string}`;
const REPUTATION_REGISTRY_ADDRESS = (
  NETWORK === "base"
    ? "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63"
    : "0x8004B663056A597Dffe9eCcC1965A193B7388713"
) as `0x${string}`;

export const cfg = {
  network: NETWORK,
  registryAddress: process.env.AGENT_REGISTRY_ADDRESS as
    | `0x${string}`
    | undefined,
  /** Official ERC-8004 Identity Registry (CREATE2, same on all chains). */
  identityRegistryAddress: IDENTITY_REGISTRY_ADDRESS,
  /** Official ERC-8004 Reputation Registry. Override via REPUTATION_REGISTRY_ADDRESS if needed. */
  reputationAddress: (process.env.REPUTATION_REGISTRY_ADDRESS ??
    REPUTATION_REGISTRY_ADDRESS) as `0x${string}`,
  /** Deployed ValidationRegistry (our own deployment, set via VALIDATION_REGISTRY_ADDRESS). */
  validationAddress: process.env.VALIDATION_REGISTRY_ADDRESS as
    | `0x${string}`
    | undefined,
  teeVerifierAddress: process.env.NEXT_PUBLIC_TEE_VERIFIER_ADDRESS as
    | `0x${string}`
    | undefined,
  rpcUrl: process.env.RPC_URL,
  deployerKey: process.env.PRIVATE_KEY as `0x${string}` | undefined,
  oracleKey: process.env.ORACLE_PRIVATE_KEY as `0x${string}` | undefined,
  /** URL of the Phala Cloud TEE oracle (or local simulator). Required for secure agent transfers. */
  oracleUrl: process.env.ORACLE_URL,
  /** Private key used to sign 0G Storage upload transactions. Falls back to PRIVATE_KEY. */
  zeroGKey:
    (process.env.ZERO_G_PRIVATE_KEY as `0x${string}` | undefined) ??
    (process.env.PRIVATE_KEY as `0x${string}` | undefined),
  /** 0G Storage EVM RPC endpoint (default: https://evmrpc-testnet.0g.ai). */
  zeroGRpcUrl: process.env.ZERO_G_RPC_URL,
  /** 0G Storage indexer URL (default: standard testnet indexer). */
  zeroGIndexerUrl: process.env.ZERO_G_INDEXER_URL,
  /** Pinata JWT for IPFS uploads (agent metadata JSON). Set PINATA_JWT env var. */
  pinataJwt: process.env.PINATA_JWT,
  get keyEncryptionPublicKey() {
    const configured = process.env.TEE_ENCRYPTION_PUBLIC_KEY as
      | `0x${string}`
      | undefined;
    if (configured) return configured;
    return this.oracleKey
      ? (privateKeyToAccount(this.oracleKey).publicKey as `0x${string}`)
      : undefined;
  },
  get chain(): Chain {
    return NETWORKS[this.network] ?? baseSepolia;
  },
  get chainId() {
    return this.chain.id;
  },
  get isConfigured() {
    return !!(this.registryAddress && this.rpcUrl && this.deployerKey);
  },
};
