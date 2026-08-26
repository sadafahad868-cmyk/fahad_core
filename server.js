import http from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5111);
const ROOT_DIR = path.resolve(__dirname);
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const DEFAULT_SYSTEM_PROMPT =
  process.env.FAHAD_CORE_SYSTEM_PROMPT ||
  "You are Fahad Core, a clear, practical, friendly AI assistant. Reply in English unless the user asks for another language.";
const MAX_BODY_BYTES = 1024 * 1024;
const ALLOWED_MODELS = new Set(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname === "/api/health") return handleHealth(req, res);
    if (url.pathname === "/api/chat") return handleChat(req, res);
    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      return sendJson(res, 500, {
        error: "Server error",
        detail: error instanceof Error ? error.message : "Unknown error"
      });
    }
    res.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Fahad Core is running at http://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY) console.log("GROQ_API_KEY is not configured.");
});

function handleHealth(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  return sendJson(res, 200, {
    ok: true,
    model: DEFAULT_MODEL,
    hasGroqKey: Boolean(process.env.GROQ_API_KEY)
  });
}

async function handleChat(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  if (!process.env.GROQ_API_KEY) {
    return sendJson(res, 500, {
      error: "Missing GROQ_API_KEY",
      detail: "Configure GROQ_API_KEY in the local .env file or Vercel Environment Variables."
    });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (error) {
    return sendJson(res, 400, {
      error: error?.message === "Request body too large" ? error.message : "Invalid JSON request body"
    });
  }

  const messages = sanitizeMessages(body?.messages);
  if (!messages.length) return sendJson(res, 400, { error: "At least one chat message is required" });

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
    max_completion_tokens: clampInt(Number(body?.maxTokens ?? 2048), 128, 8192),
    reasoning_effort: normalizeReasoning(body?.reasoningEffort),
    stream: true
  };

  if (body?.enableSearch === true) payload.tools = [{ type: "browser_search" }];

  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.once("close", onClose);

  let groqResponse;
  try {
    groqResponse = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    res.removeListener("close", onClose);
    if (controller.signal.aborted) return;
    return sendJson(res, 502, {
      error: "Could not reach Groq",
      detail: error instanceof Error ? error.message : "Network request failed"
    });
  }

  if (!groqResponse.ok) {
    const detail = safeErrorDetail(await groqResponse.text());
    res.removeListener("close", onClose);
    return sendJson(res, groqResponse.status, { error: "Groq request failed", detail });
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  try {
    await streamGroqText(groqResponse, res);
  } catch (error) {
    console.error("Streaming error:", error);
    if (!res.destroyed) res.end();
  } finally {
    res.removeListener("close", onClose);
  }
}

async function streamGroqText(groqResponse, res) {
  const reader = groqResponse.body?.getReader();
  if (!reader) throw new Error("Groq returned an empty response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          res.end();
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content) res.write(content);
        } catch {
          // Ignore incomplete/malformed SSE fragments and continue.
        }
      }
    }

    buffer += decoder.decode();
    if (!res.writableEnded) res.end();
  } finally {
    reader.releaseLock?.();
  }
}

function serveStatic(requestPath, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath || "/");
  } catch {
    return sendText(res, 400, "Bad request");
  }

  const relative = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.resolve(ROOT_DIR, `.${relative}`);

  if (filePath !== ROOT_DIR && !filePath.startsWith(`${ROOT_DIR}${path.sep}`)) {
    return sendText(res, 403, "Forbidden");
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return sendText(res, 404, "Not found");
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
  });
  createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let rejected = false;

    req.on("data", (chunk) => {
      if (rejected) return;
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        rejected = true;
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!rejected) resolve(body);
    });
    req.on("error", reject);
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
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function clampInt(value, min, max) {
  return Math.round(clamp(value, min, max));
}

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function safeErrorDetail(detail) {
  if (!detail) return "No error details returned";
  return detail
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 1500);
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
