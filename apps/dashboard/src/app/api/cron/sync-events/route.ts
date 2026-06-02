import { type NextRequest, NextResponse } from "next/server";
import { syncEvents } from "@/lib/agent-indexer";
import { SUPPORTED_CHAIN_IDS } from "@/lib/active-chain";

export const maxDuration = 60; // seconds (Vercel Pro max; Hobby: 10s)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Verify the request comes from Vercel Cron (or a trusted caller).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // Sync all supported chains in parallel.
    const results = await Promise.all(
      SUPPORTED_CHAIN_IDS.map(async (chainId) => {
        try {
          return { chainId, result: await syncEvents(chainId) };
        } catch (err) {
          return { chainId, error: String(err) };
        }
      }),
    );
    return NextResponse.json(results);
  } catch (err) {
    console.error("[cron] sync-events failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
