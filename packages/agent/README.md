# @tee-agent/agent

TypeScript SDK for Tee Agent contracts, encrypted agent data, ERC-8004 metadata,
and ERC-7857 transfer helpers.

Use this package from your dashboard, backend, worker, CLI, or third-party app.
It does not run an oracle. Oracle services use `@tee-agent/server`.

## Production Use

Build an explicit config from your own env layer and root `deployments.json`:

```ts
import { createConfig } from "@tee-agent/agent/config";
import deployments from "./deployments.json" with { type: "json" };

const config = createConfig(
  "base",
  {
    rpcUrl: process.env.RPC_URL_BASE!,
    pinataJwt: process.env.PINATA_JWT!,
    zeroGPrivateKey: process.env.PRIVATE_KEY!,
    zeroGRpcUrl: process.env.ZERO_G_RPC_URL!,
    zeroGIndexerUrl: process.env.ZERO_G_INDEXER_URL!,
  },
  deployments,
);
```

Common production imports:

```ts
import { AGENT_REGISTRY_ABI } from "@tee-agent/agent/abis";
import { prepareMint } from "@tee-agent/agent/mint";
import { AgentRegistry } from "@tee-agent/agent/registry";
import { prepareValidation } from "@tee-agent/agent/validate";
import { prepareFeedback } from "@tee-agent/agent/feedback";
import { prepareUpdateServices } from "@tee-agent/agent/services";
```

Minting requires a live `teeOracle` service. `prepareMint(...)` calls that
oracle's `GET /address`, encrypts private entries to the returned public key,
uploads encrypted blobs to 0G Storage, uploads public metadata to IPFS, and
returns arguments for `AgentRegistry.mint(...)`.

```ts
const prepared = await prepareMint(config, {
  name: "Production Agent",
  description: "Agent backed by my Phala CVM oracle.",
  ownerAddress,
  services: [{ name: "teeOracle", endpoint: "https://your-oracle.example" }],
  privateEntries: [{ name: "SKILL.md", data: "# System prompt\n..." }],
});

await walletClient.writeContract({
  address: prepared.contractAddress,
  abi: AGENT_REGISTRY_ABI,
  functionName: "mint",
  args: [
    ownerAddress,
    prepared.publicMetadataUri,
    prepared.agentMetadataUri,
    prepared.intelligentData,
  ],
  account: ownerAddress,
});
```

## Two-Party Transfer

ERC-7857 transfer needs two approvals:

1. The current owner authorizes their oracle to re-wrap the encrypted content
   keys for the recipient oracle public key.
2. The recipient wallet signs the access proofs that prove they accept the
   transferred encrypted data.

The SDK keeps this storage-agnostic. It returns JSON-safe `TransferOffer` and
`TransferAcceptance` payloads, and your app decides where those payloads live:
Redis, Postgres, IPFS, email, QR code, a push notification, or any other message
layer. The SDK does not require Redis, delegated access, or a recipient oracle
signing endpoint.

The only oracle calls are:

- `GET /address` on the recipient oracle to read its `publicKey`
- `POST /reencrypt` on the sender oracle from `createTransferOffer(...)`

### Sender Creates An Offer

```ts
import { createTransferOffer } from "@tee-agent/agent/transfer";
import { buildReencryptTypedData } from "@tee-agent/agent/typed-data";

const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);

const senderOracleInfo = await fetch(`${senderOracleUrl}/address`).then((r) =>
  r.json(),
);
const recipientOracleInfo = await fetch(`${recipientOracleUrl}/address`).then(
  (r) => r.json(),
);

const typedData = buildReencryptTypedData({
  oracleAddress: senderOracleInfo.address,
  chainId: config.chain.id,
  tokenId,
  from: senderAddress,
  to: recipientAddress,
  deadline,
});

const oracleSignature = await walletClient.signTypedData({
  account: senderAddress,
  ...typedData,
});

const offer = await createTransferOffer(config, {
  tokenId: tokenId.toString(),
  to: recipientAddress,
  oracleUrl: senderOracleUrl,
  recipientPublicKey: recipientOracleInfo.publicKey,
  oracleSignature,
  oracleDeadline: deadline.toString(),
});

await storeTransferOffer(offer);
```

