/**
 * prepareMint — builds all on-chain and off-chain artefacts needed to mint
 * an ERC-721 / ERC-7857 Agent NFT.
 *
 * Steps:
 *  1. Fetch oracle public key from GET /address
 *  2. Upload private entries encrypted to 0G Storage
 *  3. Upload OASF profile to IPFS (if skills/domains provided)
 *  4. Upload ERC-721 public metadata to IPFS
 *  5. Upload ERC-8004 agent metadata to IPFS
 *  6. Return calldata params for the mint transaction
 */

import { parseAgentServicesJson } from "../crypto.js";
import { uploadEncryptedIntelligentData } from "../storage/zero-g.js";
import { uploadMetadata } from "./metadata.js";
import { verifyTeeOracleEndpoint } from "./services.js";
import type {
  AgentConfig,
  AgentService,
  MintParams,
  MintResult,
} from "../types.js";
import { AgentRegistry } from "../registry/agent.js";
import { IDENTITY_REGISTRY_ABI } from "../abis.js";
import { createPublicClient, http } from "viem";

export async function prepareMint(
  config: AgentConfig,
  params: MintParams,
): Promise<MintResult> {
  const {
    name,
    description,
    imageUrl,
    agentType = "assistant",
    services: rawServices = [],
    x402Support = false,
    privateEntries = [],
    oasfSkills = [],
    oasfDomains = [],
    ownerAddress,
  } = params;

  if (!name) throw new Error("Agent name is required.");
  if (!description) throw new Error("Description is required.");
  if (!ownerAddress)
    throw new Error("Connect your wallet before creating an agent.");

  // ── Parse services ────────────────────────────────────────────────────────
  const parsedServices = parseAgentServicesJson(rawServices);

  let services: AgentService[] = parsedServices.map((s) => ({
    name: s.name,
    endpoint: s.endpoint,
    ...(s.version !== undefined ? { version: s.version } : {}),
    ...(s.skills && s.skills.length > 0 ? { skills: [...s.skills] } : {}),
    ...(s.domains && s.domains.length > 0 ? { domains: [...s.domains] } : {}),
  })) as AgentService[];
  const teeOracleService = services.find((s) => s.name === "teeOracle");
  if (!teeOracleService?.endpoint) {
    throw new Error("A teeOracle service URL is required.");
  }

  // ── Fetch oracle public key ──────────────────────────────────────────────
  const oracle = await verifyTeeOracleEndpoint(teeOracleService.endpoint);
  services = services.map((service) =>
    service.name === "teeOracle"
      ? { ...service, endpoint: oracle.url }
      : service,
  );
  const keyEncryptionPublicKey = oracle.publicKey;

  // ── Chain reads ───────────────────────────────────────────────────────────
  const registry = new AgentRegistry({
    address: config.registryAddress!,
    publicClient: createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    }),
  });
  const predictedAgentId = await registry.totalSupply();
  const mintFee = 0n;

  // ── Predict ERC-8004 agentId via dry-run simulation ───────────────────────
  // `register()` is permissionless — simulating it via eth_call returns the
  // agentId that will be assigned when the real mint tx calls it.
  // We pass ownerAddress as `from` to satisfy the ERC-721 non-zero receiver check.
  let predictedErc8004AgentId: bigint | undefined;
  const identityRegistryRef = config.identityRegistryAddress
    ? `eip155:${config.chain.id}:${config.identityRegistryAddress}`
    : undefined;
  if (config.identityRegistryAddress) {
    const pc = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });
    try {
      const { result } = await pc.simulateContract({
        address: config.identityRegistryAddress as `0x${string}`,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "register",
        args: ["ipfs://predict"],
        account: ownerAddress as `0x${string}`,
      });
      predictedErc8004AgentId = result;
    } catch (err) {
      console.warn(
        "[prepareMint] could not predict ERC-8004 agentId — skipping IdentityRegistry registration entry",
        err,
      );
    }
  }

  // ── Upload private intelligent data to 0G Storage ─────────────────────────
  const validEntries = privateEntries.filter(
    (e) => e.name.trim() && e.data.trim(),
  );
  if (validEntries.length > 0 && !config.zeroGPrivateKey) {
    throw new Error(
      "zeroGPrivateKey (or PRIVATE_KEY fallback) is required for private data uploads.",
    );
  }

  const intelligentData = await uploadEncryptedIntelligentData({
    entries: validEntries,
    keyEncryptionPublicKey: keyEncryptionPublicKey as `0x${string}`,
    zeroGPrivateKey: config.zeroGPrivateKey ?? "",
    rpcUrl: config.zeroGRpcUrl,
    indexerUrl: config.zeroGIndexerUrl,
  });

  // ── OASF profile ──────────────────────────────────────────────────────────
  if ((oasfSkills.length > 0 || oasfDomains.length > 0) && config.pinataJwt) {
    const oasfProfile = {
      schema_version: "0.8",
      skills: oasfSkills,
      domains: oasfDomains,
    };
    const oasfProfileUri = await uploadMetadata(
      config,
      oasfProfile,
      `${name}-oasf-profile`,
    );

    const oasfIdx = services.findIndex((s) => s.name === "OASF");
    const oasfEntry: AgentService = {
      name: "OASF",
      endpoint: oasfProfileUri,
      version: "0.8",
      ...(oasfSkills.length ? { skills: oasfSkills } : {}),
      ...(oasfDomains.length ? { domains: oasfDomains } : {}),
    };
    if (oasfIdx >= 0) {
      services = services.map((s, i) =>
        i === oasfIdx ? { ...s, ...oasfEntry } : s,
      );
    } else {
      services = [...services, oasfEntry];
    }
  }

  // ── IPFS uploads ──────────────────────────────────────────────────────────
  if (!config.pinataJwt) {
    throw new Error("pinataJwt is required for IPFS metadata uploads.");
  }
  const agentRegistry = `eip155:${config.chain.id}:${config.registryAddress}`;

  const publicMetadata = {
    name,
    description,
    image: imageUrl ?? undefined,
    attributes: [
      { trait_type: "Agent Type", value: agentType },
      {
        trait_type: "Created",
        value: Math.floor(Date.now() / 1000),
        display_type: "date",
      },
    ],
  };

  const publicMetadataUri = await uploadMetadata(
    config,
    publicMetadata,
    `${name}-public`,
  );

  // Include both AgentRegistry and IdentityRegistry registrations when possible.
  // The ERC-8004 agentId is predicted by dry-running register() via eth_call;
  // if that fails, only AgentRegistry is included and `prepareRegisterErc8004`
  // can patch the metadata post-mint.
  const registrations = [
    { agentId: Number(predictedAgentId), agentRegistry },
    ...(identityRegistryRef && predictedErc8004AgentId !== undefined
      ? [
          {
            agentId: Number(predictedErc8004AgentId),
            agentRegistry: identityRegistryRef,
          },
        ]
      : []),
  ];

  const agentMetadata = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name,
    description,
    image: imageUrl ?? undefined,
    services,
    x402Support,
    active: true,
    registrations,
    supportedTrust: ["tee-attestation", "reputation", "validation"],
    wallet: ownerAddress,
    owner: ownerAddress,
    publicMetadataUri,
  };

  const agentMetadataUri = await uploadMetadata(config, agentMetadata, name);

  return {
    contractAddress: config.registryAddress!,
    agentRegistry: `${agentRegistry}/${predictedAgentId}`,
    publicMetadataUri,
    agentMetadataUri,
    mintFee: mintFee.toString(),
    intelligentData: intelligentData.map((item) => ({
      dataDescription: item.uri,
      dataHash: item.hash,
    })),
    ...(config.identityRegistryAddress !== undefined
      ? { erc8004RegistryAddress: config.identityRegistryAddress }
      : {}),
  };
}
