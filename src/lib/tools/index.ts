import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as q from "@/lib/db/queries";
import { lookupMerchant } from "@/lib/merchant-lookup";

/**
 * TOOL LAYER — the model's only way to touch data. Built per request with the
 * authenticated supabase client + userId. The model reads intent and calls
 * these; it never sees raw rows. Recurring/anomaly tools just READ tables that
 * were pre-computed deterministically in Postgres (db/insights.sql).
 */
export function buildTools(supabase: SupabaseClient, userId: string) {
  return {
    querySpending: tool({
      description:
        "Sum how much the user SPENT, optionally by category or merchant, within a date range. For 'how much did I spend on X'.",
      inputSchema: z.object({
        category: z.string().optional().describe("e.g. Groceries, Dining, Fuel, Utilities, Housing"),
        merchant: z.string().optional(),
        start_date: z.string().describe("YYYY-MM-DD"),
        end_date: z.string().describe("YYYY-MM-DD"),
      }),
      execute: (args) => q.querySpending(supabase, userId, args),
    }),

    topTransactions: tool({
      description: "Largest or smallest individual spends in a date range. For 'my biggest purchase in March'.",
      inputSchema: z.object({
        start_date: z.string(),
        end_date: z.string(),
        order: z.enum(["largest", "smallest"]).default("largest"),
        limit: z.number().int().min(1).max(20).default(5),
      }),
      execute: (args) => q.topTransactions(supabase, userId, args),
    }),

    comparePeriods: tool({
      description:
        "Compare the user's latest month of spending to their trailing 3-month average. For 'am I spending more than usual'. Optional category.",
      inputSchema: z.object({ category: z.string().optional() }),
      execute: (args) => q.comparePeriods(supabase, userId, args),
    }),

    listRecurring: tool({
      description: "List the user's recurring subscriptions/fixed charges (pre-detected). For 'what subscriptions am I paying for'.",
      inputSchema: z.object({}),
      execute: () => q.listRecurring(supabase, userId),
    }),

    listAnomalies: tool({
      description: "List transactions flagged as unusually large for this user (pre-detected). For 'any weird charges'.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
      execute: (args) => q.listAnomalies(supabase, userId, args),
    }),

    getBudgetStatus: tool({
      description: "Get spend-vs-limit for the user's budgets this month, flagging any near (>=80%) or over (>=100%).",
      inputSchema: z.object({ category: z.string().optional() }),
      execute: (args) => q.getBudgetStatus(supabase, userId, args),
    }),

    setBudget: tool({
      description: "Create or update a monthly budget limit for a category. For 'set a 20000 budget for dining'.",
      inputSchema: z.object({
        category: z.string(),
        limit_amount: z.number().positive(),
      }),
      execute: (args) => q.setBudget(supabase, userId, args),
    }),

    rememberFact: tool({
      description:
        "Persist a durable user preference as a structured rule. Use when the user states a lasting fact, e.g. 'I get paid on the 1st' or 'don't count rent in my food budget'.",
      inputSchema: z.object({
        fact_type: z.enum(["payday", "exclude_category_from_budget", "note"]),
        payload: z.record(z.string(), z.any()).describe('e.g. {"day":1} or {"exclude":"Housing","from":"Groceries"}'),
        raw_text: z.string().describe("the user's original sentence"),
      }),
      execute: (args) => q.rememberFact(supabase, userId, args),
    }),

    lookupMerchant: tool({
      description:
        "Identify an unfamiliar merchant or charge by searching the web. Use when the user doesn't recognize a charge or asks 'what is this'. Returns a likely explanation with sources.",
      inputSchema: z.object({
        merchant_raw: z.string().describe("the charge descriptor or merchant name the user is unsure about"),
      }),
      execute: ({ merchant_raw }) => lookupMerchant(merchant_raw),
    }),
  };
}
