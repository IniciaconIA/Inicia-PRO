import { NextRequest, NextResponse } from "next/server";
import { trackUsage } from "@/lib/track-usage";

// OpenRouter (API tipo OpenAI). El modelo se cambia con OPENROUTER_MODEL sin tocar código.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
const TIMEOUT_MS = 60_000;

type Attachment = { base64?: string; mediaType?: string };

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error("[enhance] Falta OPENROUTER_API_KEY");
    return NextResponse.json(
      { error: "API key not configured" },
      { status: 500 }
    );
  }

  try {
    const { system, message, images, documents, mode } = await req.json();

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const imageList: Attachment[] = Array.isArray(images) ? images : [];
    const docList: Attachment[] = Array.isArray(documents) ? documents : [];

    let userContent: string | ContentPart[] = message;

    if (imageList.length > 0 || docList.length > 0) {
      const parts: ContentPart[] = [];

      for (const img of imageList) {
        if (img.base64 && img.mediaType) {
          parts.push({
            type: "image_url",
            image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
          });
        }
      }

      docList.forEach((doc, i) => {
        if (doc.base64 && doc.mediaType) {
          parts.push({
            type: "file",
            file: {
              filename: `documento-${i + 1}.pdf`,
              file_data: `data:${doc.mediaType};base64,${doc.base64}`,
            },
          });
        }
      });

      // El texto va al final, como antes.
      parts.push({ type: "text", text: message });
      userContent = parts;
    }

    const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://inicia-pro-xi.vercel.app",
        "X-Title": "InicIA Pro",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      // Queda en los logs de Vercel para saber qué contestó OpenRouter.
      console.error("[enhance] OpenRouter respondió", response.status, JSON.stringify(errorData).slice(0, 500));
      return NextResponse.json(
        { error: "API request failed", details: errorData },
        { status: response.status }
      );
    }

    const data = await response.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";

    if (!text) {
      console.error("[enhance] OpenRouter respondió sin texto", JSON.stringify(data).slice(0, 500));
      return NextResponse.json(
        { error: "API request failed" },
        { status: 502 }
      );
    }

    const usage = {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    };

    // Fire-and-forget usage tracking
    trackUsage(mode || "Asistente", usage.input_tokens, usage.output_tokens);

    // Misma forma que la respuesta de Anthropic, para que el frontend no cambie.
    return NextResponse.json({
      content: [{ type: "text", text }],
      usage,
      model: data.model ?? model,
    });
  } catch (error) {
    console.error("[enhance] Error interno", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
