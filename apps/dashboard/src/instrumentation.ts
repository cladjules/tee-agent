// In development: poll the cron endpoint every 30s via HTTP (avoids bundling
// server-only modules like node:crypto into the instrumentation compilation).
// In production: Vercel Cron fires /api/cron/sync-events on its own schedule.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "development") return;

  const INTERVAL_MS = 30_000;
  const port = process.env.PORT?.trim();
  if (!port) throw new Error("PORT is required.");
  const url = `http://localhost:${port}/api/cron/sync-events`;

  const run = async () => {
    try {
      const res = await fetch(url);
      const data = await res.json();
      console.log("[dev-cron] sync-events:", data);
    } catch (err) {
      console.error("[dev-cron] sync-events failed:", err);
    }
  };

  // Delay first run so the server is ready.
  setTimeout(() => {
    run();
    setInterval(run, INTERVAL_MS);
  }, 5_000);
}
