"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { OASF_SKILLS, OASF_DOMAINS } from "@/lib/oasf-data";
import { ErrorBox } from "@/components/ErrorBox";
import type { AgentService } from "@tee-agent/agent/types";

export const INPUT =
  "w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm";

export interface ServiceEditorEntry {
  name: string;
  endpoint: string;
  version?: string;
  skills?: string[];
  domains?: string[];
}

interface CustomService {
  name: string;
  endpoint: string;
  version: string;
}

const STANDARD_NAMES = new Set([
  "MCP",
  "A2A",
  "OASF",
  "web",
  "DID",
  "email",
  "teeOracle",
]);

export function ServiceEditorPanel({
  initialServices,
  onChange,
  initialX402 = false,
  onX402Change,
  hideServices = false,
  lockTeeOracle = false,
}: {
  initialServices: readonly AgentService[];
  onChange: (services: ServiceEditorEntry[]) => void;
  initialX402?: boolean;
  onX402Change?: (enabled: boolean) => void;
  hideServices?: boolean;
  lockTeeOracle?: boolean;
}) {
  const find = (name: string) => initialServices.find((s) => s.name === name);

  const [mcpEnabled, setMcpEnabled] = useState(!!find("MCP")?.endpoint);
  const [mcpUrl, setMcpUrl] = useState(find("MCP")?.endpoint ?? "");
  const [mcpVersion, setMcpVersion] = useState(find("MCP")?.version ?? "1.0");
  const [a2aEnabled, setA2aEnabled] = useState(!!find("A2A")?.endpoint);
  const [a2aUrl, setA2aUrl] = useState(find("A2A")?.endpoint ?? "");
  const [a2aVersion, setA2aVersion] = useState(find("A2A")?.version ?? "1.0");
  const [oasfEnabled, setOasfEnabled] = useState(!!find("OASF")?.endpoint);
  const [oasfUrl, setOasfUrl] = useState(find("OASF")?.endpoint ?? "");
  const [oasfVersion, setOasfVersion] = useState(
    find("OASF")?.version ?? "0.8",
  );
  const [oasfSkills, setOasfSkills] = useState<string[]>([
    ...(find("OASF")?.skills ?? []),
  ]);
  const [oasfDomains, setOasfDomains] = useState<string[]>([
    ...(find("OASF")?.domains ?? []),
  ]);
  const [webUrl, setWebUrl] = useState(find("web")?.endpoint ?? "");
  const [didEndpoint, setDidEndpoint] = useState(find("DID")?.endpoint ?? "");
  const [emailEndpoint, setEmailEndpoint] = useState(
    find("email")?.endpoint ?? "",
  );
  const [teeOracleUrl, setTeeOracleUrl] = useState(
    find("teeOracle")?.endpoint ?? "",
  );
  const [teeOracleTouched, setTeeOracleTouched] = useState(false);
  const [x402Support, setX402Support] = useState(initialX402);
  const [customServices, setCustomServices] = useState<CustomService[]>(
    initialServices
      .filter((s) => !STANDARD_NAMES.has(s.name))
      .map((s) => ({
        name: s.name,
        endpoint: s.endpoint,
        version: s.version ?? "",
      })),
  );

  // Store onChange in a ref so the effect never needs it as a dep
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const buildServices = useCallback((): ServiceEditorEntry[] => {
    const svcs: ServiceEditorEntry[] = [];
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
    if (oasfEnabled && oasfUrl.trim())
      svcs.push({
        name: "OASF",
        endpoint: oasfUrl.trim(),
        ...(oasfVersion.trim() ? { version: oasfVersion.trim() } : {}),
        ...(oasfSkills.length ? { skills: oasfSkills } : {}),
        ...(oasfDomains.length ? { domains: oasfDomains } : {}),
      });
    if (webUrl.trim()) svcs.push({ name: "web", endpoint: webUrl.trim() });
    if (didEndpoint.trim())
      svcs.push({ name: "DID", endpoint: didEndpoint.trim() });
    if (emailEndpoint.trim())
      svcs.push({ name: "email", endpoint: emailEndpoint.trim() });
    if (teeOracleUrl.trim())
      svcs.push({ name: "teeOracle", endpoint: teeOracleUrl.trim() });
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
  }, [
    mcpEnabled,
    mcpUrl,
    mcpVersion,
    a2aEnabled,
    a2aUrl,
    a2aVersion,
    oasfEnabled,
    oasfUrl,
    oasfVersion,
    oasfSkills,
    oasfDomains,
    webUrl,
    didEndpoint,
    emailEndpoint,
    teeOracleUrl,
    customServices,
  ]);

  const getError = useCallback((): string | null => {
    if (!teeOracleUrl.trim()) return "teeOracle endpoint is required.";
    if (mcpEnabled && !mcpUrl.trim())
      return "MCP is enabled but has no endpoint URL.";
    if (a2aEnabled && !a2aUrl.trim())
      return "A2A is enabled but has no endpoint URL.";
    if (oasfEnabled && !oasfUrl.trim())
      return "OASF is enabled but has no endpoint URL.";
    for (const svc of customServices) {
      if (svc.name.trim() && !svc.endpoint.trim())
        return `Custom service "${svc.name}" is missing an endpoint.`;
      if (!svc.name.trim() && svc.endpoint.trim())
        return "A custom service has an endpoint but no name.";
    }
    return null;
  }, [
    mcpEnabled,
    mcpUrl,
    a2aEnabled,
    a2aUrl,
    oasfEnabled,
    oasfUrl,
    teeOracleUrl,
    customServices,
  ]);

  useEffect(() => {
    onChangeRef.current(buildServices());
  }, [buildServices]);

  function handleX402Toggle() {
    const next = !x402Support;
    setX402Support(next);
    onX402Change?.(next);
  }

  const errorMsg = getError();
  const visibleErrorMsg =
    errorMsg === "teeOracle endpoint is required." && !teeOracleTouched
      ? null
      : errorMsg;

  return (
    <div className="space-y-3">
      {/* TEE Oracle — always visible, prominent */}
      <div className="rounded-lg border-2 border-violet-600 bg-violet-950/30 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold font-mono bg-violet-600 text-white px-1.5 py-0.5 rounded">
            teeOracle
          </span>
          <span className="text-xs text-violet-300">
            Phala Cloud / TDX TEE oracle endpoint *
          </span>
        </div>
        <input
          type="url"
          value={teeOracleUrl}
          disabled={lockTeeOracle}
          onChange={(e) => {
            setTeeOracleTouched(true);
            setTeeOracleUrl(e.target.value);
          }}
          onBlur={() => setTeeOracleTouched(true)}
          placeholder="https://your-cvm.phala.network"
          className={`${INPUT} disabled:opacity-60 disabled:cursor-not-allowed`}
        />
        {lockTeeOracle ? (
          <p className="text-xs text-amber-300/90">
            Changing this oracle requires encrypted key rotation.
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-500">
              Required for oracle runs, ERC-7857 encrypted transfers, and
              on-chain validation.
            </p>
            <PhalaOracleSetup />
          </>
        )}
      </div>

      {!hideServices && (
        <>
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
            <p className="text-xs font-medium text-gray-400 mb-3">Additional</p>
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
                Enable if your agent implements the HTTP 402 standard for paid
                services (microtransactions, per-request billing).
              </p>
            </div>
            <button
              type="button"
              onClick={handleX402Toggle}
              className={`shrink-0 inline-flex h-5 w-9 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${x402Support ? "bg-violet-600" : "bg-gray-600"}`}
              aria-label="Toggle x402 support"
            >
              <span
                className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition-transform ${x402Support ? "translate-x-4" : "translate-x-0"}`}
              />
            </button>
          </div>
        </>
      )}
      {visibleErrorMsg && <ErrorBox message={visibleErrorMsg} />}
    </div>
  );
}

function PhalaOracleSetup() {
  return (
    <details className="rounded-lg border border-violet-800/70 bg-gray-950/50">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-violet-200 hover:text-white">
        Deploy a Phala TDX oracle
      </summary>
      <div className="space-y-3 border-t border-violet-900/60 px-3 py-3">
        <div className="grid gap-2 text-xs text-gray-400 sm:grid-cols-2">
          <StepItem index="1" title="Checkout">
            Clone the repo and install dependencies.
          </StepItem>
          <StepItem index="2" title="Configure">
            Fill root `.env` for image/deploy state and `apps/oracle/.env` for
            oracle runtime secrets.
          </StepItem>
          <StepItem index="3" title="Choose Entry">
            Use `src/examples/prediction-market.ts`,
            `src/examples/web-data-oracle.ts`, or copy one under
            `apps/oracle/src`.
          </StepItem>
          <StepItem index="4" title="Deploy">
            Run the repo scripts. `oracle:deploy` prints the HTTPS oracle URL.
          </StepItem>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-gray-800 bg-black/40 p-3 text-[11px] leading-5 text-gray-300">
          <code>{`git clone https://github.com/cladjules/tee-agent.git
cd tee-agent
npm install

# fill .env and apps/oracle/.env
npm run oracle:image
npm run oracle:deploy -- src/examples/prediction-market.ts`}</code>
        </pre>
        <p className="text-xs text-gray-500">
          After deploy, paste the printed Phala HTTPS endpoint here as the
          `teeOracle` service URL.
        </p>
      </div>
    </details>
  );
}

function StepItem({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-700 text-[10px] font-bold text-white">
          {index}
        </span>
        <span className="font-medium text-gray-200">{title}</span>
      </div>
      <p>{children}</p>
    </div>
  );
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
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-left text-sm hover:border-gray-600 transition-colors"
      >
        <span className="text-gray-400 truncate text-xs">{placeholder}</span>
        <span className="shrink-0 text-xs text-gray-500">
          {selected.length > 0 ? `${selected.length} ✓` : "▼"}
        </span>
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
          <div className="p-2 border-b border-gray-800">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full px-2 py-1.5 rounded bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none text-xs"
              autoFocus
            />
          </div>
          <p className="px-3 py-1.5 text-xs text-gray-500">{hint}</p>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map((it) => {
              const checked = selected.includes(it.key);
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() =>
                    onChange(
                      checked
                        ? selected.filter((k) => k !== it.key)
                        : [...selected, it.key],
                    )
                  }
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-800 transition-colors ${
                    checked ? "text-violet-300" : "text-gray-300"
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                      checked
                        ? "bg-violet-600 border-violet-600"
                        : "border-gray-600"
                    }`}
                  >
                    {checked && (
                      <span className="text-white text-[8px] leading-none">
                        ✓
                      </span>
                    )}
                  </span>
                  {it.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
