import { createTeeAgentMcpServer } from "@tee-agent/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers":
    "authorization,content-type,mcp-protocol-version,mcp-session-id,x-api-key",
  "access-control-expose-headers": "mcp-protocol-version,mcp-session-id",
};

function jsonResponse(body: Record<string, unknown>, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: { ...corsHeaders, ...(init?.headers ?? {}) },
  });
}

function mcpError(message: string, status = 500) {
  return jsonResponse(
    {
      jsonrpc: "2.0",
      error: { code: -32603, message },
      id: null,
    },
    { status },
  );
}

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization")?.trim() ?? "";
  const prefix = "Bearer ";
  return authorization.startsWith(prefix)
    ? authorization.slice(prefix.length).trim()
    : null;
}

function isAuthorized(req: Request): boolean {
  const expected = process.env.MCP_API_KEY?.trim();
  if (!expected) return true;
  return (
    req.headers.get("x-api-key") === expected || bearerToken(req) === expected
  );
}

export async function GET() {
  return jsonResponse({
    ok: true,
    server: "tee-agent-mcp",
    transport: "streamable-http",
    endpoint: "/api/mcp",
    authRequired: Boolean(process.env.MCP_API_KEY?.trim()),
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return mcpError("Unauthorized.", 401);
  }

  const server = createTeeAgentMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(req);
    const headers = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal MCP server error.";
    return mcpError(message);
  } finally {
    await transport.close();
    await server.close();
  }
}
