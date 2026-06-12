#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import deploymentsJson from "../../../deployments.json" with { type: "json" };
import { readJsonFromUri } from "@tee-agent/agent/crypto";
import {
  DEFAULT_NETWORK,
  getNetworkConfigByChainId,
  NETWORK_CONFIG,
} from "@tee-agent/agent/network";
import {
  decodeFeedbackURI,
  fetchFeedbackOverview,
  getFeedbackPayloadChainId,
  prepareFeedback,
  verifyFeedbackURI,
} from "@tee-agent/agent/ops/feedback";
import { buildAgentPublicMetadata } from "@tee-agent/agent/ops/metadata";
import { prepareMint } from "@tee-agent/agent/ops/mint";
import {
  fetchAgentServices,
  prepareTeeOracleServiceUpdate,
  prepareUpdateServices,
  verifyTeeOracleEndpoint,
} from "@tee-agent/agent/ops/services";
import { prepareValidation } from "@tee-agent/agent/ops/validate";
import { AgentRegistry } from "@tee-agent/agent/registry";
import { ValidationRegistry } from "@tee-agent/agent/registry";
import {
  buildRunTypedData,
  buildValidateTypedData,
} from "@tee-agent/agent/typed-data";
import type { AgentConfig, AgentService } from "@tee-agent/agent/types";
import { createPublicClient, http, type Address, type Hex } from "viem";

type RawDeployments = Record<
  string,
  {
    contracts?: {
      agentRegistry?: string;
      teeVerifier?: string;
      validationRegistry?: string;
      mockDcapAttestation?: string;
    };
    fromBlock?: string | number;
  }
>;

const addressSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/);
const hexSchema = z.string().trim().regex(/^0x[0-9a-fA-F]+$/);
const bytes32Schema = z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const chainSchema = z.number().int().positive().optional();
const serviceSchema = z
  .object({
    name: z.string().trim().min(1),
    endpoint: z.string().trim().min(1),
    version: z.string().trim().optional(),
    skills: z.array(z.string().trim().min(1)).optional(),
    domains: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

function jsonText(value: unknown): string {
  return JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: jsonText(value) }],
  };
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function activeChainId(chainId?: number): number {
  return chainId ?? DEFAULT_NETWORK.chain.id;
}

function networkForChain(chainId?: number) {
  const resolved = activeChainId(chainId);
  const network = getNetworkConfigByChainId(resolved);
  if (!network) throw new Error(`Unsupported chainId ${resolved}.`);
  return network;
}

function rpcUrlForChain(chainId: number): string | undefined {
  const network = networkForChain(chainId);
  return optionalEnv(network.rpcEnvVar);
}

function requireRpcUrlForChain(chainId: number): string {
  const network = networkForChain(chainId);
  const rpcUrl = optionalEnv(network.rpcEnvVar);
  if (!rpcUrl) throw new Error(`${network.rpcEnvVar} is required for chain ${chainId}.`);
  return rpcUrl;
}

function deploymentForChain(chainId: number) {
  const raw = (deploymentsJson as RawDeployments)[String(chainId)];
  if (!raw?.contracts?.agentRegistry) {
    throw new Error(`AgentRegistry deployment missing for chain ${chainId}.`);
  }
  if (!raw.contracts.teeVerifier) {
    throw new Error(`TeeVerifier deployment missing for chain ${chainId}.`);
  }
  if (!raw.contracts.validationRegistry) {
    throw new Error(`ValidationRegistry deployment missing for chain ${chainId}.`);
  }
  return {
    agentRegistry: raw.contracts.agentRegistry as Address,
    teeVerifier: raw.contracts.teeVerifier as Address,
    validationRegistry: raw.contracts.validationRegistry as Address,
    fromBlock: raw.fromBlock === undefined ? 0n : BigInt(raw.fromBlock),
  };
}

