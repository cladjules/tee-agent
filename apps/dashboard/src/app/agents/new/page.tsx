"use client";

import { useState, useTransition } from "react";
import { parseEventLogs } from "viem";
import {
  AGENT_REGISTRY_ABI,
  IDENTITY_REGISTRY_ABI,
} from "@tee-agent/agent/abis";
import { NETWORK_CONFIG } from "@tee-agent/agent/network";
import { useWallet } from "@/providers/WalletProvider";
import {
  prepareCreateAgent,
  fetchAgentServices,
  preparePostMintRegistration,
  prepareTeeOracleServiceUpdate,
} from "@/lib/actions/agents";
import { ErrorBox } from "@/components/ErrorBox";
import {
  ServiceEditorPanel,
  type ServiceEditorEntry,
} from "@/components/ServiceEditorPanel";
import { AgentMetadataForm } from "@/components/AgentMetadataForm";
import type { PrepareImportedErc8004TeeOracleResult } from "@tee-agent/agent/types";

// ── Types ─────────────────────────────────────────────────────────────────────

// ── Skill templates (Private Data step presets) ───────────────────────────────

const SKILL_TEMPLATES = [
  {
    id: "prediction-verifier",
    label: "Prediction Market Oracle",
    icon: "⚖️",
    description:
      "LLM verifier — YES / NO / INVALID verdict with confidence score",
    entries: [
      {
        name: "SKILL.md",
        data:
          "# Prediction Market Resolver\n" +
          "You are an objective prediction market resolver.\n" +
          "Given a claim and optional evidence, determine whether the claim is true (YES), false (NO), or cannot be determined (INVALID).\n" +
          'Respond with valid JSON only: { \"verdict\": \"YES\" | \"NO\" | \"INVALID\", \"confidence\": 0-100, \"reasoning\": \"...\" }',
      },
      {
        name: "parameters.json",
        data: JSON.stringify(
          {
            model: "phala/gemma-4-26b-a4b-uncensored",
            temperature: 0.2,
            top_p: 0.9,
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: "web-fetcher",
    label: "Web Data Oracle",
    icon: "🌐",
    description: "Fetch a URL and optionally analyse the content with an LLM",
    entries: [
      {
        name: "SKILL.md",
        data:
          "# Web Data Analyst\n" +
          "You are a web data analyst. Extract and summarise the key information from the provided web page content.",
      },
      {
        name: "parameters.json",
        data: JSON.stringify(
          {
            allowedDomains: ["api.github.com"],
            llm: {
              model: "phala/gemma-4-26b-a4b-uncensored",
              temperature: 0.3,
              top_p: 0.9,
            },
          },
          null,
          2,
        ),
      },
    ],
  },
];

const STEPS = ["Identity", "Services", "Private Data", "Review"];

// ── Main component ────────────────────────────────────────────────────────────

export default function NewAgentPage() {
  const { address, chainId, connect, getWalletClient } = useWallet();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<{
    tokenId?: bigint;
    chainId?: number;
    txHash?: string;
    error?: string;
  } | null>(null);

  // Step 1 — identity
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [agentType, setAgentType] = useState("assistant");
  const [x402Support, setX402Support] = useState(false);

  // Step 1 — services (managed by ServiceEditorPanel)
  const [builtServices, setBuiltServices] = useState<ServiceEditorEntry[]>([]);
  // "new" = register a fresh ERC-8004 identity at mint; "import" = attach an existing one.
  const [serviceMode, setServiceMode] = useState<"new" | "import">("new");
  const [importTokenId, setImportTokenId] = useState("");
  const [importPending, setImportPending] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedFrom, setImportedFrom] = useState<string | null>(null);
  const [verifiedImport, setVerifiedImport] = useState<{
    tokenId: string;
    owner: `0x${string}`;
  } | null>(null);
  const [serviceStepError, setServiceStepError] = useState<string | null>(null);
  const [serviceStepVerifying, setServiceStepVerifying] = useState(false);
  // Bumping this key forces ServiceEditorPanel to remount with new initialServices.
  const [servicesPanelKey, setServicesPanelKey] = useState(0);
  const [importedServices, setImportedServices] = useState<
    readonly {
      name: string;
      endpoint: string;
      version?: string;
      skills?: readonly string[];
      domains?: readonly string[];
    }[]
  >([]);

  // Step 2 — private data (ERC-7857 intelligent data, AES-256-GCM encrypted)
  const [privateEntries, setPrivateEntries] = useState<
    { name: string; data: string }[]
  >([{ name: "", data: "" }]);

  // ── Wizard navigation ───────────────────────────────────────────────────────

  function canAdvance(): boolean {
    if (step === 0)
      return name.trim().length > 0 && description.trim().length > 0;
    if (step === 1) {
      if (serviceMode === "import") {
        if (!importTokenId.trim() || !address) return false;
        if (
          verifiedImport?.tokenId !== importTokenId.trim() ||
          verifiedImport.owner.toLowerCase() !== address.toLowerCase()
        ) {
          return false;
        }
      }
      return !!teeOracleUrlFromServices(builtServices);
    }
    return true;
  }

  async function verifyTeeOracleBeforeNext(): Promise<boolean> {
    const teeOracleUrl = teeOracleUrlFromServices(builtServices);
    if (!teeOracleUrl) {
      setServiceStepError("teeOracle URL is required.");
      return false;
    }
    setServiceStepVerifying(true);
    setServiceStepError(null);
    try {
      const normalizedUrl = teeOracleUrl.trim().replace(/\/+$/, "");
      const res = await fetch(`${normalizedUrl}/address`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`teeOracle /address returned ${res.status}.`);
      }
      const body = (await res.json()) as {
        address?: string;
        publicKey?: string;
      };
      if (
        !body.address?.startsWith("0x") ||
        !body.publicKey?.startsWith("0x")
      ) {
        throw new Error(
          "teeOracle /address must return address and publicKey.",
        );
      }
      return true;
    } catch (err) {
      setServiceStepError(
        err instanceof Error ? err.message : "teeOracle verification failed.",
      );
      return false;
    } finally {
      setServiceStepVerifying(false);
    }
  }

  async function handleNext() {
    if (step === 1) {
      if (
        serviceMode === "import" &&
        (!verifiedImport ||
          verifiedImport.tokenId !== importTokenId.trim() ||
          !address ||
          verifiedImport.owner.toLowerCase() !== address.toLowerCase())
      ) {
        setServiceStepError(
          "Load an ERC-8004 agent you own before continuing.",
        );
        return;
      }
      const ok = await verifyTeeOracleBeforeNext();
      if (!ok) return;
    }
    setStep((s) => s + 1);
  }

  // ── Submit (step 3 → mint) ──────────────────────────────────────────────────

  function handleMint() {
    setResult(null);

    const oasfService = builtServices.find((s) => s.name === "OASF");

    startTransition(async () => {
      try {
        const walletClient = await getWalletClient();
        if (!walletClient) {
          setResult({ error: "Wallet client not available." });
          return;
        }
        const chainId = await walletClient.getChainId();

        const isImport =
          serviceMode === "import" && importTokenId.trim() !== "";
        let importedErc8004Update:
          | PrepareImportedErc8004TeeOracleResult
          | undefined;

        if (isImport) {
          const teeOracleUrl = teeOracleUrlFromServices(builtServices);
          if (!teeOracleUrl) {
            setResult({ error: "teeOracle URL is required." });
            return;
          }
          const preparedImport = await prepareTeeOracleServiceUpdate({
            chainId,
            erc8004AgentId: importTokenId.trim(),
            teeOracleUrl,
          });
          if ("error" in preparedImport) {
            setResult({ error: preparedImport.error });
            return;
          }
          importedErc8004Update = preparedImport;
        }

        const prepared = await prepareCreateAgent({
          chainId,
          name,
          description,
          imageUrl: imageUrl || undefined,
          agentType,
          x402Support,
          privateEntries: privateEntries.filter(
            (e) => e.name.trim() && e.data.trim(),
          ),
          services: builtServices,
          oasfSkills: oasfService?.skills ?? [],
          oasfDomains: oasfService?.domains ?? [],
          ownerAddress: (address ?? "0x") as `0x${string}`,
        });

        if ("error" in prepared) {
          setResult({ error: prepared.error });
          return;
        }

        if (isImport && importedErc8004Update) {
          const updateHash = await walletClient.writeContract({
            address: importedErc8004Update.erc8004RegistryAddress,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "setAgentURI",
            args: [
              BigInt(importedErc8004Update.erc8004AgentId),
              importedErc8004Update.tokenUri,
            ],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await walletClient.waitForTransactionReceipt({ hash: updateHash });
        }

        const mintRequest = isImport
          ? {
              address: prepared.contractAddress!,
              abi: AGENT_REGISTRY_ABI,
              functionName: "mintWithExisting8004",
              args: [
                address as `0x${string}`,
                prepared.publicMetadataUri!,
                BigInt(importTokenId.trim()),
                prepared.intelligentData ?? [],
              ],
              chain: walletClient.chain,
              account: walletClient.account!,
            }
          : {
              address: prepared.contractAddress!,
              abi: AGENT_REGISTRY_ABI,
              functionName: "mint",
              args: [
                address as `0x${string}`,
                prepared.publicMetadataUri!,
                prepared.agentMetadataUri!,
                prepared.intelligentData ?? [],
              ],
              chain: walletClient.chain,
              account: walletClient.account!,
            };
        const mintGas = await walletClient.estimateContractGas(mintRequest);
        const mintHash = await walletClient.writeContract({
          ...mintRequest,
          gas: (mintGas * 120n) / 100n,
        });

        const receipt = await walletClient.waitForTransactionReceipt({
          hash: mintHash,
        });

        const contractLogs = receipt.logs.filter(
          (l) =>
            l.address.toLowerCase() === prepared.contractAddress!.toLowerCase(),
        );

        const [log] = parseEventLogs({
          abi: AGENT_REGISTRY_ABI,
          logs: contractLogs,
          eventName: "Registered",
          strict: false,
        }) as Array<{ args?: { agentId?: bigint } }>;

        const mintedTokenId = log?.args?.agentId;

        setResult({
          tokenId: mintedTokenId,
          chainId,
          txHash: mintHash,
        });
      } catch (err) {
        setResult({
          error: err instanceof Error ? err.message : "Mint failed.",
        });
      }
    });
  }

  // ── Success screen ──────────────────────────────────────────────────────────

  if (result?.tokenId !== undefined && !result.error) {
    const networkKey =
      Object.entries(NETWORK_CONFIG).find(
        ([, network]) => network.chain.id === result.chainId,
      )?.[0] ?? "baseSepolia";

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
            href={`/agents/${networkKey}/${result.tokenId.toString()}`}
            className="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold"
          >
            View Agent
          </a>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setStep(0);
            }}
            className="px-5 py-2.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 text-sm"
          >
            Create Another
          </button>
        </div>
      </div>
    );
  }

  // ── Wallet gate ─────────────────────────────────────────────────────────────

  if (!address) {
    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <Header />
        <div className="rounded-2xl border border-violet-800/60 bg-violet-950/30 p-8 text-center space-y-4">
          <h2 className="text-xl font-semibold text-white">
            Connect your wallet to continue
          </h2>
          <p className="text-sm text-gray-400">
            Agent minting is wallet-bound — your address becomes the owner.
          </p>
          <button
            type="button"
            onClick={() => void connect()}
            className="px-8 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  // ── Wizard ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <Header />

      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              className={`flex items-center gap-2 text-xs font-medium transition-colors ${
                i === step
                  ? "text-violet-300"
                  : i < step
                    ? "text-gray-400 hover:text-gray-200 cursor-pointer"
                    : "text-gray-600 cursor-default"
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border transition-colors ${
                  i < step
                    ? "bg-violet-700 border-violet-600 text-white"
                    : i === step
                      ? "bg-violet-600 border-violet-500 text-white"
                      : "bg-gray-800 border-gray-700 text-gray-500"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 && (
              <div
                className={`flex-1 h-px mx-3 ${i < step ? "bg-violet-700" : "bg-gray-800"}`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step panels */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 space-y-5">
        {/* Step 0 — Identity */}
        {step === 0 && (
          <>
            <h2 className="text-base font-semibold text-gray-100">Identity</h2>
            <AgentMetadataForm
              value={{ name, description, imageUrl, agentType }}
              onChange={(next) => {
                setName(next.name);
                setDescription(next.description);
                setImageUrl(next.imageUrl);
                setAgentType(next.agentType);
              }}
            />
          </>
        )}

        {/* Step 1 — Services */}
        {step === 1 && (
          <>
            <div>
              <h2 className="text-base font-semibold text-gray-100">
                Services
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                How do you want to set up ERC-8004 services for this agent?
              </p>
            </div>

            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setServiceMode("new");
                  setVerifiedImport(null);
                  setImportError(null);
                  setImportedFrom(null);
                }}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  serviceMode === "new"
                    ? "border-violet-500 bg-violet-950/40"
                    : "border-gray-700 bg-gray-800/20 hover:border-gray-600"
                }`}
              >
                <p className="text-sm font-semibold text-gray-100">
                  Register new
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Create a fresh ERC-8004 identity at mint
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setServiceMode("import");
                  setVerifiedImport(null);
                  setImportedFrom(null);
                }}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  serviceMode === "import"
                    ? "border-violet-500 bg-violet-950/40"
                    : "border-gray-700 bg-gray-800/20 hover:border-gray-600"
                }`}
              >
                <p className="text-sm font-semibold text-gray-100">
                  Use existing
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Attach an ERC-8004 agent you already own
                </p>
              </button>
            </div>

            {/* Import panel — only shown in import mode */}
            {serviceMode === "import" && (
              <div className="rounded-lg border border-gray-700 bg-gray-800/30 p-4 space-y-3">
                <p className="text-xs text-gray-400">
                  Enter the ERC-8004 token ID you own. Existing metadata stays
                  unchanged except for the required teeOracle service entry.
                </p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    value={importTokenId}
                    onChange={(e) => {
                      setImportTokenId(e.target.value);
                      setImportError(null);
                      setImportedFrom(null);
                      setVerifiedImport(null);
                    }}
                    placeholder="ERC-8004 Token ID"
                    className={`${INPUT} flex-1`}
                  />
                  <button
                    type="button"
                    disabled={
                      importPending || !importTokenId.trim() || !address
                    }
                    onClick={async () => {
                      setImportPending(true);
                      setImportError(null);
                      setImportedFrom(null);
                      setVerifiedImport(null);
                      setServiceStepError(null);
                      const res = await fetchAgentServices(
                        importTokenId.trim(),
                        address,
                        chainId,
                      );
                      setImportPending(false);
                      if ("error" in res) {
                        setImportError(res.error);
                      } else {
                        setImportedServices(
                          res.teeOracleUrl
                            ? [
                                {
                                  name: "teeOracle",
                                  endpoint: res.teeOracleUrl,
                                },
                              ]
                            : [],
                        );
                        setImportedFrom(res.agentName);
                        setVerifiedImport({
                          tokenId: importTokenId.trim(),
                          owner: address,
                        });
                        setServicesPanelKey((k) => k + 1);
                      }
                    }}
                    className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-semibold transition-colors whitespace-nowrap"
                  >
                    {importPending ? "Loading…" : "Load"}
                  </button>
                </div>
                {importError && (
                  <p className="text-xs text-red-400">{importError}</p>
                )}
                {importedFrom && (
                  <p className="text-xs text-green-400">
                    ✓ Loaded &ldquo;{importedFrom}&rdquo; — add or confirm the
                    teeOracle endpoint below
                  </p>
                )}
              </div>
            )}

            <ServiceEditorPanel
              key={servicesPanelKey}
              initialServices={importedServices}
              onChange={setBuiltServices}
              initialX402={x402Support}
              onX402Change={setX402Support}
              hideServices={serviceMode === "import"}
            />
            {serviceStepError && <ErrorBox message={serviceStepError} />}
          </>
        )}

        {/* Step 2 — Private Data */}
        {step === 2 && (
          <>
            <div>
              <h2 className="text-base font-semibold text-gray-100">
                Private Data
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Each entry is AES-256-GCM encrypted and stored on 0G Storage.
                Leave all rows empty to skip.
              </p>
            </div>

            {/* Skill templates */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-400">
                Quick templates
              </p>
              <div className="grid grid-cols-2 gap-2">
                {SKILL_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() =>
                      setPrivateEntries(
                        template.entries.map((e) => ({
                          name: e.name,
                          data: e.data,
                        })),
                      )
                    }
                    className="text-left rounded-lg border border-gray-700 bg-gray-800/40 hover:border-violet-600 hover:bg-violet-950/20 px-4 py-3 transition-colors group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base">{template.icon}</span>
                      <span className="text-xs font-semibold text-gray-200 group-hover:text-violet-300 transition-colors">
                        {template.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 leading-snug">
                      {template.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {privateEntries.map((entry, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-gray-800 bg-gray-900/30 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={entry.name}
                      onChange={(e) =>
                        setPrivateEntries((p) =>
                          p.map((x, j) =>
                            j === i ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="Name — e.g. SKILL.md"
                      className={INPUT}
                    />
                    {privateEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setPrivateEntries((p) => p.filter((_, j) => j !== i))
                        }
                        className="shrink-0 text-gray-500 hover:text-red-400 text-xl leading-none"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <textarea
                    value={entry.data}
                    onChange={(e) =>
                      setPrivateEntries((p) =>
                        p.map((x, j) =>
                          j === i ? { ...x, data: e.target.value } : x,
                        ),
                      )
                    }
                    rows={4}
                    placeholder={`Data — e.g. ### My Agent Skills\n\n- Summarisation\n- Research`}
                    className={`${INPUT} resize-y font-mono`}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setPrivateEntries((p) => [...p, { name: "", data: "" }])
                }
                className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
              >
                + Add entry
              </button>
            </div>
          </>
        )}

        {/* Step 3 — Minting progress */}
        {step === 3 && isPending && (
          <div className="flex flex-col items-center justify-center py-12 space-y-5">
            <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-center space-y-2">
              <p className="text-base font-semibold text-white">
                Minting in progress…
              </p>
              <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
                Encrypting private data, uploading to 0G Storage, pinning
                metadata to IPFS, and submitting the on-chain transaction. This
                may take up to a minute.
              </p>
            </div>
          </div>
        )}

        {/* Step 3 — Review */}
        {step === 3 && !isPending && (
          <>
            <h2 className="text-base font-semibold text-gray-100">Review</h2>
            <div className="space-y-3 text-sm">
              <ReviewRow label="Name" value={name} />
              <ReviewRow label="Description" value={description} />
              {imageUrl && <ReviewRow label="Image" value={imageUrl} mono />}
              <ReviewRow label="Type" value={agentType} />
              <ReviewRow
                label="Services"
                value={
                  builtServices.length
                    ? builtServices.map((s) => s.name).join(", ")
                    : "None"
                }
              />
              {(() => {
                const oasfService = builtServices.find(
                  (s) => s.name === "OASF",
                );
                const skillCount = oasfService?.skills?.length ?? 0;
                const domainCount = oasfService?.domains?.length ?? 0;
                if (!skillCount && !domainCount) return null;
                return (
                  <ReviewRow
                    label="OASF"
                    value={
                      [
                        skillCount
                          ? `${skillCount} skill${skillCount !== 1 ? "s" : ""}`
                          : "",
                        domainCount
                          ? `${domainCount} domain${domainCount !== 1 ? "s" : ""}`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(", ") + " → IPFS profile auto-generated"
                    }
                  />
                );
              })()}
              <ReviewRow
                label="x402 Support"
                value={x402Support ? "Enabled" : "Disabled"}
              />
              <ReviewRow
                label="Private Data"
                value={
                  privateEntries.filter((e) => e.name.trim() && e.data.trim())
                    .length
                    ? `${privateEntries.filter((e) => e.name.trim() && e.data.trim()).length} entr${
                        privateEntries.filter(
                          (e) => e.name.trim() && e.data.trim(),
                        ).length === 1
                          ? "y"
                          : "ies"
                      } (encrypted)`
                    : "None"
                }
              />
              <ReviewRow label="Owner" value={address} mono />
            </div>

            {result?.error && <ErrorBox message={result.error} />}
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() =>
            step === 0 ? (window.location.href = "/") : setStep((s) => s - 1)
          }
          disabled={isPending}
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          {step === 0 ? "Cancel" : "← Back"}
        </button>

        {step < 3 ? (
          <button
            type="button"
            onClick={() => void handleNext()}
            disabled={!canAdvance() || serviceStepVerifying}
            className="px-6 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {serviceStepVerifying ? "Checking…" : "Next →"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleMint}
            disabled={isPending}
            className="px-6 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isPending ? "Minting…" : "Mint Agent"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const INPUT =
  "w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm";

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Create Agent</h1>
      <p className="text-gray-400 text-sm mt-1">
        Register an on-chain AI agent NFT (ERC-721 + ERC-8004).
      </p>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-4 py-2 border-t border-gray-800 first:border-0">
      <span className="w-28 shrink-0 text-gray-500">{label}</span>
      <span
        className={`text-gray-200 break-all ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function teeOracleUrlFromServices(
  services: readonly ServiceEditorEntry[],
): string | undefined {
  return services.find((service) => service.name === "teeOracle")?.endpoint;
}

function validateJson(input: string): string | null {
  if (!input.trim()) return null;
  try {
    JSON.parse(input);
    return null;
  } catch {
    return "Invalid JSON.";
  }
}
