"use client";

import { useState } from "react";

type VerifyState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "verified" }
  | { status: "unverified"; reason: string };

type VerifyResponse = {
  status?: "verified" | "unverified";
  reason?: string;
};

export function FeedbackVerifyButton({ feedbackURI }: { feedbackURI: string }) {
  const [state, setState] = useState<VerifyState>({ status: "idle" });

  async function onVerify() {
    setState({ status: "checking" });
    try {
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feedbackURI }),
      });
      const result = (await response.json()) as VerifyResponse;

      if (!response.ok || result.status !== "verified") {
        setState({
          status: "unverified",
          reason: result.reason ?? "Verification failed.",
        });
        return;
      }

      setState({ status: "verified" });
    } catch {
      setState({ status: "unverified", reason: "Verification failed." });
    }
  }

  return (
    <div className="flex w-full items-center gap-2">
      <button
        type="button"
        onClick={onVerify}
        disabled={state.status === "checking"}
        className="w-16 rounded border border-gray-700 bg-gray-900 px-2 py-0.5 text-xs text-gray-300 hover:border-cyan-700 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state.status === "checking" ? "Checking" : "Verify"}
      </button>
      {state.status === "verified" ? (
        <span className="min-w-0 flex-1 text-xs text-cyan-300">Verified</span>
      ) : null}
      {state.status === "unverified" ? (
        <span className="min-w-0 flex-1 text-xs text-gray-500">
          {state.reason}
        </span>
      ) : null}
      {state.status === "idle" || state.status === "checking" ? (
        <span className="min-w-0 flex-1" aria-hidden="true" />
      ) : null}
    </div>
  );
}