function configForChain(chainId?: number): AgentConfig {
  const network = networkForChain(chainId);
  const deployment = deploymentForChain(network.chain.id);
  return {
    chain: network.chain,
    rpcUrl: requireRpcUrlForChain(network.chain.id),
    registryAddress: deployment.agentRegistry,
    registryFromBlock: deployment.fromBlock,
    teeVerifierAddress: deployment.teeVerifier,
    validationRegistryAddress: deployment.validationRegistry,
    identityRegistryAddress: network.identityRegistryAddress,
    reputationRegistryAddress: network.reputationRegistryAddress,
    pinataJwt: optionalEnv("PINATA_JWT"),
    zeroGRpcUrl: optionalEnv("RPC_URL_ZERO_G"),
    zeroGIndexerUrl: optionalEnv("INDEXER_URL_ZERO_G"),
  };
}

function publicClient(config: AgentConfig) {
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
}

function asServices(value: z.infer<typeof serviceSchema>[]): AgentService[] {
  return value.map((service) => ({
    name: service.name,
    endpoint: service.endpoint,
    ...(service.version ? { version: service.version } : {}),
    ...(service.skills ? { skills: service.skills } : {}),
    ...(service.domains ? { domains: service.domains } : {}),
  }));
}

function makeDeadline(seconds?: number): number {
  return Math.floor(Date.now() / 1000) + (seconds ?? 3600);
}

async function callJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `${url} returned HTTP ${response.status}`,
    );
  }
  return data;
}

