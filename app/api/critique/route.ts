import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z, ZodError } from "zod";

export const runtime = "nodejs";

const CritiqueRequestSchema = z.object({
  id: z.string().min(1),
  prd: z.string().min(1),
  buggy_solution_code: z.string().min(1),
  failure_info: z.any().optional(),
  label: z.string().optional(),
  qwq_critique: z.string().optional(),
  meta: z.any().optional(),
});

// ---- Hard limits (tune as needed)
const MAX_PRD_CHARS = 20_000;
const MAX_CODE_CHARS = 20_000;
const MAX_FAILUREINFO_CHARS = 12_000; // serialized
const MAX_PROMPT_CHARS = 60_000;

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n\n...[TRUNCATED ${s.length - max} chars]`;
}

function safeStringifyFailureInfo(x: unknown) {
  try {
    const raw = JSON.stringify(x ?? null, null, 2);
    return truncate(raw, MAX_FAILUREINFO_CHARS);
  } catch {
    return "null";
  }
}

function buildPrompt(input: z.infer<typeof CritiqueRequestSchema>) {
  const prd = truncate(input.prd, MAX_PRD_CHARS);
  const code = truncate(input.buggy_solution_code, MAX_CODE_CHARS);
  const failureInfo = safeStringifyFailureInfo(input.failure_info);
  const label = input.label ?? "null";

  const prompt = [
    "You are a meticulous Quality Assurance Engineer for the OpenCodeReasoning (OCR) Challenge.",
    "",
    "You will be given:",
    "- PRD: the exact problem statement + constraints",
    "- BUGGY_CODE: a Python solution that fails",
    "- FAILURE_INFO: failing tests / trace / error details (may be partial)",
    "- LABEL/JUDGEMENT: may be present as a hint about expected behavior",
    "",
    "OUTPUT FORMAT CONTRACT (STRICT):",
    "- Your output MUST contain exactly THREE sections, in this exact order.",
    "- The FIRST line of each section MUST be EXACTLY one of these header lines (match characters exactly):",
    "Detailed Diagnosis",
    "[Proposed Fix]",
    "<Test_Validation>",
    "- Do NOT add any other headers or lines that look like headers.",
    "- Do NOT add numbering, bullets, colons, markdown prefixes (e.g. ###), or extra characters on the header lines.",
    "- Do NOT output anything before 'Detailed Diagnosis' and do NOT output anything after the <Test_Validation> section.",
    "",
    "CORRECTNESS REQUIREMENTS:",
    "- Detailed Diagnosis: identify faulty line(s), root cause, and how it violates the PRD.",
    "- [Proposed Fix]: provide a complete, self-contained Python script that solves the PRD.",
    "  - Keep the original structure where possible; change only what is necessary to satisfy the PRD.",
    "  - Do NOT introduce unrelated algorithms or features.",
    "- <Test_Validation>: include at least 3 NEW assert statements (plain 'assert', no test frameworks).",
    "  - Include at least 1 counter-factual assert that fails on the buggy code but passes on your fix (use FAILURE_INFO when possible).",
    "  - Include at least 2 additional edge/boundary asserts implied by the PRD.",
    "- The asserts MUST be consistent with the behavior of your fixed code.",
    "- Do NOT use external internet, files, or non-standard libraries.",
    "- Keep it formal, precise, and technical. No filler.",
    "",
    "INPUTS:",
    "",
    "=== PRD ===",
    prd.trim(),
    "",
    "=== BUGGY_CODE ===",
    code.trim(),
    "",
    "=== FAILURE_INFO (json) ===",
    failureInfo,
    "",
    "=== LABEL/JUDGEMENT (optional) ===",
    label,
    "",
    "Return ONLY the three required sections, in order, with the exact header lines.",
  ].join("\n");

  return truncate(prompt, MAX_PROMPT_CHARS);
}

function jsonNoStore(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    // Content-Type guard (prevents weird body parsing issues)
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return jsonNoStore(
        { ok: false, request_id: requestId, error: "Content-Type must be application/json" },
        415
      );
    }

    const hfToken = process.env.HF_TOKEN;
    if (!hfToken) {
      // server misconfig -> 500
      return jsonNoStore(
        { ok: false, request_id: requestId, error: "Server misconfigured: HF_TOKEN missing" },
        500
      );
    }

    const body = await req.json();
    const input = CritiqueRequestSchema.parse(body);

    const client = new OpenAI({
      apiKey: hfToken,
      baseURL: "https://router.huggingface.co/v1",
      maxRetries: 2,
    });

    const model = process.env.HF_MODEL || "Qwen/Qwen2.5-Coder-7B-Instruct";

    // Hard timeout to protect Vercel (tune)
    const controller = new AbortController();
    const timeoutMs = Number(process.env.CRITIQUE_TIMEOUT_MS || 45_000);
    const t = setTimeout(() => controller.abort(), timeoutMs);

    let text = "";
    try {
      const completion = await client.chat.completions.create(
        {
          model,
          temperature: 0.2,
          max_tokens: 1400, // cap output for stability
          messages: [
            {
              role: "system",
              content: "You are a QA Engineer. Follow the required OCR output structure exactly.",
            },
            { role: "user", content: buildPrompt(input) },
          ],
        },
        { signal: controller.signal } as any // OpenAI SDK forwards fetch options
      );

      text = completion.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(t);
    }

    const hasAllHeaders =
      text.includes("Detailed Diagnosis") &&
      text.includes("[Proposed Fix]") &&
      text.includes("<Test_Validation>");

    return jsonNoStore({
      ok: true,
      request_id: requestId,
      id: input.id,
      model,
      hasAllHeaders,
      text,
    });
  } catch (err: any) {
    // Zod -> 400, everything else -> 500
    if (err instanceof ZodError) {
      return jsonNoStore(
        { ok: false, request_id: requestId, error: "Invalid request body", details: err.issues },
        400
      );
    }

    // Abort/timeout -> 504 (or map to your runtime_status if you prefer)
    if (err?.name === "AbortError") {
      return jsonNoStore(
        { ok: false, request_id: requestId, error: "Upstream model request timed out" },
        504
      );
    }

    // Generic server error
    return jsonNoStore(
      { ok: false, request_id: requestId, error: "Server error" },
      500
    );
  }
}

