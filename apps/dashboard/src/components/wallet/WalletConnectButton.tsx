"use client";

import { useWallet } from "@/components/wallet/WalletProvider";

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function WalletConnectButton() {
  const { address, connect, disconnect, status } = useWallet();

  async function handleConnect() {
    try {
      await connect();
    } catch {
      alert(
        "Wallet connection failed. Install MetaMask or another EIP-6963 wallet.",
      );
    }
  }

  async function handleDisconnect() {
    await disconnect();
  }

  if (status === "connected" && address) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-800/50 bg-emerald-950/30 px-3 py-1.5 text-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
        <span className="font-mono text-xs text-emerald-400">
          {formatAddress(address)}
        </span>
        <button
          type="button"
          onClick={handleDisconnect}
          className="rounded-md border border-emerald-800/50 px-2 py-0.5 text-xs font-medium text-emerald-500 transition-colors hover:bg-emerald-900/40 hover:text-emerald-300 cursor-pointer"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={status === "connecting"}
      className="btn-primary rounded-lg px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
    >
      {status === "connecting" ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
