import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv, sheetsConfigured } from "@/lib/env";
import { resolveServiceAccountJson } from "@/lib/google-credentials";
import {
  batchUpdateCells,
  fetchSheetValues,
  rowsToDealRecords,
} from "@/lib/sheets";
import {
  projectIdFromCredentials,
  scoreLeadWithVertex,
} from "@/lib/vertex";
import { scoreLeadWithOpenAI } from "@/lib/openai";
import { scoreLeadWithGemini } from "@/lib/gemini";

const bodySchema = z.object({
  sheetRow: z.number().int().min(2),
  /** If true, writes AI_Score, AI_Tier, AI_Reason when those columns exist */
  applyToSheet: z.boolean().optional(),
});

const SYSTEM = `You are scoring landlord supply leads for Flent (property management for NRI landlords in India).
Return ONLY valid JSON with keys: score (number 0-100), tier (string: S, A, B, or C), reason (one short paragraph).
Favor: realistic rent vs cluster, good configuration, clear POC, active pipeline stage, not disqualified.
Penalize: broker gated, unserviceable, rent too high vs market, missing POC, terminal negative outcomes in Disqualified.`;

export async function POST(request: Request) {
  const env = getServerEnv();
  const credentials = resolveServiceAccountJson(env);
  if (!sheetsConfigured(env) || !credentials) {
    return NextResponse.json(
      { error: "missing_config", message: "Sheets credentials required." },
      { status: 503 },
    );
  }

  const projectId =
    env.GOOGLE_CLOUD_PROJECT?.trim() ||
    projectIdFromCredentials(credentials);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { sheetRow, applyToSheet } = parsed.data;

  try {
    const rows = await fetchSheetValues(
      env.GOOGLE_SPREADSHEET_ID!,
      env.GOOGLE_SHEET_RANGE,
      credentials,
    );
    const { columns, deals } = rowsToDealRecords(rows);
    const deal = deals.find((d) => d._sheetRow === sheetRow);
    if (!deal) {
      return NextResponse.json(
        { error: "row_not_found", message: `No data row for sheet row ${sheetRow}.` },
        { status: 404 },
      );
    }

    const { _sheetRow, ...rest } = deal;
    const userText = `Score this lead. Data (JSON):\n${JSON.stringify(rest, null, 2)}`;

    let result;
    let provider: "openai" | "gemini" | "vertex" = "vertex";
    if (env.OPENAI_API_KEY?.trim()) {
      provider = "openai";
      result = await scoreLeadWithOpenAI(
        env.OPENAI_API_KEY,
        env.OPENAI_MODEL,
        SYSTEM,
        userText,
      );
    } else if (env.GEMINI_API_KEY?.trim()) {
      provider = "gemini";
      result = await scoreLeadWithGemini(
        env.GEMINI_API_KEY,
        env.GEMINI_MODEL_NAME,
        SYSTEM,
        userText,
      );
    } else {
      if (!projectId) {
        return NextResponse.json(
          {
            error: "missing_project",
            message:
              "Set OPENAI_API_KEY or GEMINI_API_KEY for key-based scoring, or GOOGLE_CLOUD_PROJECT for Vertex.",
          },
          { status: 503 },
        );
      }
      result = await scoreLeadWithVertex(
        credentials,
        projectId,
        env.VERTEX_LOCATION,
        env.VERTEX_GEMINI_MODEL,
        SYSTEM,
        userText,
      );
    }

    if (applyToSheet) {
      const keys = columns.map((c) => c.key);
      const updates: Record<string, string> = {};
      if (keys.includes("AI_Score")) updates.AI_Score = String(result.score);
      if (keys.includes("AI_Tier")) updates.AI_Tier = String(result.tier);
      if (keys.includes("AI_Reason")) updates.AI_Reason = result.reason;
      if (keys.includes("AI_Run_At")) {
        updates.AI_Run_At = new Date().toISOString();
      }

      if (Object.keys(updates).length > 0) {
        await batchUpdateCells(
          env.GOOGLE_SPREADSHEET_ID!,
          env.GOOGLE_SHEET_RANGE,
          sheetRow,
          updates,
          columns.map((c) => c.key),
          credentials,
        );
      }
    }

    return NextResponse.json({
      sheetRow: _sheetRow,
      provider,
      score: result.score,
      tier: result.tier,
      reason: result.reason,
      appliedToSheet: Boolean(applyToSheet),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "ai_scoring_failed", message },
      { status: 502 },
    );
  }
}
