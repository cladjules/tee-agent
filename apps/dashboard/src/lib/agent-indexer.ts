/**
 * Core agent indexer — scans registry events and persists a lightweight Redis
 * index. Full ERC-8004/IPFS metadata is resolved on the agent page only.
 *
 * Called by:
 *   - getRegisteredAgents()  (on-demand, skips scan if cache is fresh)
 *   - /api/cron/sync-events  (Vercel Cron, production)
 *   - instrumentation.ts  (setInterval, development)
 */

import {
  addCachedValidationResponses,
  type CachedAgentIndexRow,
  getCachedAgents,
  type IndexedValidationResponse,
  setCachedAgents,
} from "@/lib/agent-cache";
import { AgentRegistry } from "@tee-agent/agent/registry";
import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { getServerConfigForChain } from "@/lib/config";
import {
  AGENT_TRANSFER_EVENT,
  IDENTITY_URI_UPDATED_EVENT,
  REGISTERED_EVENT,
  TOKEN_URI_UPDATED_EVENT,
  VALIDATION_REQUEST_EVENT,
  VALIDATION_RESPONSE_EVENT,
} from "@tee-agent/agent/abis";
import { readJsonFromUri } from "@tee-agent/agent/encryption";
import {
  resolveOwnedValidationOracleUrl,
  submitOracleValidation,
} from "@/lib/oracle-validation";

type IndexResult =
  | {
      ok: true;
      newAgents: number;
      totalAgents: number;
      scannedFrom: string;
      scannedTo: string;
      latestBlock: string;
      caughtUp: boolean;
      validationsProcessed: number;
      validationsUpdated: number;
    }
  | { ok: false; skipped: true; reason: string };

type ValidationRequestLog = {
  eventName: "ValidationRequest";
  args: {
    validatorAddress: `0x${string}`;
    agentId: bigint;
    requestURI: string;
    requestHash: `0x${string}`;
  };
};

type ValidationResponseLog = {
  eventName: "ValidationResponse";
  args: {
    validatorAddress: `0x${string}`;
    agentId: bigint;
    requestHash: `0x${string}`;
    response: number;
    responseURI: string;
    responseHash: `0x${string}`;
    tag: string;
  };
  transactionHash?: `0x${string}`;
};

type ValidationLogs = {
  requests: ValidationRequestLog[];
  responses: ValidationResponseLog[];
};

type UnansweredValidationRequest = {
  agentId: bigint;
  validatorAddress: `0x${string}`;
  requestURI: string;
  requestHash: `0x${string}`;
};

type AgentRegisteredLog = {
  eventName: "Registered";
  args: {
    agentId: bigint;
    agentURI: string;
    owner: Address;
  };
  blockNumber?: bigint;
  logIndex?: number;
};

type TokenUriUpdatedLog = {
  eventName: "TokenURIUpdated";
  args: {
    tokenId: bigint;
    newURI: string;
  };
  blockNumber?: bigint;
  logIndex?: number;
};

type AgentTransferLog = {
  eventName: "Transfer";
  args: {
    to: Address;
    tokenId: bigint;
  };
  blockNumber?: bigint;
  logIndex?: number;
};

type IdentityUriUpdatedLog = {
  eventName: "URIUpdated";
  args: {
    agentId: bigint;
    newURI: string;
  };
  blockNumber?: bigint;
  logIndex?: number;
};

type AgentIndexLogs = {
  registrations: AgentRegisteredLog[];
  tokenUriUpdates: TokenUriUpdatedLog[];
  transfers: AgentTransferLog[];
  identityUriUpdates: IdentityUriUpdatedLog[];
};

type RegistryLog = AgentRegisteredLog | TokenUriUpdatedLog | AgentTransferLog;

type ValidationLog = ValidationRequestLog | ValidationResponseLog;

