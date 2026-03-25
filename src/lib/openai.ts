export type LeadScoreJson = {
  score: number;
  tier: "S" | "A" | "B" | "C" | string;
  reason: string;
};

export async function scoreLeadWithOpenAI(
  apiKey: string,
  model: string,
  systemText: string,
  userText: string,
): Promise<LeadScoreJson> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "lead_score",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              score: { type: "number" },
              tier: { type: "string" },
              reason: { type: "string" },
            },
            required: ["score", "tier", "reason"],
          },
        },
      },
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userText },
      ],
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 800)}`);
  }

  const data = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned empty content.");
  const parsed = JSON.parse(text) as LeadScoreJson;
  if (typeof parsed.score !== "number") {
    throw new Error("OpenAI JSON missing numeric score.");
  }
  return parsed;
}
