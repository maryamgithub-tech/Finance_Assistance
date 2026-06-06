import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { MODELS } from "@/lib/router";

/**
 * Receipt photo -> structured fields. The model self-reports a CONFIDENCE; on a
 * blurry/rotated/cut-off/foreign receipt it should return a low score, which the
 * route uses to hold the parse for user confirmation rather than silently
 * inserting a wrong expense (brief: "expect the unexpected").
 */
export const ReceiptSchema = z.object({
  merchant: z.string().describe("store/merchant name; empty string if unreadable"),
  total: z.number().describe("grand total paid; 0 if unreadable"),
  txn_date: z.string().describe("YYYY-MM-DD; empty string if unreadable"),
  currency: z.string().default("PKR"),
  category: z.string().describe("best-guess category, e.g. Groceries, Dining, Fuel"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("0–1. Be LOW (<0.5) if the image is blurry, rotated, cut off, or in another language."),
  notes: z.string().optional().describe("any problem detected: blurry, rotated, partial, language"),
});

export type ReceiptData = z.infer<typeof ReceiptSchema>;

export async function extractReceipt(imageBytes: Uint8Array): Promise<ReceiptData> {
  const { object } = await generateObject({
    model: google(MODELS.vision),
    schema: ReceiptSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract the receipt fields. If the image is unclear (blurry, rotated, cut off, or not in English) and you are not sure, set a LOW confidence and describe the issue in notes. Use YYYY-MM-DD for the date.",
          },
          { type: "image", image: imageBytes },
        ],
      },
    ],
  });
  return object;
}
