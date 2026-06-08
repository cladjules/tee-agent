import type { ReactNode } from "react";
import { CodeBlock, ProcessTag } from "./HomePrimitives";

const DEPLOY_SNIPPET = `# Deploy contracts and write deployments.json
npm run deploy:baseSepolia --workspace=contracts
npm run setup-env --workspace=contracts

# Fill root .env and apps/oracle/.env, then deploy one oracle
npm run oracle:image
npm run oracle:deploy -- src/examples/prediction-market.ts`;

const MINT_SNIPPET = `import { getNetworkConfig } from "@tee-agent/agent/network";
import { getNetworkDeploymentByChainId } from "@tee-agent/agent/config";
import { AGENT_REGISTRY_ABI } from "@tee-agent/agent/abis";
import { prepareMint } from "@tee-agent/agent/mint";
import type { AgentConfig } from "@tee-agent/agent/types";

const network = getNetworkConfig("baseSepolia");
const deployment = getNetworkDeploymentByChainId(network.chainId, deployments);
const config = {
  chain: network.chain,
  registryAddress: deployment.contracts.agentRegistry,
  teeVerifierAddress: deployment.contracts.teeVerifier,
  validationRegistryAddress: deployment.contracts.validationRegistry,
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

const VALIDATE_FEEDBACK_SNIPPET = `import {
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
} from "@tee-agent/agent/abis";
import { prepareValidation } from "@tee-agent/agent/validate";
import { prepareFeedback } from "@tee-agent/agent/feedback";

const validation = prepareValidation(config, {
  agentId: erc8004AgentId,
  validatorAddress: config.teeVerifierAddress,
  requestURI: JSON.stringify(runClaim),
});

await walletClient.writeContract({
  address: validation.contractAddress,
  abi: VALIDATION_REGISTRY_ABI,
  functionName: "validationRequest",
  args: [
    validation.validatorAddress,
    BigInt(validation.agentId),
    validation.requestURI,
    validation.requestHash,
  ],
});

const feedback = await prepareFeedback(config, {
  agentId: erc8004AgentId,
  value: validationScore / 100,
  tag1: "validation",
  tag2: "accuracy",
  feedbackJson: JSON.stringify(validationResult),
});

await walletClient.writeContract({
  address: feedback.contractAddress,
  abi: REPUTATION_REGISTRY_ABI,
  functionName: "giveFeedback",
  args: [
    BigInt(feedback.agentId),
    BigInt(feedback.value),
    feedback.valueDecimals,
    feedback.tag1,
    feedback.tag2,
    "",
    feedback.feedbackURI,
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  ],
});`;

const TRANSFER_SNIPPET = `import {
  createTransferOffer,
  acceptTransferOffer,
  buildTransferTxArgs,
} from "@tee-agent/agent/transfer";

const offer = await createTransferOffer(config, transferParams);
const acceptance = await acceptTransferOffer(offer, recipientSign);
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
            title="Mint"
            description="Prepare metadata, ERC-8004 services, and ERC-7857 encrypted data, then call AgentRegistry."
            tag="ERC-7857 + 8004"
            code={MINT_SNIPPET}
          />
        </QuickstartGroup>

        <QuickstartGroup
          title="Use And Move It"
          description="Validate real runs, turn validation into reputation feedback, and transfer the encrypted agent safely."
        >
          <QuickstartStep
            step={3}
            title="Validate / Feedback"
            description="Request validation, then use the score and reasoning to submit ERC-8004 feedback."
            tag="Validation"
            code={VALIDATE_FEEDBACK_SNIPPET}
          />
          <QuickstartStep
            step={4}
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
