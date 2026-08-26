const DEFAULT_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

export default {
  fetch(request) {
    if (request.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    return Response.json({
      ok: true,
      model: DEFAULT_MODEL,
      hasGroqKey: Boolean(process.env.GROQ_API_KEY)
    }, {
      headers: { "Cache-Control": "no-store" }
    });
  }
};