export function createTeeAgentMcpServer(): McpServer {
  const server = new McpServer({
    name: "tee-agent-mcp",
    version: "0.1.0",
  });

server.registerTool(
  "get_supported_chains",
  {
    title: "Get Supported Chains",
    description: "List Tee Agent chains supported by the SDK/runtime.",
  },
  async () =>
    result(
      Object.values(NETWORK_CONFIG).map((network) => ({
        chainId: network.chain.id,
        name: network.label,
        isTestnet: network.isTestnet,
        rpcEnvVar: network.rpcEnvVar,
        identityRegistryAddress: network.identityRegistryAddress,
        reputationRegistryAddress: network.reputationRegistryAddress,
      })),
    ),
);

server.registerTool(
  "get_contract_addresses",
  {
    title: "Get Contract Addresses",
    description: "Return configured Tee Agent contract addresses for a chain.",
    inputSchema: { chainId: chainSchema },
  },
  async ({ chainId }) => {
    const network = networkForChain(chainId);
    const deployment = deploymentForChain(network.chain.id);
    return result({
      chainId: network.chain.id,
      chain: network.label,
      rpcEnvVar: network.rpcEnvVar,
      rpcConfigured: Boolean(rpcUrlForChain(network.chain.id)),
      identityRegistry: network.identityRegistryAddress,
      reputationRegistry: network.reputationRegistryAddress,
      agentRegistry: deployment.agentRegistry,
      teeVerifier: deployment.teeVerifier,
      validationRegistry: deployment.validationRegistry,
      fromBlock: deployment.fromBlock,
    });
  },
);

server.registerTool(
  "check_env",
  {
    title: "Check MCP Environment",
    description: "Check required and optional env vars for the selected chain.",
    inputSchema: { chainId: chainSchema },
  },
  async ({ chainId }) => {
    const network = networkForChain(chainId);
    return result({
      chainId: network.chain.id,
      rpcEnvVar: network.rpcEnvVar,
      rpcConfigured: Boolean(rpcUrlForChain(network.chain.id)),
      serverSigningEnabled: false,
      pinataConfigured: Boolean(optionalEnv("PINATA_JWT")),
      zeroGRpcConfigured: Boolean(optionalEnv("RPC_URL_ZERO_G")),
      zeroGIndexerConfigured: Boolean(optionalEnv("INDEXER_URL_ZERO_G")),
    });
  },
);

server.registerTool(
  "create_agent_metadata",
  {
    title: "Create Agent Metadata",
    description: "Build ERC-721 and ERC-8004 metadata JSON without uploading or minting.",
    inputSchema: {
      chainId: chainSchema,
      name: z.string().trim().min(1),
      description: z.string().trim().min(1),
      imageUrl: z.string().trim().optional(),
      agentType: z.string().trim().optional(),
      services: z.array(serviceSchema).default([]),
      ownerAddress: addressSchema.optional(),
      x402Support: z.boolean().optional(),
      oasfSkills: z.array(z.string()).default([]),
      oasfDomains: z.array(z.string()).default([]),
    },
  },
  async (params) => {
    const config = configForChain(params.chainId);
    const services = asServices(params.services);
    const publicMetadata = buildAgentPublicMetadata({
      name: params.name,
      description: params.description,
      imageUrl: params.imageUrl,
      agentType: params.agentType,
      services,
      x402Support: params.x402Support,
      createdAt: Math.floor(Date.now() / 1000),
    });
    return result({
      publicMetadata,
      agentMetadata: {
        type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
        name: params.name,
        description: params.description,
        image: params.imageUrl,
        services,
        x402Support: params.x402Support ?? false,
        active: true,
        supportedTrust: ["tee-attestation", "reputation", "validation"],
        wallet: params.ownerAddress,
        owner: params.ownerAddress,
        registrations: [
          {
            agentRegistry: `eip155:${config.chain.id}:${config.registryAddress}`,
            agentId: "<assigned-on-mint>",
          },
          {
            agentRegistry: `eip155:${config.chain.id}:${config.identityRegistryAddress}`,
            agentId: "<assigned-by-erc8004-identity>",
          },
        ],
        oasf: {
          schema_version: "0.8",
          skills: params.oasfSkills,
          domains: params.oasfDomains,
        },
      },
    });
  },
);

const mintInput = {
  chainId: chainSchema,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  imageUrl: z.string().trim().optional(),
  agentType: z.string().trim().optional(),
  services: z.array(serviceSchema).default([]),
  x402Support: z.boolean().optional(),
  privateEntries: z
    .array(z.object({ name: z.string(), data: z.string() }).strict())
    .default([]),
  oasfSkills: z.array(z.string()).default([]),
  oasfDomains: z.array(z.string()).default([]),
  ownerAddress: addressSchema,
};

server.registerTool(
  "prepare_mint_agent",
  {
    title: "Prepare Mint Agent",
    description: "Upload metadata/private blobs and return AgentRegistry mint calldata.",
    inputSchema: mintInput,
  },
  async (params) => {
    const config = configForChain(params.chainId);
    const ownerAddress = params.ownerAddress as Address;
    const prepared = await prepareMint(config, {
      ...params,
      services: asServices(params.services),
      ownerAddress,
    });
    return result({
      ...prepared,
      tx: {
        address: prepared.contractAddress,
        functionName: "mint",
        args: [
          ownerAddress,
          prepared.publicMetadataUri,
          prepared.agentMetadataUri,
          prepared.intelligentData,
        ],
      },
    });
  },
);

server.registerTool(
  "mint_agent",
  {
    title: "Mint Agent",
    description: "Prepare AgentRegistry.mint calldata. The caller submits the transaction with their own wallet.",
    inputSchema: mintInput,
  },
  async (params) => {
    const config = configForChain(params.chainId);
    const ownerAddress = params.ownerAddress as Address;
    const prepared = await prepareMint(config, {
      ...params,
      services: asServices(params.services),
      ownerAddress,
    });
    return result({
      ...prepared,
      submitWithWallet: true,
      tx: {
        address: prepared.contractAddress,
        functionName: "mint",
        args: [
          ownerAddress,
          prepared.publicMetadataUri,
          prepared.agentMetadataUri,
          prepared.intelligentData,
        ],
      },
    });
  },
);

server.registerTool(
  "get_agent",
  {
    title: "Get Agent",
    description: "Resolve AgentRegistry token metadata, owner, ERC-8004 id, and private data descriptors.",
    inputSchema: {
      chainId: chainSchema,
      agentId: z.string().trim().min(1),
    },
  },
  async ({ chainId, agentId }) => {
    const config = configForChain(chainId);
    const registry = new AgentRegistry({
      address: config.registryAddress!,
      chainId: config.chain.id,
      rpcUrl: config.rpcUrl,
    });
    const numericAgentId = BigInt(agentId);
    const [agent, proofData] = await Promise.all([
      registry.resolve(numericAgentId),
      registry.resolveProofData(numericAgentId),
    ]);
    return result({ agent, proofData });
  },
);

server.registerTool(
  "list_agents",
  {
    title: "List Agents",
    description: "Resolve recent AgentRegistry tokens.",
    inputSchema: {
      chainId: chainSchema,
      limit: z.number().int().min(1).max(50).default(10),
      offset: z.number().int().min(0).default(0),
      newestFirst: z.boolean().default(true),
    },
  },
  async ({ chainId, limit, offset, newestFirst }) => {
    const config = configForChain(chainId);
    const registry = new AgentRegistry({
      address: config.registryAddress!,
      chainId: config.chain.id,
      rpcUrl: config.rpcUrl,
    });
    const total = await registry.totalSupply();
    const ids = Array.from({ length: Number(total) }, (_, index) => BigInt(index));
    const ordered = newestFirst ? ids.reverse() : ids;
    const slice = ordered.slice(offset, offset + limit);
    const agents = await Promise.all(
      slice.map((id) =>
        registry
          .resolve(id)
          .then((agent) => ({ ok: true, agent }))
          .catch((err) => ({
            ok: false,
            agentId: id.toString(),
            error: err instanceof Error ? err.message : String(err),
          })),
      ),
    );
    return result({ total, agents });
  },
);

server.registerTool(
  "check_oracle_health",
  {
    title: "Check Oracle Health",
    description: "Fetch teeOracle /address and /attestation when available.",
    inputSchema: { oracleUrl: z.string().trim().min(1) },
  },
  async ({ oracleUrl }) => {
    const normalized = oracleUrl.replace(/\/+$/, "");
    const address = await callJson(`${normalized}/address`);
    let attestation: Record<string, unknown> | undefined;
    try {
      attestation = await callJson(`${normalized}/attestation`);
    } catch (err) {
      attestation = {
        unavailable: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    return result({ oracleUrl: normalized, address, attestation });
  },
);

server.registerTool(
  "run_agent",
  {
    title: "Run Agent",
    description: "Call teeOracle /run with a caller-provided signature, or return typed data to sign.",
    inputSchema: {
      chainId: chainSchema,
      oracleUrl: z.string().trim().min(1),
      agentId: z.string().trim().min(1),
      payload: jsonObjectSchema,
      signature: hexSchema.optional(),
      deadline: z.number().int().positive().optional(),
      deadlineSeconds: z.number().int().positive().optional(),
      registryAddress: addressSchema.optional(),
    },
  },
  async (params) => {
    const config = configForChain(params.chainId);
    const normalized = params.oracleUrl.replace(/\/+$/, "");
    const oracle = await verifyTeeOracleEndpoint(normalized);
    const deadline = params.deadline ?? makeDeadline(params.deadlineSeconds);
    const typedData = buildRunTypedData({
      oracleAddress: oracle.address,
      chainId: config.chain.id,
      agentId: BigInt(params.agentId),
      payload: params.payload,
      deadline,
    });
    if (!params.signature) {
      return result({
        signWithWallet: true,
        typedData,
        request: {
          method: "POST",
          url: `${normalized}/run`,
          body: {
            agentId: params.agentId,
            payload: params.payload,
            signature: "<wallet-signature>",
            deadline,
            registryAddress: params.registryAddress ?? config.registryAddress,
          },
        },
      });
    }
    const data = await callJson(`${normalized}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: params.agentId,
        payload: params.payload,
        signature: params.signature,
        deadline,
        registryAddress: params.registryAddress ?? config.registryAddress,
      }),
    });
    return result(data);
  },
);

server.registerTool(
  "prepare_validation_request",
  {
    title: "Prepare Validation Request",
    description: "Build ValidationRegistry.validationRequest calldata.",
    inputSchema: {
      chainId: chainSchema,
      agentId: z.string().trim().min(1),
      validatorAddress: addressSchema,
      requestURI: z.string().default(""),
    },
  },
  async (params) => {
    const config = configForChain(params.chainId);
    const prepared = prepareValidation(config, {
      agentId: params.agentId,
      validatorAddress: params.validatorAddress as Address,
      requestURI: params.requestURI,
    });
    return result({
      ...prepared,
      tx: {
        address: prepared.contractAddress,
        functionName: "validationRequest",
        args: [
          prepared.validatorAddress,
          BigInt(prepared.agentId),
          prepared.requestURI,
          prepared.requestHash,
        ],
      },
    });
  },
);

server.registerTool(
  "request_validation",
  {
    title: "Request Validation",
    description: "Prepare ValidationRegistry.validationRequest calldata. The caller submits the transaction with their own wallet.",
    inputSchema: {
      chainId: chainSchema,
      agentId: z.string().trim().min(1),
      validatorAddress: addressSchema,
      requestURI: z.string().default(""),
    },
  },
  async (params) => {
    const config = configForChain(params.chainId);
    const prepared = prepareValidation(config, {
      agentId: params.agentId,
      validatorAddress: params.validatorAddress as Address,
      requestURI: params.requestURI,
    });
    return result({
      ...prepared,
      submitWithWallet: true,
      tx: {
        address: prepared.contractAddress,
        functionName: "validationRequest",
        args: [
          prepared.validatorAddress,
          BigInt(prepared.agentId),
          prepared.requestURI,
          prepared.requestHash,
        ],
      },
    });
  },
);

server.registerTool(
  "run_validation",
  {
    title: "Run Oracle Validation",
    description: "Call teeOracle /validate with a caller-provided signature, or return typed data to sign.",
    inputSchema: {
      chainId: chainSchema,
      oracleUrl: z.string().trim().min(1),
      erc8004AgentId: z.string().trim().min(1),
      requestHash: bytes32Schema,
      payload: jsonObjectSchema,
      signature: hexSchema.optional(),
      deadline: z.number().int().positive().optional(),
      deadlineSeconds: z.number().int().positive().optional(),
    },
  },
  async (params) => {
    const config = configForChain(params.chainId);
    const normalized = params.oracleUrl.replace(/\/+$/, "");
    const oracle = await verifyTeeOracleEndpoint(normalized);
    const deadline = params.deadline ?? makeDeadline(params.deadlineSeconds);
    const typedData = buildValidateTypedData({
      oracleAddress: oracle.address,
      chainId: config.chain.id,
      erc8004AgentId: BigInt(params.erc8004AgentId),
      requestHash: params.requestHash as Hex,
      payload: params.payload,
      deadline,
    });
    if (!params.signature) {
      return result({
        signWithWallet: true,
        typedData,
        request: {
          method: "POST",
          url: `${normalized}/validate`,
          body: {
            erc8004AgentId: params.erc8004AgentId,
            requestHash: params.requestHash,
            payload: params.payload,
            validationRegistryAddress: config.validationRegistryAddress,
            signature: "<wallet-signature>",
            deadline,
          },
        },
      });
    }
    const data = await callJson(`${normalized}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        erc8004AgentId: params.erc8004AgentId,
        requestHash: params.requestHash,
        payload: params.payload,
        validationRegistryAddress: config.validationRegistryAddress,
        signature: params.signature,
        deadline,
      }),
    });
    return result(data);
  },
);

