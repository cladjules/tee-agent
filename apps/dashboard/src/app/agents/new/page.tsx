"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { parseEventLogs } from "viem";
import { OASF_SKILLS, OASF_DOMAINS } from "@/lib/oasf-data";
import { AGENT_REGISTRY_ABI } from "@open-agents-toolkit/agent/abis";
import { useWallet } from "@/components/wallet/WalletProvider";
import { prepareCreateAgent } from "@/lib/actions/agents";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CustomService {
  name: string;
  endpoint: string;
  version: string;
}

const AGENT_TYPES = [
  "assistant",
  "researcher",
  "coder",
  "analyst",
  "creative",
  "other",
];

const STEPS = ["Identity", "Services", "Private Data", "Review"];

// ── Main component ────────────────────────────────────────────────────────────

export default function NewAgentPage() {
  const { address, connect, getViemClients, switchChain } = useWallet();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<{
    tokenId?: bigint;
    txHash?: string;
    error?: string;
  } | null>(null);

  // Step 1 — identity
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [agentType, setAgentType] = useState("assistant");
  const [x402Support, setX402Support] = useState(false);

  // Step 1 — services
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpVersion, setMcpVersion] = useState("1.0");
  const [a2aEnabled, setA2aEnabled] = useState(false);
  const [a2aUrl, setA2aUrl] = useState("");
  const [a2aVersion, setA2aVersion] = useState("1.0");
  const [oasfEnabled, setOasfEnabled] = useState(false);
  const [oasfUrl, setOasfUrl] = useState("");
  const [oasfVersion, setOasfVersion] = useState("0.8");
  const [oasfSkills, setOasfSkills] = useState<string[]>([]);
  const [oasfDomains, setOasfDomains] = useState<string[]>([]);
  const [webUrl, setWebUrl] = useState("");
  const [didEndpoint, setDidEndpoint] = useState("");
  const [emailEndpoint, setEmailEndpoint] = useState("");
  const [customServices, setCustomServices] = useState<CustomService[]>([]);

  // Step 2 — private data (ERC-7857 intelligent data, AES-256-GCM encrypted)
  const [privateEntries, setPrivateEntries] = useState<
    { name: string; data: string }[]
  >([{ name: "", data: "" }]);

  // ── Services builder ────────────────────────────────────────────────────────

  function buildServices(): Array<{
    name: string;
    endpoint: string;
    version?: string;
    skills?: string[];
    domains?: string[];
  }> {
    const svcs: Array<{
      name: string;
      endpoint: string;
      version?: string;
      skills?: string[];
      domains?: string[];
    }> = [];
    if (mcpEnabled && mcpUrl.trim())
      svcs.push({
        name: "MCP",
        endpoint: mcpUrl.trim(),
        ...(mcpVersion.trim() ? { version: mcpVersion.trim() } : {}),
      });
    if (a2aEnabled && a2aUrl.trim())
      svcs.push({
        name: "A2A",
        endpoint: a2aUrl.trim(),
        ...(a2aVersion.trim() ? { version: a2aVersion.trim() } : {}),
      });
    if (
      oasfEnabled &&
      (oasfUrl.trim() || oasfSkills.length > 0 || oasfDomains.length > 0)
    )
      svcs.push({
        name: "OASF",
        endpoint: oasfUrl.trim(), // may be empty; server auto-fills ipfs:// URI
        ...(oasfVersion.trim() ? { version: oasfVersion.trim() } : {}),
        ...(oasfSkills.length ? { skills: oasfSkills } : {}),
        ...(oasfDomains.length ? { domains: oasfDomains } : {}),
      });
    if (webUrl.trim()) svcs.push({ name: "web", endpoint: webUrl.trim() });
    if (didEndpoint.trim())
      svcs.push({ name: "DID", endpoint: didEndpoint.trim() });
    if (emailEndpoint.trim())
      svcs.push({ name: "email", endpoint: emailEndpoint.trim() });
    customServices
      .filter((s) => s.name.trim() && s.endpoint.trim())
      .forEach((s) =>
        svcs.push({
          name: s.name.trim(),
          endpoint: s.endpoint.trim(),
          ...(s.version.trim() ? { version: s.version.trim() } : {}),
        }),
      );
    return svcs;
  }

  // ── Wizard navigation ───────────────────────────────────────────────────────

  function canAdvance(): boolean {
    if (step === 0)
      return name.trim().length > 0 && description.trim().length > 0;
    return true;
  }

  // ── Submit (step 3 → mint) ──────────────────────────────────────────────────

  function handleMint() {
    setResult(null);

    const formData = new FormData();
    formData.set("name", name);
    formData.set("description", description);
    formData.set("imageUrl", imageUrl);
    formData.set("agentType", agentType);
    formData.set("x402Support", x402Support ? "true" : "false");
    formData.set(
      "privateEntries",
      JSON.stringify(
        privateEntries.filter((e) => e.name.trim() && e.data.trim()),
      ),
    );
    formData.set("servicesJson", JSON.stringify(buildServices()));
    formData.set("oasfSkills", JSON.stringify(oasfSkills));
    formData.set("oasfDomains", JSON.stringify(oasfDomains));
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

        const [log] = parseEventLogs({
          abi: AGENT_REGISTRY_ABI,
          logs: receipt.logs,
          eventName: "Registered",
          strict: false,
        }) as Array<{ args?: { agentId?: bigint } }>;

        setResult({ tokenId: log?.args?.agentId, txHash: mintHash });
      } catch (err) {
        setResult({
          error: err instanceof Error ? err.message : "Mint failed.",
        });
      }
    });
  }

  // ── Success screen ──────────────────────────────────────────────────────────

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
            <div className="space-y-4">
              <LabeledField label="Name *">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Research Agent"
                  className={INPUT}
                />
              </LabeledField>
              <LabeledField label="Description *">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What does this agent do?"
                  className={`${INPUT} resize-y`}
                />
              </LabeledField>
              <div className="grid grid-cols-2 gap-4">
                <LabeledField label="Image URL">
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://…"
                    className={INPUT}
                  />
                </LabeledField>
                <LabeledField label="Type">
                  <select
                    value={agentType}
                    onChange={(e) => setAgentType(e.target.value)}
                    className={INPUT}
                  >
                    {AGENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                </LabeledField>
              </div>
            </div>
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
                ERC-8004 service endpoints. All fields optional.
              </p>
            </div>
            <div className="space-y-3">
              {/* MCP */}
              <ServiceCard
                label="MCP"
                badge="Model Context Protocol"
                enabled={mcpEnabled}
                onToggle={() => setMcpEnabled((v) => !v)}
              >
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <input
                      type="url"
                      value={mcpUrl}
                      onChange={(e) => setMcpUrl(e.target.value)}
                      placeholder="https://mcp.example.com"
                      className={INPUT}
                    />
                  </div>
                  <input
                    type="text"
                    value={mcpVersion}
                    onChange={(e) => setMcpVersion(e.target.value)}
                    placeholder="Version"
                    className={INPUT}
                  />
                </div>
              </ServiceCard>

              {/* A2A */}
              <ServiceCard
                label="A2A"
                badge="Agent-to-Agent"
                enabled={a2aEnabled}
                onToggle={() => setA2aEnabled((v) => !v)}
              >
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <input
                      type="url"
                      value={a2aUrl}
                      onChange={(e) => setA2aUrl(e.target.value)}
                      placeholder="https://a2a.example.com"
                      className={INPUT}
                    />
                  </div>
                  <input
                    type="text"
                    value={a2aVersion}
                    onChange={(e) => setA2aVersion(e.target.value)}
                    placeholder="Version"
                    className={INPUT}
                  />
                </div>
              </ServiceCard>

              {/* OASF */}
              <ServiceCard
                label="OASF"
                badge="Open Agent Skills Framework"
                enabled={oasfEnabled}
                onToggle={() => setOasfEnabled((v) => !v)}
              >
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <input
                        type="url"
                        value={oasfUrl}
                        onChange={(e) => setOasfUrl(e.target.value)}
                        placeholder="https://oasf.example.com"
                        className={INPUT}
                      />
                    </div>
                    <input
                      type="text"
                      value={oasfVersion}
                      onChange={(e) => setOasfVersion(e.target.value)}
                      placeholder="Version"
                      className={INPUT}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Skills</p>
                      <TagPicker
                        placeholder="Select Skills"
                        hint={`Choose from ${OASF_SKILLS.length} official OASF skills. Selected: ${oasfSkills.length}`}
                        items={OASF_SKILLS}
                        selected={oasfSkills}
                        onChange={setOasfSkills}
                      />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Domains</p>
                      <TagPicker
                        placeholder="Select Domains"
                        hint={`Choose from ${OASF_DOMAINS.length} official OASF domains. Selected: ${oasfDomains.length}`}
                        items={OASF_DOMAINS}
                        selected={oasfDomains}
                        onChange={setOasfDomains}
                      />
                    </div>
                  </div>
                </div>
              </ServiceCard>

              {/* Additional: web / DID / email */}
              <div className="rounded-lg border border-gray-800 bg-gray-900/30 p-4 space-y-2">
                <p className="text-xs font-medium text-gray-400 mb-3">
                  Additional
                </p>
                <div className="grid grid-cols-12 gap-2 items-center">
                  <span className="col-span-2 text-xs font-mono text-gray-500">
                    web
                  </span>
                  <div className="col-span-10">
                    <input
                      type="url"
                      value={webUrl}
                      onChange={(e) => setWebUrl(e.target.value)}
                      placeholder="https://example.com"
                      className={INPUT}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-12 gap-2 items-center">
                  <span className="col-span-2 text-xs font-mono text-gray-500">
                    DID
                  </span>
                  <div className="col-span-10">
                    <input
                      type="text"
                      value={didEndpoint}
                      onChange={(e) => setDidEndpoint(e.target.value)}
                      placeholder="did:example:123"
                      className={INPUT}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-12 gap-2 items-center">
                  <span className="col-span-2 text-xs font-mono text-gray-500">
                    email
                  </span>
                  <div className="col-span-10">
                    <input
                      type="email"
                      value={emailEndpoint}
                      onChange={(e) => setEmailEndpoint(e.target.value)}
                      placeholder="agent@example.com"
                      className={INPUT}
                    />
                  </div>
                </div>
              </div>

              {/* Custom rows */}
              {customServices.map((svc, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-3">
                    <input
                      type="text"
                      value={svc.name}
                      onChange={(e) =>
                        setCustomServices((p) =>
                          p.map((s, j) =>
                            j === i ? { ...s, name: e.target.value } : s,
                          ),
                        )
                      }
                      placeholder="Service name"
                      className={INPUT}
                    />
                  </div>
                  <div className="col-span-5">
                    <input
                      type="text"
                      value={svc.endpoint}
                      onChange={(e) =>
                        setCustomServices((p) =>
                          p.map((s, j) =>
                            j === i ? { ...s, endpoint: e.target.value } : s,
                          ),
                        )
                      }
                      placeholder="Endpoint URL"
                      className={INPUT}
                    />
                  </div>
                  <div className="col-span-3">
                    <input
                      type="text"
                      value={svc.version}
                      onChange={(e) =>
                        setCustomServices((p) =>
                          p.map((s, j) =>
                            j === i ? { ...s, version: e.target.value } : s,
                          ),
                        )
                      }
                      placeholder="Version"
                      className={INPUT}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setCustomServices((p) => p.filter((_, j) => j !== i))
                    }
                    className="col-span-1 flex items-center justify-center text-gray-500 hover:text-red-400 text-xl leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setCustomServices((p) => [
                    ...p,
                    { name: "", endpoint: "", version: "" },
                  ])
                }
                className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
              >
                + Add custom service
              </button>

              {/* x402 */}
              <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-gray-200">
                    HTTP 402 Payment Required
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Enable if your agent implements the HTTP 402 standard for
                    paid services (microtransactions, per-request billing).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setX402Support((v) => !v)}
                  className={`shrink-0 inline-flex h-5 w-9 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${x402Support ? "bg-violet-600" : "bg-gray-600"}`}
                  aria-label="Toggle x402 support"
                >
                  <span
                    className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition-transform ${x402Support ? "translate-x-4" : "translate-x-0"}`}
                  />
                </button>
              </div>
            </div>
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

        {/* Step 3 — Review */}
        {step === 3 && (
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
                  buildServices().length
                    ? buildServices()
                        .map((s) => s.name)
                        .join(", ")
                    : "None"
                }
              />
              {(oasfSkills.length > 0 || oasfDomains.length > 0) && (
                <ReviewRow
                  label="OASF"
                  value={
                    [
                      oasfSkills.length
                        ? `${oasfSkills.length} skill${oasfSkills.length !== 1 ? "s" : ""}`
                        : "",
                      oasfDomains.length
                        ? `${oasfDomains.length} domain${oasfDomains.length !== 1 ? "s" : ""}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(", ") + " → IPFS profile auto-generated"
                  }
                />
              )}
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

            {result?.error && (
              <p className="text-sm text-red-400 bg-red-950/40 px-3 py-2 rounded-lg">
                {result.error}
              </p>
            )}
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
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          {step === 0 ? "Cancel" : "← Back"}
        </button>

        {step < 3 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canAdvance()}
            className="px-6 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            Next →
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