### Recipient Accepts The Offer

```ts
import { acceptTransferOffer } from "@tee-agent/agent/transfer";

const offer = await loadTransferOffer();

if (offer.to.toLowerCase() !== recipientAddress.toLowerCase()) {
  throw new Error("Connected wallet is not the transfer recipient.");
}

const acceptance = await acceptTransferOffer(offer, (digest) =>
  walletClient.signMessage({
    account: recipientAddress,
    message: digest,
  }),
);

await storeTransferAcceptance(acceptance);
```

The recipient signs one access proof per encrypted data entry. That is why
wallets may show multiple signatures for agents with multiple private blobs.

### Sender Finalizes On-Chain

```ts
import { buildTransferTxArgs } from "@tee-agent/agent/transfer";

const acceptance = await loadTransferAcceptance();

if (acceptance.offer.from.toLowerCase() !== senderAddress.toLowerCase()) {
  throw new Error("Connected wallet is not the transfer sender.");
}

const txArgs = buildTransferTxArgs(acceptance);

await walletClient.writeContract({
  account: senderAddress,
  ...txArgs,
});
```

`buildTransferTxArgs(...)` returns the exact viem-compatible call for
`AgentRegistry.iTransferFromWithIdentity(from, to, tokenId, proofs)`.
That call transfers the ERC-7857 NFT and the linked ERC-8004 Identity Registry
token in one transaction. Local test chains without ERC-8004 co-registration can
use `iTransferFrom(from, to, tokenId, proofs)` with the same `proofs` array from
`txArgs.args[3]`.

### Reading After Transfer

The encrypted blob URI does not change during transfer. Instead, the contract
emits `PublishedSealedKey(to, tokenId, sealedKeys)`. Each sealed key is the
existing AES content key re-wrapped for the recipient oracle public key.

```ts
import {
  decryptContentKey,
  decryptMetadata,
} from "@tee-agent/agent/encryption";
import { getPublishedSealedKeys } from "@tee-agent/agent/transfer";

const sealedKeys = await getPublishedSealedKeys({
  publicClient,
  registryAddress,
  tokenId,
  to: recipientAddress,
  fromBlock: deploymentFromBlock,
  toBlock: "latest",
});

const contentKey = decryptContentKey(
  { encryptedKey: sealedKeys[blobIndex] },
  recipientOraclePrivateKey,
);

const privateData = decryptMetadata(blob, contentKey);
```

An app with its own index can store `PublishedSealedKey` events itself and skip
`getPublishedSealedKeys(...)`. The SDK only needs the sealed keys; it does not
care where they came from.

### Storage Contract

Applications only need to persist two JSON payloads:

```ts
type PendingTransfer = {
  offer?: TransferOffer;
  acceptance?: TransferAcceptance;
};
```

Both payload types are plain JSON: no `bigint`, no functions, and no SDK class
instances. This is intentional so third-party SDK consumers can plug in their
own storage layer without adopting the dashboard's Redis/indexing model.

## Oracle Key Rotation

Changing the `teeOracle` service for the same owner is not the same operation as
ownership transfer. Transfer keeps the encrypted blob URIs fixed and publishes
recipient sealed keys in the `PublishedSealedKey` event.

Oracle rotation changes which TEE oracle can run the agent. The rotation flow
must:

1. Read the new oracle public key from `GET /address`.
2. Ask the current oracle to re-wrap each existing content key for that public
   key.
3. Update the encrypted blob metadata with the new sealed keys.
4. Upload the updated blobs through the caller's storage adapter.
5. Submit `AgentRegistry.update(...)` with the new data hashes/URIs.
6. Update ERC-8004 services so `teeOracle` points at the new oracle endpoint.

Do not treat `teeOracle` as a normal editable service field. Apps should expose a
dedicated rotation action so the on-chain data hashes and service metadata stay
in sync.