server.registerTool(
  "get_validation_status",
  {
    title: "Get Validation Status",
    description: "Read ValidationRegistry.getValidationStatus(requestHash).",
    inputSchema: { chainId: chainSchema, requestHash: bytes32Schema },
  },
  async ({ chainId, requestHash }) => {
    const config = configForChain(chainId);
    const registry = new ValidationRegistry({
      address: config.validationRegistryAddress!,
      chainId: config.chain.id,
      rpcUrl: config.rpcUrl,
    });
    return result(await registry.getValidationStatus(requestHash as Hex));
  },
);

server.registerTool(
  "list_validation_requests",
  {
    title: "List Validation Requests",
    description: "List request hashes for an ERC-8004 agent id.",
    inputSchema: { chainId: chainSchema, agentId: z.string().trim().min(1) },
  },
  async ({ chainId, agentId }) => {
    const config = configForChain(chainId);
    const registry = new ValidationRegistry({
      address: config.validationRegistryAddress!,
      chainId: config.chain.id,
      rpcUrl: config.rpcUrl,
    });
    return result({
      agentId,
      requestHashes: await registry.getAgentValidations(BigInt(agentId)),
    });
  },
);

const feedbackInput = {
  chainId: chainSchema,
  agentId: z.string().trim().min(1),
  clientAddress: addressSchema,
  value: z.number().min(-1).max(1),
  tag1: z.string().default(""),
  tag2: z.string().default(""),
  feedback: jsonObjectSchema,
};