function LabeledField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-gray-400">{label}</label>
      {children}
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

function validateJson(input: string): string | null {
  if (!input.trim()) return null;
  try {
    JSON.parse(input);
    return null;
  } catch {
    return "Invalid JSON.";
  }
}

// ── ServiceCard ───────────────────────────────────────────────────────────────

function ServiceCard({
  label,
  badge,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  badge: string;
  enabled: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border transition-colors ${
        enabled
          ? "border-violet-700 bg-violet-950/20"
          : "border-gray-800 bg-gray-900/20"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${
              enabled ? "bg-violet-700 text-white" : "bg-gray-700 text-gray-300"
            }`}
          >
            {label}
          </span>
          <span className="text-xs text-gray-400">{badge}</span>
        </div>
        <span
          className={`inline-flex h-5 w-9 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
            enabled ? "bg-violet-600" : "bg-gray-600"
          }`}
        >
          <span
            className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </span>
      </button>
      {enabled && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ── TagPicker ─────────────────────────────────────────────────────────────────

function TagPicker({
  placeholder,
  hint,
  items,
  selected,
  onChange,
}: {
  placeholder: string;
  hint: string;
  items: { key: string; label: string }[];
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, [open]);

  const filtered = search
    ? items.filter(
        (it) =>
          it.label.toLowerCase().includes(search.toLowerCase()) ||
          it.key.toLowerCase().includes(search.toLowerCase()),
      )
    : items;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-300 hover:border-gray-600 transition-colors"
      >
        <span className={selected.length ? "text-gray-100" : "text-gray-500"}>
          {selected.length === 0 ? placeholder : `${selected.length} selected`}
        </span>
        <svg
          className="w-4 h-4 text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {selected.map((key) => {
            const item = items.find((it) => it.key === key);
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-900/60 border border-violet-700 text-violet-200 text-xs"
              >
                {item?.label ?? key}
                <button
                  type="button"
                  onClick={() => onChange(selected.filter((k) => k !== key))}
                  className="text-violet-400 hover:text-white leading-none"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl flex flex-col">
          <div className="sticky top-0 bg-gray-900 p-2 border-b border-gray-800 shrink-0">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              autoFocus
              className="w-full px-2 py-1.5 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600"
            />
            <p className="text-xs text-gray-500 mt-1 px-1">{hint}</p>
          </div>
          <div className="overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-xs text-gray-500 px-3 py-4 text-center">
                No results
              </p>
            )}
            {filtered.map((item) => (
              <label
                key={item.key}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(item.key)}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...selected, item.key]);
                    else onChange(selected.filter((k) => k !== item.key));
                  }}
                  className="accent-violet-500"
                />
                <span className="text-sm text-gray-200">{item.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
