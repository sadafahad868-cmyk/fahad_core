# Fahad Core Chatbot

Fahad Core is a lightweight Groq-powered AI chatbot with a single-file frontend and a Node.js local server. The same project is also ready for Vercel Functions, so `/api/chat` works in production without exposing the Groq API key to the browser.

## Project structure

```text
fahxd_core/
├── api/
│   ├── chat.js
│   └── health.js
├── .env
├── .env.example
├── .gitignore
├── fahad-core-mark.svg
├── index.html
├── package.json
└── server.js
```

## Local development

1. Create `.env` from `.env.example` and add a valid Groq API key.
2. Open the terminal in the `fahxd_core` folder — the folder containing `package.json`.
3. Run:

```bash
npm start
```

4. Open:

```text
http://localhost:5110
```

Do not open `index.html` directly with `file://`.

## Vercel deployment

Vercel automatically deploys files in `api/` as Node.js Functions. Add these Environment Variables in the Vercel project:

```text
GROQ_API_KEY=your_new_key
GROQ_MODEL=openai/gpt-oss-120b
```

Then redeploy. The frontend calls `/api/health` and `/api/chat` on the same origin, so no localhost URL or CORS setting is required in production.

## Models

The UI supports:

- `openai/gpt-oss-120b`
- `openai/gpt-oss-20b`

Both are supported by Groq's Chat Completions API and support reasoning effort levels low/medium/high.
