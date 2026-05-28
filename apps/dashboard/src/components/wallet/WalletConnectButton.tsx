"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function WalletConnectButton() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!ready) return null;

        if (!connected) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
            >
              Connect Wallet
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              type="button"
              onClick={openChainModal}
              className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors"
            >
              Wrong network
            </button>
          );
        }

        return (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openChainModal}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800/60 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-700/60 transition-colors"
            >
              {chain.hasIcon && chain.iconUrl && (
                <img
                  src={chain.iconUrl}
                  alt={chain.name}
                  className="w-3.5 h-3.5 rounded-full"
                />
              )}
              {chain.name}
            </button>
            <button
              type="button"
              onClick={openAccountModal}
              className="flex items-center gap-2 rounded-lg border border-emerald-800/50 bg-emerald-950/30 px-3 py-1.5 text-sm hover:bg-emerald-900/30 transition-colors"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span className="font-mono text-xs text-emerald-400">
                {formatAddress(account.address)}
              </span>
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
