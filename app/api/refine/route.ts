import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

const MODEL = "gemini-2.5-flash";

type RefinePayload = {
  pageNumber: number;
  rawText: string;
};

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  const body = (await request.json()) as RefinePayload;

  if (!body?.rawText?.trim()) {
    return NextResponse.json(
      { error: "rawText is required." },
      { status: 400 }
    );
  }

  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                `You are cleaning OCR text from PDF page ${body.pageNumber}.`,
                "Fix obvious OCR errors while preserving the source wording, order, equations, numbering, and line breaks as much as possible.",
                "Do not summarize. Do not add missing content. Return plain text only.",
                "",
                body.rawText
              ].join("\n")
            }
          ]
        }
      ]
    });

    const text = response.text?.trim();

    if (!text) {
      return NextResponse.json(
        { error: "Gemini returned an empty response." },
        { status: 502 }
      );
    }

    return NextResponse.json({ text, model: MODEL });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Gemini error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