server.registerTool(
  "prepare_feedback",
  {
    title: "Prepare Feedback",
    description: "Build ERC-8004 ReputationRegistry.giveFeedback calldata.",
    inputSchema: feedbackInput,
  },
  async (params) => {
    const config = configForChain(params.chainId);
    const clientAddress = params.clientAddress as Address;
    const prepared = await prepareFeedback(config, {
      agentId: params.agentId,
      clientAddress,
      value: params.value,
      tag1: params.tag1,
      tag2: params.tag2,
      feedbackJson: JSON.stringify(params.feedback),
    });
    return result({
      ...prepared,
      tx: {
        address: prepared.contractAddress,
        functionName: "giveFeedback",
        args: [
          BigInt(prepared.agentId),
          BigInt(prepared.value),
          prepared.valueDecimals,
          prepared.tag1,
          prepared.tag2,
          "",
          prepared.feedbackURI,
          prepared.feedbackHash,
        ],
      },
    });
  },
);

server.registerTool(
  "submit_feedback",
  {
    title: "Submit Feedback",
    description: "Prepare ReputationRegistry.giveFeedback calldata. The caller submits the transaction with their own wallet.",
    inputSchema: feedbackInput,
  },
  async (params) => {
    const config = configForChain(params.chainId);
    const prepared = await prepareFeedback(config, {
      agentId: params.agentId,
      clientAddress: params.clientAddress as Address,
      value: params.value,
      tag1: params.tag1,
      tag2: params.tag2,
      feedbackJson: JSON.stringify(params.feedback),
    });
    return result({
      ...prepared,
      submitWithWallet: true,
      tx: {
        address: prepared.contractAddress,
        functionName: "giveFeedback",
        args: [
          BigInt(prepared.agentId),
          BigInt(prepared.value),
          prepared.valueDecimals,
          prepared.tag1,
          prepared.tag2,
          "",
          prepared.feedbackURI,
          prepared.feedbackHash,
        ],
      },
    });
  },
);

