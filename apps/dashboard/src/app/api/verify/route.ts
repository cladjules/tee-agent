import { NextResponse } from "next/server";
import {
  decodeFeedbackURI,
  getFeedbackPayloadChainId,
  verifyFeedbackURI,
} from "@tee-agent/agent/ops/feedback";
import { getReadConfigForChain } from "@/lib/config";

export const dynamic = "force-dynamic";

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    { verified: false, status: "unverified", reason: message },
    { status },
  );
}

export async function POST(req: Request) {
  let body: { feedbackURI?: string };
  try {
    body = (await req.json()) as { feedbackURI?: string };
  } catch {
    return errorResponse("Invalid JSON.");
  }

  const feedbackURI = body.feedbackURI?.trim() ?? "";
  if (!feedbackURI) {
    return errorResponse("feedbackURI is required.");
  }

  const decoded = decodeFeedbackURI(feedbackURI);
  if (!decoded) {
    return errorResponse("Invalid feedbackURI.");
  }
  const chainId = getFeedbackPayloadChainId(decoded.payload);
  if (!chainId) {
    return errorResponse("feedbackURI is missing agentRegistry.");
  }

  const result = await verifyFeedbackURI(
    getReadConfigForChain(chainId),
    decoded,
  );

  return NextResponse.json({
    verified: result.status === "verified",
    ...result,
  });
}
