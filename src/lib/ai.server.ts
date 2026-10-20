import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

const RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

/** One streamed Lovable AI call, consumed server-side; returns the final text. */
export async function generatePlainText(instructions: string, prompt: string): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured.");
  let runId: string | undefined;
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (runId) headers.set(RUN_ID_HEADER, runId);
      const res = await fetch(input, { ...init, headers });
      runId ??= res.headers.get(RUN_ID_HEADER) ?? undefined;
      return res;
    },
  });
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    instructions,
    prompt,
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  return await result.text;
}

export function aiErrorMessage(err: unknown): string {
  const status = (err as { statusCode?: number; status?: number })?.statusCode ?? (err as { status?: number })?.status;
  if (status === 402) return "AI credits are used up for this workspace. Add credits to generate the plan.";
  if (status === 429) return "The AI is busy right now. Please try again in a minute.";
  if (status === 403) return "AI access is blocked for this workspace.";
  return "The AI plan could not be written right now.";
}
