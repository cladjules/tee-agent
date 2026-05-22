"use client";

import { useState, useTransition } from "react";
import { parseEventLogs } from "viem";
import { AGENT_REGISTRY_ABI } from "@open-agents-toolkit/agent/abis";
import { useWallet } from "@/components/wallet/WalletProvider";
import { prepareCreateAgent } from "@/lib/actions/agents";

const AGENT_TYPES = [
  { value: "assistant", label: "Assistant" },
  { value: "researcher", label: "Researcher" },
  { value: "coder", label: "Coder" },
  { value: "analyst", label: "Analyst" },
  { value: "creative", label: "Creative" },
  { value: "other", label: "Other" },
];

interface AgentService {
  name: "web" | "A2A" | "MCP" | "OASF" | "DID" | "email";
  endpoint: string;
  version: string;
}

const EIP8004_SERVICE_NAMES: AgentService["name"][] = [
  "web",
  "A2A",
  "MCP",
  "OASF",
  "DID",
  "email",
];

export default function NewAgentPage() {
  const { address, connect, getViemClients, switchChain } = useWallet();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    tokenId?: bigint;
    txHash?: string;
    error?: string;
  } | null>(null);
  const [showPrivate, setShowPrivate] = useState(false);
  const [characterDef, setCharacterDef] = useState(
    '{\n  "name": "Agent",\n  "persona": "helpful",\n  "traits": ["concise", "accurate"],\n  "style": {\n    "tone": "professional",\n    "verbosity": "medium"\n  }\n}',
  );
  const [services, setServices] = useState<AgentService[]>(
    EIP8004_SERVICE_NAMES.map((name) => ({ name, endpoint: "", version: "" })),
  );
  const characterDefError = validateJsonInput(characterDef);

  function updateService(
    index: number,
    field: "endpoint" | "version",
    value: string,
  ) {
    setServices((prev) =>
      prev.map((service, i) =>
        i === index ? { ...service, [field]: value } : service,
      ),
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);

    if (showPrivate && characterDefError) {
      setResult({ error: "Character Definition must be valid JSON." });
      return;
    }

    const formData = new FormData(e.currentTarget);
    formData.set(
      "servicesJson",
      JSON.stringify(services.filter((s) => s.endpoint.trim().length > 0)),
    );
    if (address) formData.set("ownerAddress", address);

    startTransition(async () => {
      try {
        const prepared = await prepareCreateAgent(formData);
        if ("error" in prepared && prepared.error) {
          setResult({ error: prepared.error });
          return;
        }
        if ("tokenId" in prepared) {
          setResult({ tokenId: prepared.tokenId });
          return;
        }

        await switchChain();
        const { publicClient, walletClient } = await getViemClients();
        const mintHash = await walletClient.writeContract({
          address: prepared.contractAddress!,
          abi: AGENT_REGISTRY_ABI,
          functionName: "mint",
          args: [
            address as `0x${string}`,
            prepared.publicMetadataUri!,
            prepared.agentMetadataUri!,
            prepared.intelligentData ?? [],
          ],
          value: BigInt(prepared.mintFee ?? "0"),
          chain: walletClient.chain,
          account: walletClient.account!,
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: mintHash,
        });

        const registeredLogs = parseEventLogs({
          abi: AGENT_REGISTRY_ABI,
          logs: receipt.logs,
          eventName: "Registered",
          strict: false,
        });

        const registeredLog = registeredLogs[0] as
          | { args?: { agentId?: bigint } }
          | undefined;
        const tokenId = registeredLog?.args?.agentId;

        setResult({ tokenId, txHash: mintHash });
      } catch (error) {
        setResult({
          error: error instanceof Error ? error.message : "Create failed.",
        });
      }
    });
  }

  if (result?.tokenId !== undefined && !result.error) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-4">
        <div className="text-5xl">🎉</div>
        <h2 className="text-2xl font-bold text-green-400">Agent Created!</h2>
        <p className="text-gray-400">
          Token ID:{" "}
          <span className="font-mono text-white font-semibold">
            #{result.tokenId.toString()}
          </span>
        </p>
        {result.txHash && (
          <p className="font-mono text-xs text-gray-500 break-all">
            {result.txHash}
          </p>
        )}
        <div className="flex gap-3 justify-center pt-2">
          <a
            href={`/agents/${result.tokenId.toString()}`}
            className="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold"
          >
            View Agent
          </a>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="px-5 py-2.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 text-sm"
          >
            Create Another
          </button>
        </div>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Create Agent</h1>
          <p className="text-gray-400 mt-1">
            Register an on-chain AI agent NFT.
          </p>
        </div>

        <div className="rounded-2xl border border-violet-800/60 bg-violet-950/30 p-8 text-center space-y-4">
          <h2 className="text-2xl font-semibold text-white">
            Connect Wallet First
          </h2>
          <p className="text-sm text-gray-300 max-w-md mx-auto">
            Agent creation is wallet-bound and requires your connected address
            as the owner.
          </p>
          <button
            type="button"
            onClick={() => void connect()}
            className="inline-flex items-center justify-center px-8 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-base font-semibold transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Create Agent</h1>
        <p className="text-gray-400 mt-1">Register an on-chain AI agent NFT.</p>
        <p className="text-xs text-gray-500 mt-2">
          Minting from connected wallet {address}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identity */}
        <fieldset className="space-y-4 p-5 rounded-xl border border-gray-800 bg-gray-900/50">
          <legend className="px-2 text-sm font-semibold text-gray-300">
            Identity
          </legend>

          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Owned By Wallet
            </label>
            <input
              type="text"
              value={address}
              readOnly
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm font-mono"
            />
          </div>

          <Field
            label="Name *"
            name="name"
            placeholder="My Research Agent"
            required
          />
          <Field
            label="Description *"
            name="description"
            placeholder="What does this agent do?"
            required
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Type</label>
              <select
                name="agentType"
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 focus:outline-none focus:border-violet-600 text-sm"
              >
                {AGENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="Image URL"
              name="imageUrl"
              type="url"
              placeholder="https://…"
            />
          </div>
        </fieldset>

        {/* Services */}
        <fieldset className="space-y-4 p-5 rounded-xl border border-gray-800 bg-gray-900/50">
          <legend className="px-2 text-sm font-semibold text-gray-300">
            Services
          </legend>
          <p className="text-xs text-gray-500 px-2 -mt-2">
            EIP-8004 services. Fill the endpoints you support.
          </p>

          <div className="space-y-4">
            {services.map((service, idx) => (
              <div
                key={idx}
                className="p-3 rounded-lg border border-gray-700 bg-gray-800/50"
              >
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-12 md:col-span-3">
                    <input
                      type="text"
                      value={service.name}
                      disabled
                      className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 text-sm"
                    />
                  </div>
                  <div className="col-span-12 md:col-span-6">
                    <input
                      type="text"
                      value={service.endpoint}
                      onChange={(e) =>
                        updateService(idx, "endpoint", e.target.value)
                      }
                      placeholder="Endpoint"
                      className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-500 text-sm"
                    />
                  </div>
                  <div className="col-span-12 md:col-span-3">
                    <input
                      type="text"
                      value={service.version}
                      onChange={(e) =>
                        updateService(idx, "version", e.target.value)
                      }
                      placeholder="Version"
                      className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-500 text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        {/* Private metadata toggle */}
        <div>
          <button
            type="button"
            onClick={() => setShowPrivate((v) => !v)}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            <span
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                showPrivate
                  ? "bg-violet-600 border-violet-500"
                  : "border-gray-600"
              }`}
            >
              {showPrivate && (
                <svg
                  className="w-2.5 h-2.5 text-white"
                  fill="currentColor"
                  viewBox="0 0 12 12"
                >
                  <path
                    d="M10 3L5 8.5 2 5.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            Add private metadata (ERC-7857 encrypted NFT)
          </button>
          <p className="text-xs text-gray-600 mt-1 ml-6">
            System prompt and character file — AES-256-GCM encrypted, stored on
            0G Storage.
          </p>
        </div>

        {showPrivate && (
          <fieldset className="space-y-4 p-5 rounded-xl border border-violet-900/50 bg-violet-950/20">
            <legend className="px-2 text-sm font-semibold text-violet-300">
              Private Metadata
              <span className="text-violet-500 font-normal ml-1">
                — encrypted on-chain
              </span>
            </legend>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                System Prompt (SKILL.md)
              </label>
              <textarea
                name="systemPrompt"
                rows={10}
                placeholder="You are a helpful AI assistant…"
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm resize-y font-mono"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Character Definition
              </label>
              <textarea
                name="characterDef"
                rows={10}
                value={characterDef}
                onChange={(e) => setCharacterDef(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm resize-y font-mono"
              />
              {characterDefError ? (
                <p className="text-xs text-red-400 mt-1">{characterDefError}</p>
              ) : (
                <p className="text-xs text-green-400 mt-1">
                  Valid JSON template.
                </p>
              )}
            </div>
          </fieldset>
        )}

        {result?.error && (
          <p className="text-sm text-red-400 bg-red-950/40 px-3 py-2 rounded-lg">
            {result.error}
          </p>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={isPending || !address}
            className="px-6 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create Agent"}
          </button>
          <a
            href="/"
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}

function validateJsonInput(input: string): string | null {
  if (!input.trim()) return null;
  try {
    JSON.parse(input);
    return null;
  } catch {
    return "Invalid JSON.";
  }
}

function Field({
  label,
  name,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
      />
    </div>
  );
}
