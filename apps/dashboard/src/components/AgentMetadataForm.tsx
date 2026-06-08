"use client";

import type { ReactNode } from "react";

export const AGENT_TYPES = [
  "assistant",
  "researcher",
  "coder",
  "analyst",
  "creative",
  "other",
] as const;

const INPUT =
  "w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm";
const IMAGE_RANDOM_BUTTON =
  "h-10 shrink-0 rounded-lg border border-gray-700 bg-gray-800 px-3 text-xs font-medium text-gray-200 transition-colors hover:border-violet-600 hover:text-white focus:outline-none focus:border-violet-600";

const RANDOM_IMAGE_BASE_URL = "https://api.dicebear.com/9.x/bottts-neutral/svg";

export type AgentMetadataFormValue = {
  name: string;
  description: string;
  imageUrl: string;
  agentType: string;
};

export function AgentMetadataForm({
  value,
  onChange,
  requireName = true,
  requireDescription = true,
  showType = true,
}: {
  value: AgentMetadataFormValue;
  onChange: (value: AgentMetadataFormValue) => void;
  requireName?: boolean;
  requireDescription?: boolean;
  showType?: boolean;
}) {
  function update<K extends keyof AgentMetadataFormValue>(
    key: K,
    next: AgentMetadataFormValue[K],
  ) {
    onChange({ ...value, [key]: next });
  }

  function setRandomImage() {
    const seed =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const params = new URLSearchParams({
      seed,
      radius: "12",
      backgroundColor: "0f172a,111827,18181b",
    });

    update("imageUrl", `${RANDOM_IMAGE_BASE_URL}?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <LabeledField label={`Name${requireName ? " *" : ""}`}>
        <input
          type="text"
          value={value.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="My Research Agent"
          required={requireName}
          className={INPUT}
        />
      </LabeledField>

      <LabeledField label={`Description${requireDescription ? " *" : ""}`}>
        <textarea
          value={value.description}
          onChange={(e) => update("description", e.target.value)}
          rows={3}
          placeholder="What does this agent do?"
          required={requireDescription}
          className={`${INPUT} resize-y`}
        />
      </LabeledField>

      <div className={showType ? "grid grid-cols-2 gap-4" : ""}>
        <LabeledField label="Image URL">
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="url"
                value={value.imageUrl}
                onChange={(e) => update("imageUrl", e.target.value)}
                placeholder="https://..."
                className={`${INPUT} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={setRandomImage}
                title="Generate random image"
                aria-label="Generate random image"
                className={IMAGE_RANDOM_BUTTON}
              >
                Random
              </button>
            </div>

            {value.imageUrl && (
              <div className="h-28 w-28 overflow-hidden rounded-lg border border-gray-700 bg-gray-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={value.imageUrl}
                  alt={value.name ? `${value.name} preview` : "Agent preview"}
                  className="h-full w-full object-cover"
                />
              </div>
            )}
          </div>
        </LabeledField>

        {showType && (
          <LabeledField label="Type">
            <select
              value={value.agentType}
              onChange={(e) => update("agentType", e.target.value)}
              className={INPUT}
            >
              {AGENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </LabeledField>
        )}
      </div>
    </div>
  );
}

function LabeledField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-gray-400">{label}</label>
      {children}
    </div>
  );
}
