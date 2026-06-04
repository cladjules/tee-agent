# @tee-agent/server

Reusable Phala TDX oracle server for Tee Agent.

Use this package to deploy an oracle CVM. The oracle decrypts ERC-7857 private
data inside the TEE, runs your handler, signs responses with the TEE-derived
wallet, re-wraps transfer keys, and submits ERC-8004 validation responses.

## Production Oracle

Create an entry under `apps/oracle/src`, import your root `deployments.json`,
and call `startOracle`.

```ts
import "dotenv/config";
import { z } from "zod";
import { startOracle, type AgentHandler } from "@tee-agent/server";
import deployments from "../../../../deployments.json" with { type: "json" };

const payloadSchema = z.object({ prompt: z.string() });

const handler: AgentHandler = {
  async run(rawPayload, ctx) {
    const payload = payloadSchema.parse(rawPayload);
    const skill = ctx.blobs[0] as string;
    return {
      result: `${skill}\n\n${payload.prompt}`,
      signer: ctx.wallet.address,
    };
  },
};

await startOracle({ handler, deployments });
```

Required production env:

```dotenv
NETWORK=base
RPC_URL_BASE=
PRIVATE_KEY=
ZERO_G_RPC_URL=
ZERO_G_INDEXER_URL=
PORT=3001
DSTACK_VERIFIER_URL=
```

Add handler-specific env such as `LLM_API_KEY`, `LLM_API_BASE`, or external API
keys as needed. Do not set `DSTACK_SIMULATOR_ENDPOINT` in production.

Deploy from the repo root:

```bash
npm run deploy:oracle -- src/prod/my-oracle.ts
```

The deploy script runs Phala CLI with encrypted env values and sets
`ORACLE_ENTRY` for the CVM. After the first deploy, run `phala link` from
`apps/oracle` so later deploys update the same CVM.

## Endpoints

- `GET /health`
- `GET /address`
- `GET /info`
- `GET /attestation`
- `POST /run`
- `POST /reencrypt`
- `POST /validate`

`GET /address` returns the TEE-derived oracle signer and public key. Agents must
store the public Phala HTTPS URL as their `teeOracle` service endpoint.
