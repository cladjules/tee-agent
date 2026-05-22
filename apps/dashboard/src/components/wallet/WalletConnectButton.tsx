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
      alert("Wallet connection failed. Install MetaMask or another EIP-6963 wallet.");
    }
  }

  async function handleDisconnect() {
    await disconnect();
  }

  if (status === "connected" && address) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-700 bg-green-900/30 px-3 py-2 text-sm text-green-300">
        <span className="h-2 w-2 rounded-full bg-green-400" />
        <span className="font-mono">{formatAddress(address)}</span>
        <button
          type="button"
          onClick={handleDisconnect}
          className="rounded border border-green-700 px-2 py-1 text-xs font-semibold text-green-200 transition-colors hover:bg-green-800/50 cursor-pointer"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={status === "connecting"}
      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
    >
      {status === "connecting" ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