server.registerTool(
  "list_feedback",
  {
    title: "List Feedback",
    description: "Read ERC-8004 reputation summary and feedback rows for an agent.",
    inputSchema: { chainId: chainSchema, agentId: z.string().trim().min(1) },
  },
  async ({ chainId, agentId }) =>
    result(await fetchFeedbackOverview(configForChain(chainId), agentId)),
);

server.registerTool(
  "verify_feedback",
  {
    title: "Verify Feedback",
    description: "Verify a feedbackURI against the on-chain ValidationRegistry and configured TeeVerifier.",
    inputSchema: { feedbackURI: z.string().trim().min(1) },
  },
  async ({ feedbackURI }) => {
    const decoded = decodeFeedbackURI(feedbackURI);
    if (!decoded) throw new Error("Invalid feedbackURI.");
    const chainId = getFeedbackPayloadChainId(decoded.payload);
    if (!chainId) throw new Error("feedbackURI is missing agentRegistry.");
    return result(await verifyFeedbackURI(configForChain(chainId), decoded));
  },
);

server.registerTool(
  "prepare_update_agent_services",
  {
    title: "Prepare Update Agent Services",
    description: "Build ERC-8004 IdentityRegistry.setAgentURI calldata for service updates.",
    inputSchema: {
      chainId: chainSchema,
      tokenId: z.string().trim().min(1),
      services: z.array(serviceSchema),
    },
  },
  async ({ chainId, tokenId, services }) => {
    const config = configForChain(chainId);
    const prepared = await prepareUpdateServices(config, {
      tokenId,
      servicesJson: asServices(services),
    });
    return result({
      ...prepared,
      tx: {
        address: prepared.erc8004RegistryAddress,
        functionName: "setAgentURI",
        args: [BigInt(prepared.erc8004AgentId), prepared.tokenUri],
      },
    });
  },
);

