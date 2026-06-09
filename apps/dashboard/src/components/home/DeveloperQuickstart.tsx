import type { ReactNode } from "react";
import { CodeBlock, ProcessTag } from "./HomePrimitives";

const DEPLOY_SNIPPET = `# Deploy contracts and write deployments.json
npm run deploy:baseSepolia --workspace=contracts
npm run setup-env --workspace=contracts

# Copy an example oracle or create your own handler
cp apps/oracle/src/examples/prediction-market.ts \\
  apps/oracle/src/prod/my-oracle.ts

# Fill root .env and apps/oracle/.env, then deploy it
npm run oracle:image
npm run oracle:deploy -- src/prod/my-oracle.ts

# oracle:deploy prints the HTTPS teeOracle endpoint`;

const ORACLE_HANDLER_SNIPPET = `const handler = {
  async run(payload, ctx) {
    const skill = ctx.blobs[0];
    const config = ctx.blobs[1];
    return {
      answer: await runModel({
        prompt: skill,
        input: payload.question,
        config,
      }),
    };
  },
};

await startOracle({ handler, deployments });`;

const MINT_SNIPPET = `const network = getNetworkConfig("baseSepolia");

const deployment = deployments[String(network.chainId)];
const contracts = deployment.contracts;
const config = {
  chain: network.chain,
  registryAddress: contracts.agentRegistry,
  teeVerifierAddress: contracts.teeVerifier,
  validationRegistryAddress: contracts.validationRegistry,
  identityRegistryAddress: network.identityRegistryAddress,
  reputationRegistryAddress: network.reputationRegistryAddress,
  rpcUrl,
  pinataJwt,
  privateKey,
  zeroGRpcUrl,
  zeroGIndexerUrl,
} satisfies AgentConfig;

const prepared = await prepareMint(config, {
  name: "Prediction Agent",
  description: "Runs inside my Phala CVM.",
  imageUrl,
  ownerAddress,
  services: [{ name: "teeOracle", endpoint: oracleUrl }],
  privateEntries: [{ name: "skill", data: systemPrompt }],
});

await walletClient.writeContract({
  address: prepared.contractAddress,
  abi: AGENT_REGISTRY_ABI,
  functionName: "mint",
  args: [
    ownerAddress,
    prepared.publicMetadataUri, // ERC-721 metadata
    prepared.agentMetadataUri,  // ERC-8004 services
    prepared.intelligentData,   // ERC-7857 private data
  ],
});`;

const ORACLE_HTTP_SNIPPET = `const payload = { question: "Who won this market?" };
const deadline = Math.floor(Date.now() / 1000) + 300;
const typedData = buildRunTypedData({
  oracleAddress,
  chainId: network.chainId,
  agentId,
  payload,
  deadline,
});

const signature = await walletClient.signTypedData({
  account: ownerAddress,
  ...typedData,
});

const run = await fetch(\`\${oracleUrl}/run\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    agentId: agentId.toString(),
    registryAddress: contracts.agentRegistry,
    payload,
    signature,
    deadline,
  }),
}).then((res) => res.json());

const verified = await fetch(\`\${oracleUrl}/verify\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    quote: run.quote,
    event_log: run.event_log,
  }),
}).then((res) => res.json());`;

const VALIDATION_SNIPPET = `const requestURI = toDataUri({
  ...
});
const validation = prepareValidation(config, {
  agentId: erc8004AgentId,
  validatorAddress: contracts.teeVerifier,
  requestURI,
});

await walletClient.writeContract({
  address: contracts.validationRegistry,
  abi: VALIDATION_REGISTRY_ABI,
  functionName: "validationRequest",
  args: [
    validation.validatorAddress,
    BigInt(validation.agentId),
    validation.requestURI,
    validation.requestHash,
  ],
});

// Worker watches ValidationRequest events, signs as PRIVATE_KEY,
// then calls the agent teeOracle. The oracle submits validationResponse.
await fetch(\`\${oracleUrl}/validate\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(validateRequest),
});`;

const TRANSFER_SNIPPET = `const offer = await createTransferOffer(config, transferParams);
const toSign = getTransferAccessPayloadsToSign(offer);
const signatures = await wallet.signMessages(toSign);
const acceptance = buildTransferAcceptance(offer, signatures);
await walletClient.writeContract(buildTransferTxArgs(acceptance));`;

function QuickstartStep({
  step,
  title,
  description,
  tag,
  code,
}: {
  step: number;
  title: string;
  description: string;
  tag: string;
  code: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/45 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-cyan-800/60 bg-cyan-950/40 text-[10px] font-mono text-cyan-300">
              {step}
            </span>
            <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          </div>
          <p className="text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <ProcessTag>{tag}</ProcessTag>
      </div>
      <CodeBlock code={code} />
    </div>
  );
}

function QuickstartGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="glass-card flex h-full min-w-0 flex-col overflow-hidden rounded-xl p-4 md:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <div className="grid min-w-0 gap-3">{children}</div>
    </div>
  );
}

export default function DeveloperQuickstart() {
  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Build On Top</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Deploy one Phala CVM oracle, point ERC-8004 `teeOracle` services at
            it, then use the SDK from any app or backend. Remote oracle trust is
            enforced on-chain through Automata DCAP verification of Intel TDX
            quotes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ProcessTag>@tee-agent/server</ProcessTag>
          <ProcessTag>@tee-agent/agent</ProcessTag>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <QuickstartGroup
          title="Launch An Agent"
          description="Deploy the contracts and oracle, then mint the agent with ERC-721 metadata, ERC-8004 services, and ERC-7857 private data."
        >
          <QuickstartStep
            step={1}
            title="Deploy"
            description="Deploy contracts and one Phala CVM oracle through the repo scripts. oracle:deploy prints the HTTPS endpoint to use as teeOracle."
            tag="Automata DCAP"
            code={DEPLOY_SNIPPET}
          />
          <QuickstartStep
            step={2}
            title="Handler"
            description="Copy an oracle example or create your own handler; /run receives the owner-signed payload and decrypted private blobs."
            tag="Oracle"
            code={ORACLE_HANDLER_SNIPPET}
          />
          <QuickstartStep
            step={3}
            title="Mint"
            description="Prepare metadata, ERC-8004 services, and ERC-7857 encrypted data, then call AgentRegistry."
            tag="ERC-7857 + 8004"
            code={MINT_SNIPPET}
          />
        </QuickstartGroup>

        <QuickstartGroup
          title="Use And Transfer"
          description="Run the oracle, verify TDX quotes, respond to validation requests, and transfer the encrypted agent safely."
        >
          <QuickstartStep
            step={4}
            title="Run then Verify"
            description="Call the teeOracle /run endpoint with an owner signature, then verify the returned TDX quote through /verify."
            tag="/run"
            code={ORACLE_HTTP_SNIPPET}
          />
          <QuickstartStep
            step={5}
            title="Validate"
            description="Write a ValidationRequest, then let the owner worker call /validate so the oracle submits the TEE-backed response."
            tag="/validate"
            code={VALIDATION_SNIPPET}
          />
          <QuickstartStep
            step={6}
            title="Transfer"
            description="Create an offer, let the recipient accept, then submit the combined transfer transaction."
            tag="Transfer"
            code={TRANSFER_SNIPPET}
          />
        </QuickstartGroup>
      </div>
    </section>
  );
}
