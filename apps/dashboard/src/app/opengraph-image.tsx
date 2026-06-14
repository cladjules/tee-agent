import { ImageResponse } from "next/og";

export const alt =
  "Tee Agent dashboard for ERC-8004 agents secured by Phala TDX on Arbitrum.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background:
          "radial-gradient(circle at 18% 18%, rgba(34,211,238,0.22), transparent 30%), radial-gradient(circle at 82% 22%, rgba(139,92,246,0.28), transparent 34%), linear-gradient(135deg, #04040a 0%, #111827 52%, #07111f 100%)",
        color: "#e5e7eb",
        padding: 72,
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 30,
            fontWeight: 700,
          }}
        >
          <img
            src="https://www.teeagent.xyz/favicon.png"
            alt="Tee Agent"
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              boxShadow: "0 0 36px rgba(34,211,238,0.28)",
            }}
          />
          Tee Agent
        </div>
        <div
          style={{
            border: "1px solid rgba(148,163,184,0.28)",
            borderRadius: 999,
            padding: "10px 18px",
            color: "#a5b4fc",
            fontSize: 22,
            fontWeight: 600,
          }}
        >
          Arbitrum Sepolia
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <h1
          style={{
            margin: 0,
            maxWidth: 900,
            fontSize: 78,
            lineHeight: 0.95,
            letterSpacing: 0,
            fontWeight: 800,
          }}
        >
          Sovereign AI agents with private skills
        </h1>
        <p
          style={{
            margin: 0,
            maxWidth: 860,
            color: "#94a3b8",
            fontSize: 30,
            lineHeight: 1.32,
          }}
        >
          Mint ERC-8004 agents, run encrypted ERC-7857 data inside Phala TDX,
          and verify reputation with on-chain DCAP proofs.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: 14,
          color: "#c4b5fd",
          fontSize: 24,
          fontWeight: 700,
        }}
      >
        <span>ERC-8004</span>
        <span style={{ color: "#334155" }}>/</span>
        <span>ERC-7857</span>
        <span style={{ color: "#334155" }}>/</span>
        <span>Phala TDX</span>
        <span style={{ color: "#334155" }}>/</span>
        <span>Automata DCAP</span>
      </div>
    </div>,
    size,
  );
}
