import { google } from "@ai-sdk/google";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { createClient } from "@/utils/supabase/server";
import { buildTools } from "@/lib/tools";
import { routeMessage } from "@/lib/router";
import { buildSystemPrompt } from "@/lib/prompts";
import { getUserFacts } from "@/lib/db/queries";

export const runtime = "nodejs";
export const maxDuration = 30;

// Pull the latest user text so the router can classify cheap vs agentic.
function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return last.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ");
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { messages }: { messages: UIMessage[] } = await req.json();

  // ROUTE: choose model + effort for this turn (cost/speed control).
  const route = routeMessage(lastUserText(messages));

  // Durable memory: applied on every turn so preferences persist.
  const facts = await getUserFacts(supabase, user.id);

  const result = streamText({
    model: google(route.model),
    system: buildSystemPrompt(new Date().toISOString().slice(0, 10), facts),
    messages: await convertToModelMessages(messages),
    tools: buildTools(supabase, user.id),
    // Cheap path: tool call + answer. Agentic: room for multi-step reasoning.
    stopWhen: stepCountIs(route.path === "agentic" ? 8 : 3),
    // Cost instrumentation — feeds the README's cost/latency table.
    onFinish: ({ usage }) => {
      console.log("[chat]", { path: route.path, model: route.model, usage });
    },
  });

  return result.toUIMessageStreamResponse();
}
