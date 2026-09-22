import Anthropic from "@anthropic-ai/sdk";
import { assetUrl } from "@/lib/data-source";
import { apiError } from "@/server/db";
import { findBlock } from "@/server/blocks";
import { BRIEF_SYSTEM, briefUserText, isBriefTarget, templateBrief } from "@/server/brief";
import type { Block } from "@/contracts/block";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Opus for the brief (docs/PLAN.md section 6); BRIEF_MODEL overrides it.
const MODEL = process.env.BRIEF_MODEL || "claude-opus-5";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * The screenshot as base64, fetched by the server so it also works when the
 * image lives on localhost or a private bucket. Skipped (text-only brief) when
 * it is missing, over the API's 5 MB limit, or taller than the 8000 px maximum.
 */
async function screenshot(block: Block, origin: string): Promise<Anthropic.Beta.BetaImageBlockParam | null> {
  if (!block.src) return null;
  const scale = block.viewport === "mobile" ? 2 : 1;
  if (block.h * scale > 7900 || block.w * scale > 7900) return null;
  try {
    const res = await fetch(new URL(assetUrl(block.src), origin), { signal: AbortSignal.timeout(10_000) });
    const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!res.ok || !IMAGE_TYPES.has(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) return null;
    return { type: "image", source: { type: "base64", media_type: type as "image/jpeg", data: bytes.toString("base64") } };
  } catch {
    return null;
  }
}

const text = (body: string, source: "claude" | "template") =>
  new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "x-brief-source": source, "cache-control": "no-store" } });

/** POST /api/brief · BriefRequest in, the brief out as streamed text/plain (Markdown). */
export async function POST(request: Request) {
  try {
    const { blockId, target } = (await request.json().catch(() => ({}))) as { blockId?: unknown; target?: unknown };
    if (typeof blockId !== "string" || !isBriefTarget(target)) {
      return Response.json({ error: "Send { blockId, target } with target claude-code, cursor or designer", code: "INVALID" }, { status: 400 });
    }
    const origin = new URL(request.url).origin;
    const block = await findBlock(blockId, origin);
    if (!block) return Response.json({ error: "Block not found", code: "NOT_FOUND" }, { status: 404 });
    if (!process.env.ANTHROPIC_API_KEY) return text(templateBrief(block, target), "template");

    const image = await screenshot(block, origin);
    const client = new Anthropic();
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      // A brief is careful writing, not deep reasoning: medium effort keeps the wait short.
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // On a policy decline, re-run on Anthropic's recommended fallback model instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: BRIEF_SYSTEM,
      messages: [{ role: "user", content: [...(image ? [image] : []), { type: "text", text: briefUserText(block, target) }] }],
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") controller.enqueue(encoder.encode(event.delta.text));
          }
          const final = await stream.finalMessage();
          if (final.stop_reason === "refusal") controller.enqueue(encoder.encode("\n\n_Claude declined to write a brief for this block._"));
          if (final.stop_reason === "max_tokens") controller.enqueue(encoder.encode("\n\n_The brief was cut off at its length limit._"));
        } catch (error) {
          console.error(error);
          const reason = error instanceof Anthropic.RateLimitError ? "Too many briefs at once. Try again in a minute." : "The brief could not be finished. Try again.";
          controller.enqueue(encoder.encode(`\n\n_${reason}_`));
        } finally {
          controller.close();
        }
      },
      cancel() {
        stream.abort();
      },
    });
    return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "x-brief-source": "claude", "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
