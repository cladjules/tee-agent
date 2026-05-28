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

import { makePublicClient } from "../core/client.js";
import { AgentRegistry } from "../core/registry.js";
import { parseAgentServicesJson } from "../crypto/index.js";
import { uploadEncryptedIntelligentData } from "../storage/zero-g.js";
import { IpfsClient } from "../storage/ipfs.js";
import type {
  AgentConfig,
  AgentService,
  MintParams,
  MintResult,
} from "../core/types.js";

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

  if (!name) return { error: "Agent name is required." };
  if (!description) return { error: "Description is required." };
  if (!ownerAddress)
    return { error: "Connect your wallet before creating an agent." };

  // ── Fetch oracle public key ──────────────────────────────────────────────
  let keyEncryptionPublicKey: string | undefined;
  if (config.oracleUrl) {
    try {
      const addrRes = await fetch(`${config.oracleUrl}/address`);
      if (!addrRes.ok)
        throw new Error(`oracle /address returned ${addrRes.status}`);
      const addrJson = (await addrRes.json()) as { publicKey?: string };
      keyEncryptionPublicKey = addrJson.publicKey;
    } catch (err) {
      console.warn("[prepareMint] could not fetch oracle public key", err);
    }
  }

  if (!keyEncryptionPublicKey) {
    return {
      error:
        "Could not retrieve TEE encryption public key from oracle. Is oracleUrl set and the oracle running?",
    };
  }

  // ── Parse services ────────────────────────────────────────────────────────
  const parsedServices = parseAgentServicesJson(JSON.stringify(rawServices));
  if (parsedServices.error) return { error: parsedServices.error };

  let services: AgentService[] = (parsedServices.services ?? []).map((s) => ({
    name: s.name,
    endpoint: s.endpoint,
    ...(s.version !== undefined ? { version: s.version } : {}),
    ...(s.skills && s.skills.length > 0 ? { skills: [...s.skills] } : {}),
    ...(s.domains && s.domains.length > 0 ? { domains: [...s.domains] } : {}),
  })) as AgentService[];

  // ── Chain reads ───────────────────────────────────────────────────────────
  const registry = new AgentRegistry({
    agentRegistryAddress: config.registryAddress,
    publicClient: makePublicClient(config) as any,
  });
  const predictedAgentId = await registry.totalSupply();
  const mintFee = 0n;

  // ── Upload private intelligent data to 0G Storage ─────────────────────────
  const validEntries = privateEntries.filter(
    (e) => e.name.trim() && e.data.trim(),
  );
  if (validEntries.length > 0 && !config.zeroGPrivateKey) {
    return {
      error:
        "zeroGPrivateKey (or PRIVATE_KEY fallback) is required for private data uploads.",
    };
  }

  const intelligentData = await uploadEncryptedIntelligentData({
    entries: validEntries,
    keyEncryptionPublicKey: keyEncryptionPublicKey as `0x${string}`,
    zeroGPrivateKey: config.zeroGPrivateKey ?? "",
    ...(config.zeroGRpcUrl !== undefined ? { rpcUrl: config.zeroGRpcUrl } : {}),
    ...(config.zeroGIndexerUrl !== undefined
      ? { indexerUrl: config.zeroGIndexerUrl }
      : {}),
  });

  // ── OASF profile ──────────────────────────────────────────────────────────
  if ((oasfSkills.length > 0 || oasfDomains.length > 0) && config.pinataJwt) {
    const oasfIpfsClient = new IpfsClient({ jwt: config.pinataJwt });
    const oasfProfile = {
      schema_version: "0.8",
      skills: oasfSkills,
      domains: oasfDomains,
    };
    const oasfUpload = await oasfIpfsClient.uploadJSON(
      oasfProfile,
      `${name}-oasf-profile`,
    );
    const oasfProfileUri = oasfUpload.url;

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
    return { error: "pinataJwt is required for IPFS metadata uploads." };
  }
  const ipfsClient = new IpfsClient({ jwt: config.pinataJwt });

  const agentRegistry = `eip155:${config.chain.id}:${config.registryAddress}`;
  const identityRegistryRef = config.identityRegistryAddress
    ? `eip155:${config.chain.id}:${config.identityRegistryAddress}`
    : undefined;

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

  const publicMetadataUpload = await ipfsClient.uploadJSON(
    publicMetadata,
    `${name}-public`,
  );
  const publicMetadataUri = publicMetadataUpload.url;

  const registrations = [
    { agentId: Number(predictedAgentId), agentRegistry },
    ...(identityRegistryRef
      ? [
          {
            agentId: Number(predictedAgentId),
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
    supportedTrust: ["tee-attestation"],
    wallet: ownerAddress,
    owner: ownerAddress,
    publicMetadataUri,
  };

  const agentMetadataUpload = await ipfsClient.uploadJSON(agentMetadata, name);
  const agentMetadataUri = agentMetadataUpload.url;

  return {
    contractAddress: config.registryAddress,
    agentRegistry: `${agentRegistry}/${predictedAgentId}`,
    publicMetadataUri,
    agentMetadataUri,
    mintFee: mintFee.toString(),
    intelligentData: intelligentData.map((item) => ({
      dataDescription: item.uri,
      dataHash: item.hash,
    })),
  };
}
