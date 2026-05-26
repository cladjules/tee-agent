import type { Metadata } from "next";
import { Inter } from "next/font/google";
import WalletConnectButton from "@/components/wallet/WalletConnectButton";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Arcane Agents — Dashboard",
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
      <body className="min-h-screen bg-[#04040a] text-slate-100 antialiased">
        <WalletProvider>
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

function HexLogo() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 26 26"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polygon
        points="13,1 24,7 24,19 13,25 2,19 2,7"
        fill="none"
        stroke="url(#hg)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <polygon
        points="13,7 19,10.5 19,17.5 13,21 7,17.5 7,10.5"
        fill="url(#hgf)"
        opacity="0.18"
      />
      <circle cx="13" cy="13" r="2.5" fill="url(#hg)" />
      <defs>
        <linearGradient
          id="hg"
          x1="2"
          y1="1"
          x2="24"
          y2="25"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#a78bfa" />
          <stop offset="1" stopColor="#67e8f9" />
        </linearGradient>
        <linearGradient
          id="hgf"
          x1="7"
          y1="7"
          x2="19"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#a78bfa" />
          <stop offset="1" stopColor="#67e8f9" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Header() {
  return (
    <header className="border-b border-violet-950/60 bg-[#04040a]/80 backdrop-blur-md sticky top-0 z-20">
      <div className="container mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-2.5">
            <HexLogo />
            <span className="text-lg font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
              Arcane Agents
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
            <a
              href="https://github.com/cladjules/arcane-agents"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-link inline-flex items-center gap-1"
            >
              Docs <span className="text-[10px] text-slate-600">↗</span>
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
          Arcane Agents <span className="text-violet-800 mx-1">·</span> ERC-7857{" "}
          <span className="text-violet-800 mx-1">·</span> ERC-8004{" "}
          <span className="text-violet-800 mx-1">·</span> Base
        </span>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/cladjules/arcane-agents"
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
