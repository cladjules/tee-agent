import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Image from "next/image";
import WalletConnectButton from "@/components/wallet/WalletConnectButton";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import ChainSync from "@/components/ChainSync";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Tee Agent — Dashboard",
  description:
    "Deploy, browse, and manage on-chain AI agents (ERC-7857 · ERC-8004).",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.className}>
      <body className="min-h-screen bg-[#04040a] text-slate-100 antialiased">
        <WalletProvider>
          <ChainSync />
          {/* Subtle grid overlay */}
          <div className="fixed inset-0 bg-grid pointer-events-none" />
          {/* Top ambient violet glow */}
          <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-violet-700/[0.06] blur-[130px] rounded-full pointer-events-none" />
          <div className="relative flex flex-col min-h-screen">
            <Header />
            <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
              {children}
            </main>
            <Footer />
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}

function Header() {
  return (
    <header className="border-b border-violet-950/60 bg-[#04040a]/80 backdrop-blur-md sticky top-0 z-20">
      <div className="container mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-2.5">
            <Image src="/favicon.svg" alt="" width={28} height={28} priority />
            <span className="text-lg font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
              Tee Agent
            </span>
          </a>
          <span className="hidden sm:inline text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-950/60 text-violet-400 border border-violet-800/50">
            v0.1 · beta
          </span>
        </div>
        <div className="flex items-center gap-5">
          <nav className="hidden md:flex gap-6 text-sm">
            <a href="/" className="nav-link">
              Agents
            </a>
            <a href="/agents/new" className="nav-link">
              Deploy
            </a>
            <a href="/docs" className="nav-link">
              Docs
            </a>
            <a
              href="https://github.com/cladjules/tee-agent"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-link inline-flex items-center gap-1"
            >
              Repo <span className="text-[10px] text-slate-600">↗</span>
            </a>
          </nav>
          <WalletConnectButton />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-violet-950/40 py-6 mt-8">
      <div className="container mx-auto max-w-6xl px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
        <span className="font-mono">
          Tee Agent <span className="text-violet-800 mx-1">·</span> ERC-7857{" "}
          <span className="text-violet-800 mx-1">·</span> ERC-8004{" "}
          <span className="text-violet-800 mx-1">·</span> Base
        </span>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/cladjules/tee-agent"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-400 transition-colors"
          >
            GitHub ↗
          </a>
          <a
            href="https://base.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-400 transition-colors"
          >
            Base
          </a>
          <a
            href="https://phala.network"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-400 transition-colors"
          >
            Phala
          </a>
        </div>
      </div>
    </footer>
  );
}
