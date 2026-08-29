const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const DEFAULT_SYSTEM_PROMPT =
  process.env.FAHAD_CORE_SYSTEM_PROMPT ||
  "You are Fahad Core, a clear, practical, friendly AI assistant. Reply in English unless the user asks for another language. Keep answers short and to the point by default - a few sentences or a short list is usually enough. Only go longer when the user explicitly asks for detail, a full explanation, or step-by-step instructions.";
const ALLOWED_MODELS = new Set(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
const MAX_BODY_BYTES = 1024 * 1024;

export const maxDuration = 300;

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    if (!process.env.GROQ_API_KEY) {
      return Response.json(
        {
          error: "Missing GROQ_API_KEY",
          detail: "Add GROQ_API_KEY to Vercel Environment Variables and redeploy."
        },
        { status: 500 }
      );
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return Response.json({ error: "Request body too large" }, { status: 413 });
    }

    let body;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        return Response.json({ error: "Request body too large" }, { status: 413 });
      }
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Invalid JSON request body" }, { status: 400 });
    }

    const messages = sanitizeMessages(body?.messages);
    if (!messages.length) {
      return Response.json({ error: "At least one chat message is required" }, { status: 400 });
    }

    const model = normalizeModel(body?.model);
    const systemPrompt =
      typeof body?.systemPrompt === "string" && body.systemPrompt.trim()
        ? body.systemPrompt.trim().slice(0, 12000)
        : DEFAULT_SYSTEM_PROMPT;

    const payload = {
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages.slice(-40)],
      temperature: clamp(Number(body?.temperature ?? 0.6), 0, 2),
      top_p: 1,
      max_completion_tokens: clampInt(Number(body?.maxTokens ?? 700), 128, 8192),
      reasoning_effort: normalizeReasoning(body?.reasoningEffort ?? "low"),
      stream: true
    };

    if (body?.enableSearch === true) payload.tools = [{ type: "browser_search" }];

    let groqResponse;
    try {
      groqResponse = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: request.signal
      });
    } catch (error) {
      if (request.signal.aborted) {
        return new Response(null, { status: 499 });
      }
      return Response.json(
        {
          error: "Could not reach Groq",
          detail: error instanceof Error ? error.message : "Network request failed"
        },
        { status: 502 }
      );
    }

    if (!groqResponse.ok) {
      return Response.json(
        {
          error: "Groq request failed",
          detail: safeErrorDetail(await groqResponse.text())
        },
        { status: groqResponse.status }
      );
    }

    const textStream = transformGroqStream(groqResponse.body);
    return new Response(textStream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no"
      }
    });
  }
};

function transformGroqStream(body) {
  if (!body) {
    return new ReadableStream({
      start(controller) {
        controller.error(new Error("Groq returned an empty response body"));
      }
    });
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let closed = false;

  return new ReadableStream({
    async pull(controller) {
      if (closed) return;

      try {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          closed = true;
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;

          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            closed = true;
            controller.close();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (typeof content === "string" && content) controller.enqueue(encoder.encode(content));
          } catch {
            // Ignore malformed SSE fragments.
          }
        }
      } catch (error) {
        closed = true;
        controller.error(error);
      }
    },
    cancel() {
      closed = true;
      reader.cancel().catch(() => {});
    }
  });
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && typeof message.content === "string")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content.trim().slice(0, 50000)
    }))
    .filter((message) => message.content.length > 0);
}

function normalizeModel(value) {
  const model = typeof value === "string" ? value.trim() : "";
  return ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
}

function normalizeReasoning(value) {
  return ["low", "medium", "high"].includes(value) ? value : "low";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function clampInt(value, min, max) {
  return Math.round(clamp(value, min, max));
}

function safeErrorDetail(detail) {
  if (!detail) return "No error details returned";
  return detail
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 1500);
}