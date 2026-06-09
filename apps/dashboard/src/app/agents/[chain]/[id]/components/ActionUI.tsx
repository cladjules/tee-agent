"use client";

import { useState, useTransition } from "react";
import { ErrorBox } from "@/components/ErrorBox";

export type ActionResult = {
  txHash?: string;
  tokenId?: bigint;
  error?: string;
};

export function useActionState() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function run(fn: () => Promise<ActionResult>) {
    setResult(null);
    startTransition(async () => setResult(await fn()));
  }

  return { isPending, result, run };
}

export function ResultBanner({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  if (result.error) return <ErrorBox message={result.error} />;
  return (
    <p className="text-xs text-green-400 bg-green-950/40 px-3 py-2 rounded-lg">
      {result.tokenId !== undefined
        ? `Token ID: #${result.tokenId.toString()}`
        : result.txHash
          ? `Tx: ${result.txHash}`
          : "Success"}
    </p>
  );
}

export function BackgroundActionModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-800 bg-gray-950 p-4 shadow-2xl">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-100">
            Transaction submitted
          </h3>
          <p className="text-xs leading-5 text-gray-400">
            The transaction will be executed and validated in the background.
            Refresh the page in a few seconds to see your transaction.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export function SubmitButton({
  isPending,
  label,
  disabled,
}: {
  isPending: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={isPending || !!disabled}
      className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
    >
      {isPending ? "Submitting..." : label}
    </button>
  );
}
