# Running Aura AI Assistant locally

## 1. Prerequisites

- Node.js 20+ (or [Bun](https://bun.sh))
- A clone of this repository

## 2. Install dependencies

```sh
npm install     # or: bun install
```

## 3. Create `.env`

`.env` is git-ignored, so it is not in the repo. Create it in the project root:

```sh
cp .env.example .env
```

Then fill it with the following. These backend keys are **publishable** (safe on the client) and point at the same hosted backend the preview uses, so auth/database/history work immediately:

```env
VITE_SUPABASE_URL=https://zlhouopvvtbkfvjvapca.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_aIMiCv7C9RrDfHU3gREjew_2Q38xQOO
VITE_SUPABASE_PROJECT_ID=zlhouopvvtbkfvjvapca

# server-side copies (used to verify bearer tokens on API routes)
SUPABASE_URL=https://zlhouopvvtbkfvjvapca.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_aIMiCv7C9RrDfHU3gREjew_2Q38xQOO
```

## 4. Choose an AI provider (no Lovable credits needed)

Add ONE of these blocks to `.env`.

**a) Demo mode — zero keys, scripted AI Doctor replies:**

```env
AI_PROVIDER=demo
STT_PROVIDER=none
```

**b) Google Gemini (free tier key from https://aistudio.google.com/apikey):**

```env
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_MODEL=gemini-2.5-flash
AI_API_KEY=your-key-here
STT_PROVIDER=none
```

**c) A local OpenAI-compatible server (LM Studio, llama.cpp server, vLLM):**

```env
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://localhost:1234/v1
AI_MODEL=your-local-model-id
AI_API_KEY=not-needed
STT_PROVIDER=none
```

`STT_PROVIDER=none` is fine: voice input uses the browser's built-in Web Speech API in Chrome/Edge (free), and text-to-speech uses the browser's `speechSynthesis`. The server STT provider is only a fallback for browsers without the Web Speech API.

## 5. Run

```sh
npm run dev     # or: bun run dev
```

Open http://localhost:8080

## 6. Production build (optional)

```sh
npm run build
npm run preview
```

## Troubleshooting

- **Blank page / "Missing Supabase environment variable(s)"** — `.env` is missing or the app was started before creating it. Restart the dev server after editing `.env`.
- **Microphone does nothing** — use Chrome or Edge; `localhost` is a secure origin so permission prompts work. Firefox/Safari have no Web Speech API and will need a configured `STT_PROVIDER`.
- **AI Doctor replies look scripted** — you are in `AI_PROVIDER=demo`; switch to option (b) or (c).