const LOG_PAGE_SIZE = 2_000n;
const LOG_PAGE_DELAY_MS = 1_000;
const MAX_LOG_PAGES_PER_RUN = 5n;
const MAX_BLOCKS_PER_RUN = LOG_PAGE_SIZE * MAX_LOG_PAGES_PER_RUN;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decodeJsonDataUri(uri: string): Record<string, unknown> | undefined {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) return undefined;

  try {
    const parsed = JSON.parse(
      Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"),
    ) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function validationKey(agentId: bigint, requestHash: string): string {
  return `${agentId.toString()}:${requestHash.toLowerCase()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function byLogOrder(
  a: { blockNumber?: bigint; logIndex?: number },
  b: { blockNumber?: bigint; logIndex?: number },
): number {
  const blockDelta = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n);
  if (blockDelta < 0n) return -1;
  if (blockDelta > 0n) return 1;
  return (a.logIndex ?? 0) - (b.logIndex ?? 0);
}

function cleanTag(tag: string): string | undefined {
  const clean = tag.trim();
  return clean ? clean : undefined;
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const clean = cleanTag(tag);
    if (clean) seen.add(clean);
  }
  return [...seen].slice(0, 8);
}

type IndexedMetadata = {
  name: string;
  imageUrl?: string;
  tags: string[];
};

function baseAgentTags(row: {
  erc8004AgentId?: string;
  metadataUri: string;
}): string[] {
  return uniqueTags([
    "ERC-7857",
    row.erc8004AgentId && row.erc8004AgentId !== "0" ? "ERC-8004" : "",
    row.metadataUri.startsWith("ipfs://") ? "IPFS" : "",
  ]);
}

async function indexedMetadataFromUri(
  metadataUri: string,
  baseTags: string[],
): Promise<IndexedMetadata> {
  const metadata = await readJsonFromUri<{
    name?: unknown;
    image?: unknown;
    image_url?: unknown;
    services?: unknown;
    supportedTrust?: unknown;
    x402Support?: unknown;
  }>(metadataUri);
  if (typeof metadata.name !== "string" || !metadata.name.trim()) {
    throw new Error(`metadata ${metadataUri} is missing name`);
  }

  const tags = [...baseTags];
  if (Array.isArray(metadata.services)) {
    for (const service of metadata.services) {
      if (!service || typeof service !== "object") continue;
      const name = (service as { name?: unknown }).name;
      if (typeof name === "string") tags.push(name);
    }
  }

  if (Array.isArray(metadata.supportedTrust)) {
    for (const trust of metadata.supportedTrust) {
      if (typeof trust === "string") tags.push(trust);
    }
  }

  if (metadata.x402Support === true) tags.push("x402");
  const image = metadata.image ?? metadata.image_url;
  return {
    name: metadata.name.trim(),
    imageUrl:
      typeof image === "string" && image.trim() ? image.trim() : undefined,
    tags: uniqueTags(tags),
  };
}

async function rowFromRegistrationLog(
  log: AgentRegisteredLog,
  registry: AgentRegistry,
): Promise<CachedAgentIndexRow> {
  const tokenId = log.args.agentId;
  const [erc8004AgentId, publicMetadataUri, contractMetadataUri] =
    await Promise.all([
      registry.getERC8004AgentId(tokenId).then((value) => value.toString()),
      registry.tokenURI(tokenId),
      registry.getMetadataUri(tokenId).catch(() => ""),
    ]);
  const metadataUri = log.args.agentURI || contractMetadataUri;
  if (!metadataUri) {
    throw new Error(`agent tokenId=${tokenId.toString()} has no metadataUri`);
  }
  const indexed = await indexedMetadataFromUri(
    metadataUri,
    baseAgentTags({ erc8004AgentId, metadataUri }),
  );
  const row = {
    tokenId: tokenId.toString(),
    ...indexed,
    owner: log.args.owner,
    publicMetadataUri,
    erc8004AgentId,
    metadataUri,
  };
  return row;
}

async function collectValidationLogs(
  publicClient: PublicClient,
  validationRegistryAddress: `0x${string}`,
  fromBlock: bigint,
  latestBlock: bigint,
  pageSize: bigint,
): Promise<ValidationLogs> {
  const requests: ValidationRequestLog[] = [];
  const responses: ValidationResponseLog[] = [];

  for (let from = fromBlock; from <= latestBlock; from += pageSize) {
    const to =
      from + pageSize - 1n < latestBlock ? from + pageSize - 1n : latestBlock;
    const logs = (await publicClient.getLogs({
      address: validationRegistryAddress,
      events: [VALIDATION_REQUEST_EVENT, VALIDATION_RESPONSE_EVENT],
      fromBlock: from,
      toBlock: to,
    })) as ValidationLog[];

    for (const log of logs) {
      if (log.eventName === "ValidationRequest") requests.push(log);
      if (log.eventName === "ValidationResponse") responses.push(log);
    }
    if (to < latestBlock) await sleep(LOG_PAGE_DELAY_MS);
  }

  return { requests, responses };
}

async function collectAgentIndexLogs(
  publicClient: PublicClient,
  registryAddress: `0x${string}`,
  identityRegistryAddress: `0x${string}` | undefined,
  fromBlock: bigint,
  latestBlock: bigint,
  pageSize: bigint,
): Promise<AgentIndexLogs> {
  const registrations: AgentRegisteredLog[] = [];
  const tokenUriUpdates: TokenUriUpdatedLog[] = [];
  const transfers: AgentTransferLog[] = [];
  const identityUriUpdates: IdentityUriUpdatedLog[] = [];

  for (let from = fromBlock; from <= latestBlock; from += pageSize) {
    const to =
      from + pageSize - 1n < latestBlock ? from + pageSize - 1n : latestBlock;
    const [registryChunk, identityUriChunk] = await Promise.all([
      publicClient.getLogs({
        address: registryAddress,
        events: [
          REGISTERED_EVENT,
          TOKEN_URI_UPDATED_EVENT,
          AGENT_TRANSFER_EVENT,
        ],
        fromBlock: from,
        toBlock: to,
      }),
      identityRegistryAddress
        ? publicClient.getLogs({
            address: identityRegistryAddress,
            event: IDENTITY_URI_UPDATED_EVENT,
            fromBlock: from,
            toBlock: to,
          })
        : Promise.resolve([]),
    ]);

    for (const log of registryChunk as RegistryLog[]) {
      if (log.eventName === "Registered") registrations.push(log);
      if (log.eventName === "TokenURIUpdated") tokenUriUpdates.push(log);
      if (log.eventName === "Transfer") transfers.push(log);
    }
    identityUriUpdates.push(...(identityUriChunk as IdentityUriUpdatedLog[]));
    if (to < latestBlock) await sleep(LOG_PAGE_DELAY_MS);
  }

  registrations.sort(byLogOrder);
  tokenUriUpdates.sort(byLogOrder);
  transfers.sort(byLogOrder);
  identityUriUpdates.sort(byLogOrder);

  return { registrations, tokenUriUpdates, transfers, identityUriUpdates };
}

function validationResponsesFromLogs(
  responses: ValidationResponseLog[],
): IndexedValidationResponse[] {
  return responses.map((res) => {
    const evidence = decodeJsonDataUri(res.args.responseURI);
    return {
      requestHash: res.args.requestHash,
      agentId: res.args.agentId.toString(),
      validatorAddress: res.args.validatorAddress,
      score: res.args.response,
      txHash: res.transactionHash,
      timestamp: Math.floor(Date.now() / 1000),
      responseURI: res.args.responseURI,
      responseHash: res.args.responseHash,
      tag: res.args.tag,
      reasoning:
        typeof evidence?.reasoning === "string"
          ? evidence.reasoning
          : undefined,
      evidence,
    };
  });
}

function unansweredValidationRequestsFromLogs({
  requests,
  responses,
}: ValidationLogs): UnansweredValidationRequest[] {
  const responseKeys = new Set(
    responses.map((res) =>
      validationKey(res.args.agentId, res.args.requestHash),
    ),
  );
  const seenRequests = new Set<string>();

  return requests.flatMap((req) => {
    const key = validationKey(req.args.agentId, req.args.requestHash);
    if (seenRequests.has(key) || responseKeys.has(key)) return [];
    seenRequests.add(key);
    return [
      {
        agentId: req.args.agentId,
        validatorAddress: req.args.validatorAddress,
        requestURI: req.args.requestURI,
        requestHash: req.args.requestHash,
      },
    ];
  });
}

async function submitUnansweredValidationResponses(
  chainId: number,
  validationRegistryAddress: `0x${string}`,
  submissions: UnansweredValidationRequest[],
): Promise<number> {
  if (submissions.length === 0) return 0;

  const byAgent = new Map<string, UnansweredValidationRequest[]>();
  for (const submission of submissions) {
    const agentId = submission.agentId.toString();
    const current = byAgent.get(agentId);
    if (current) current.push(submission);
    else byAgent.set(agentId, [submission]);
  }

  const results = await Promise.all(
    [...byAgent.entries()].map(
      async ([erc8004AgentId, agentSubmissions]): Promise<number> => {
        let oracleUrl: string | undefined;
        try {
          oracleUrl = await resolveOwnedValidationOracleUrl(
            chainId,
            erc8004AgentId,
          );
        } catch (err) {
          console.error(
            `[indexer] resolve validation oracle failed agentId=${erc8004AgentId}:`,
            err instanceof Error ? err.message : err,
          );
          return 0;
        }
        if (!oracleUrl) return 0;

        const agentResults = await Promise.all(
          agentSubmissions.map(async (submission): Promise<number> => {
            const payload = decodeJsonDataUri(submission.requestURI);
            if (!payload) {
              console.error(
                `[indexer] validation request ${submission.requestHash} has invalid requestURI`,
              );
              return 0;
            }

            const submitted = await submitOracleValidation(chainId, {
              erc8004AgentId,
              validatorAddress: submission.validatorAddress,
              requestHash: submission.requestHash,
              payload,
              validationRegistryAddress,
              oracleUrl,
            });
            if (!submitted.ok) {
              console.error(
                `[indexer] validation submit failed requestHash=${submission.requestHash}:`,
                submitted.error,
              );
              return 0;
            }
            return 1;
          }),
        );
        return agentResults.reduce((total, count) => total + count, 0);
      },
    ),
  );
  return results.reduce((total, count) => total + count, 0);
}

/**
 * Scans validation events and submits oracle responses for requests that do not
 * have a matching ValidationResponse event yet.
 *
 * ValidationResponse events are written to Redis for page reads.
 */
async function syncValidations(
  chainId: number,
  fromBlock: bigint,
  latestBlock: bigint,
  publicClient: PublicClient,
  validationRegistryAddress: `0x${string}`,
  pageSize: bigint,
): Promise<{ submitted: number; responses: number }> {
  const logs = await collectValidationLogs(
    publicClient,
    validationRegistryAddress,
    fromBlock,
    latestBlock,
    pageSize,
  );
  if (!logs.requests.length && !logs.responses.length)
    return { submitted: 0, responses: 0 };

  await addCachedValidationResponses(
    chainId,
    validationRegistryAddress,
    validationResponsesFromLogs(logs.responses),
  );

  const submissions = unansweredValidationRequestsFromLogs(logs);
  const submitted = await submitUnansweredValidationResponses(
    chainId,
    validationRegistryAddress,
    submissions,
  );

  return {
    submitted,
    responses: logs.responses.length,
  };
}

// ─── Main export ─────────────────────────────────────────────────────────────

/** Scan new blocks since the last cached block, update the agent cache, and sync pending validations. */
export async function syncEvents(chainId: number): Promise<IndexResult> {
  const cfg = getServerConfigForChain(chainId);

  if (!cfg.registryAddress) {
    return { ok: false, skipped: true, reason: "no registry address" };
  }

  if (!cfg.rpcUrl)
    return { ok: false, skipped: true, reason: "no rpc/registry" };
  const publicClient = createPublicClient({
    chain: cfg.chain,
    transport: http(cfg.rpcUrl),
  });
  const registry = new AgentRegistry({
    address: cfg.registryAddress,
    publicClient,
  });
  if (!publicClient || !registry) {
    return { ok: false, skipped: true, reason: "no rpc/registry" };
  }

  const cached = await getCachedAgents(chainId, cfg.registryAddress);
  const existingAgents = cached?.agents ?? [];
  const fromBlock = cached ? cached.lastBlock + 1n : cfg.registryFromBlock;
  const latestBlock = await publicClient.getBlockNumber();

  if (fromBlock > latestBlock) {
    return {
      ok: true,
      newAgents: 0,
      totalAgents: existingAgents.length,
      scannedFrom: fromBlock.toString(),
      scannedTo: latestBlock.toString(),
      latestBlock: latestBlock.toString(),
      caughtUp: true,
      validationsProcessed: 0,
      validationsUpdated: 0,
    };
  }

  const scannedTo =
    latestBlock - fromBlock + 1n > MAX_BLOCKS_PER_RUN
      ? fromBlock + MAX_BLOCKS_PER_RUN - 1n
      : latestBlock;
  const caughtUp = scannedTo === latestBlock;

  const logs = await collectAgentIndexLogs(
    publicClient,
    cfg.registryAddress,
    cfg.identityRegistryAddress,
    fromBlock,
    scannedTo,
    LOG_PAGE_SIZE,
  );

  const agentRows = new Map(
    existingAgents.map((agent) => [agent.tokenId, agent] as const),
  );
  let newAgents = 0;

  for (const log of logs.registrations) {
    try {
      const row = await rowFromRegistrationLog(log, registry);
      if (!agentRows.has(row.tokenId)) newAgents += 1;
      agentRows.set(row.tokenId, row);
    } catch (err) {
      console.error(
        `[indexer] index registered tokenId=${log.args.agentId} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  for (const log of logs.tokenUriUpdates) {
    const tokenId = log.args.tokenId.toString();
    const row = agentRows.get(tokenId);
    if (row) {
      agentRows.set(tokenId, {
        ...row,
        publicMetadataUri: log.args.newURI,
      });
    }
  }

  for (const log of logs.transfers) {
    const tokenId = log.args.tokenId.toString();
    const row = agentRows.get(tokenId);
    if (row) {
      agentRows.set(tokenId, {
        ...row,
        owner: log.args.to,
      });
    }
  }

  const tokenIdByErc8004Id = new Map(
    [...agentRows.values()].flatMap((row) =>
      row.erc8004AgentId ? [[row.erc8004AgentId, row.tokenId] as const] : [],
    ),
  );
  for (const log of logs.identityUriUpdates) {
    const tokenId = tokenIdByErc8004Id.get(log.args.agentId.toString());
    if (!tokenId) continue;
    const row = agentRows.get(tokenId);
    if (!row) continue;
    const metadataUri = log.args.newURI;
    const indexed = await indexedMetadataFromUri(
      metadataUri,
      baseAgentTags({ erc8004AgentId: row.erc8004AgentId, metadataUri }),
    );
    agentRows.set(tokenId, {
      ...row,
      metadataUri,
      ...indexed,
    });
  }

  const merged = [...agentRows.values()].sort((a, b) => {
    const left = BigInt(a.tokenId);
    const right = BigInt(b.tokenId);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });

  const { submitted: validationsProcessed, responses: validationsUpdated } =
    cfg.validationRegistryAddress
      ? await syncValidations(
          chainId,
          fromBlock,
          scannedTo,
          publicClient,
          cfg.validationRegistryAddress,
          LOG_PAGE_SIZE,
        )
      : { submitted: 0, responses: 0 };

  // Advance lastBlock only after all processing for this bounded range is complete.
  await setCachedAgents(chainId, cfg.registryAddress, merged, scannedTo);

  return {
    ok: true,
    newAgents,
    totalAgents: merged.length,
    scannedFrom: fromBlock.toString(),
    scannedTo: scannedTo.toString(),
    latestBlock: latestBlock.toString(),
    caughtUp,
    validationsProcessed,
    validationsUpdated: validationsUpdated,
  };
}
