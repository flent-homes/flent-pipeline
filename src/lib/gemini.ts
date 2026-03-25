export type LeadScoreJson = {
  score: number;
  tier: "S" | "A" | "B" | "C" | string;
  reason: string;
};

/** Calls Gemini Developer API (AI Studio key auth). */
export async function scoreLeadWithGemini(
  apiKey: string,
  modelName: string,
  systemText: string,
  userText: string,
): Promise<LeadScoreJson> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelName,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemText }],
      },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${raw.slice(0, 800)}`);
  }

  const data = JSON.parse(raw) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text.");
  const parsed = JSON.parse(text) as LeadScoreJson;
  if (typeof parsed.score !== "number") {
    throw new Error("Gemini JSON missing numeric score.");
  }
  return parsed;
}
