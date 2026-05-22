import type { Metadata } from "next";
import { Inter } from "next/font/google";
import WalletConnectButton from "@/components/wallet/WalletConnectButton";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Open Agents Toolkit — Dashboard",
  description:
    "Deploy, browse, and manage on-chain AI agents (ERC-7857 · ERC-8004).",
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.className}>
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        <WalletProvider>
          <div className="flex flex-col min-h-screen">
            <Header />
            <main className="flex-1 container mx-auto px-4 py-8">
              {children}
            </main>
            <footer className="border-t border-gray-800 py-4 text-center text-sm text-gray-500">
              Open Agents Toolkit &mdash; Web3-Aware AI Agent SDK
            </footer>
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}

function Header() {
  return (
    <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-4 px-4 py-4">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="text-xl font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent"
          >
            Open Agents Toolkit
          </a>
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-900 text-violet-300 border border-violet-700">
            v0.1
          </span>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex gap-6 text-sm text-gray-400">
            <a href="/" className="hover:text-white transition-colors">
              Agents
            </a>
            <a
              href="/agents/new"
              className="hover:text-white transition-colors"
            >
              Create
            </a>
            <a
              href="https://github.com/cladjules/open-agents-toolkit"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              GitHub
            </a>
          </nav>
          <WalletConnectButton />
        </div>
      </div>
    </header>
  );
}
