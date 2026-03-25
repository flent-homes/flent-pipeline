import { GoogleAuth } from "google-auth-library";

export type LeadScoreJson = {
  score: number;
  tier: "S" | "A" | "B" | "C" | string;
  reason: string;
};

/**
 * Calls Vertex AI Gemini (generateContent) with JSON output.
 * Requires: Vertex AI API enabled + service account role "Vertex AI User".
 */
export async function scoreLeadWithVertex(
  credentialsJson: string,
  projectId: string,
  location: string,
  model: string,
  systemText: string,
  userText: string,
): Promise<LeadScoreJson> {
  const auth = new GoogleAuth({
    credentials: JSON.parse(credentialsJson) as Record<string, unknown>,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Could not get OAuth token for Vertex (check IAM roles).");

  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemText }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userText }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Vertex ${res.status}: ${raw.slice(0, 800)}`);
  }

  const data = JSON.parse(raw) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Vertex returned no text (empty candidates).");

  const parsed = JSON.parse(text) as LeadScoreJson;
  if (typeof parsed.score !== "number") {
    throw new Error("Model JSON missing numeric score.");
  }
  return parsed;
}

export function projectIdFromCredentials(credentialsJson: string): string | null {
  try {
    const j = JSON.parse(credentialsJson) as { project_id?: string };
    return j.project_id ?? null;
  } catch {
    return null;
  }
}
