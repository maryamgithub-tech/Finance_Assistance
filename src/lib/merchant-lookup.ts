import { generateText } from "ai";
import { google } from "@ai-sdk/google";

/**
 * Identify a cryptic charge descriptor by searching the web (Gemini search
 * grounding — free on the AI Studio tier). Returns a short explanation + the
 * sources used. Reaches OUTSIDE the system, which is the agentic behaviour the
 * brief's capability #7 is testing.
 *
 * If your @ai-sdk/google version rejects `useSearchGrounding`, swap to:
 *   google("gemini-2.5-flash"), and pass
 *   providerOptions: { google: { googleSearch: {} } } to generateText.
 */
export async function lookupMerchant(merchantRaw: string) {
  try {
    const { text, sources } = await generateText({
      model: google("gemini-2.5-flash", { useSearchGrounding: true }),
      prompt: `A bank statement shows this charge descriptor: "${merchantRaw}".
In 1–2 sentences say what company/service this most likely is and what kind of
purchase it represents. If genuinely unsure, say so plainly. Be concise.`,
    });
    return {
      likely: text,
      sources: (sources ?? [])
        .map((s: { title?: string; url?: string }) => ({ title: s.title, url: s.url }))
        .slice(0, 3),
    };
  } catch (e) {
    // Degrade gracefully — the assistant will tell the user it couldn't look it up.
    return { likely: null, error: "web lookup unavailable", detail: (e as Error)?.message };
  }
}