server.registerTool(
  "update_agent_services",
  {
    title: "Update Agent Services",
    description: "Prepare ERC-8004 IdentityRegistry.setAgentURI calldata. The caller submits the transaction with their own wallet.",
    inputSchema: {
      chainId: chainSchema,
      tokenId: z.string().trim().min(1),
      services: z.array(serviceSchema),
    },
  },
  async ({ chainId, tokenId, services }) => {
    const config = configForChain(chainId);
    const prepared = await prepareUpdateServices(config, {
      tokenId,
      servicesJson: asServices(services),
    });
    return result({
      ...prepared,
      submitWithWallet: true,
      tx: {
        address: prepared.erc8004RegistryAddress,
        functionName: "setAgentURI",
        args: [BigInt(prepared.erc8004AgentId), prepared.tokenUri],
      },
    });
  },
);

server.registerTool(
  "update_tee_oracle_service",
  {
    title: "Update TEE Oracle Service",
    description: "Patch an ERC-8004 agent metadata URI with a teeOracle endpoint and return setAgentURI calldata.",
    inputSchema: {
      chainId: chainSchema,
      erc8004AgentId: z.string().trim().min(1),
      teeOracleUrl: z.string().trim().min(1),
    },
  },
  async ({ chainId, erc8004AgentId, teeOracleUrl }) => {
    const config = configForChain(chainId);
    const prepared = await prepareTeeOracleServiceUpdate(config, {
      erc8004AgentId,
      teeOracleUrl,
    });
    return result({
      ...prepared,
      submitWithWallet: true,
      tx: {
        address: prepared.erc8004RegistryAddress,
        functionName: "setAgentURI",
        args: [BigInt(prepared.erc8004AgentId), prepared.tokenUri],
      },
    });
  },
);

server.registerTool(
  "get_agent_services",
  {
    title: "Get Agent Services",
    description: "Read ERC-8004 services for an agent id.",
    inputSchema: {
      chainId: chainSchema,
      erc8004AgentId: z.string().trim().min(1),
      expectedOwner: addressSchema.optional(),
    },
  },
  async ({ chainId, erc8004AgentId, expectedOwner }) =>
    result(
      await fetchAgentServices(configForChain(chainId), {
        tokenId: erc8004AgentId,
        expectedOwner: expectedOwner as Address | undefined,
      }),
    ),
);

server.registerTool(
  "read_uri_json",
  {
    title: "Read URI JSON",
    description: "Read JSON from ipfs://, data:, or http(s) URI.",
    inputSchema: { uri: z.string().trim().min(1) },
  },
  async ({ uri }) => result(await readJsonFromUri<Record<string, unknown>>(uri)),
);

  return server;
}

function requestedTransport(): "http" | "stdio" {
  const transport = optionalEnv("MCP_TRANSPORT")?.toLowerCase();
  if (process.argv.includes("--http") || transport === "http") return "http";
  return "stdio";
}

function mcpError(message: string) {
  return {
    jsonrpc: "2.0",
    error: { code: -32603, message },
    id: null,
  };
}

async function startStdio() {
  const server = createTeeAgentMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp() {
  const host = optionalEnv("MCP_HOST") ?? "127.0.0.1";
  const port = Number(optionalEnv("PORT") ?? optionalEnv("MCP_PORT") ?? "3001");
  const app = createMcpExpressApp({ host });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, transport: "streamable-http", endpoint: "/mcp" });
  });

  app.post("/mcp", async (req, res) => {
    const server = createTeeAgentMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      if (!res.headersSent) res.status(500).json(mcpError(message));
    } finally {
      await transport.close();
      await server.close();
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  app.listen(port, host, () => {
    console.error(`Tee Agent MCP HTTP listening on http://${host}:${port}/mcp`);
  });
}

function isCliEntrypoint(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(resolve(entry)).href);
}

if (isCliEntrypoint()) {
  const start = requestedTransport() === "http" ? startHttp : startStdio;
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
