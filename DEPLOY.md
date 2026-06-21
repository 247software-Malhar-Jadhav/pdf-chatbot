# 🚀 Deploying PDF Chatbot

This app runs as a **persistent Node server**, so deploy it to a host that keeps a
process alive — **Render** or **Railway** (both have free tiers). The repo already
includes everything needed (`render.yaml`, `.npmrc`, `.node-version`).

> **Why not Vercel?** Vercel is serverless: each API route runs as a separate,
> stateless function. This app keeps the uploaded PDF's vectors **in memory** and
> runs the embedding model **on local disk** — both need one long-lived process.
> On Vercel the `/api/chat` function wouldn't see what `/api/ingest` stored, and the
> embedding model wouldn't load. Render/Railway run a real server, so it just works.
> (To target Vercel, you'd swap the in-memory store + local embeddings for a
> serverless vector DB like Upstash Vector — a separate refactor.)

---

## Option A — Render (recommended, uses the included `render.yaml`)

1. Push your code to GitHub (already done: `github.com/malharjadhav8999/pdf-chatbot`).
2. Go to **<https://dashboard.render.com>** → **New +** → **Blueprint**.
3. Connect your GitHub and select the **`pdf-chatbot`** repo. Render detects
   `render.yaml` automatically.
4. When prompted, set the environment variable:
   - **`GROQ_API_KEY`** = your free key from <https://console.groq.com/keys>
5. Click **Apply** / **Create**. Render runs `npm install && npm run build`, then
   `npm run start`. First deploy takes a few minutes.
6. Open the URL Render gives you (e.g. `https://pdf-chatbot-xxxx.onrender.com`).

**Free-tier notes**
- The instance **sleeps after ~15 min idle**; the next visit has a ~50s cold start.
- ~512 MB RAM — fine for normal PDFs. Very large PDFs may need a paid instance.
- Disk is ephemeral: the embedding model re-downloads (~25 MB) after a restart, on
  the first request. That's why the first question after a cold start is slower.

---

## Option B — Railway

1. Go to **<https://railway.app>** → **New Project** → **Deploy from GitHub repo**.
2. Select the `pdf-chatbot` repo. Railway auto-detects Next.js (Nixpacks):
   - Build: `npm install && npm run build`  (the `.npmrc` handles peer deps)
   - Start: `npm run start`
3. In **Variables**, add **`GROQ_API_KEY`** = your Groq key.
4. Deploy. Open the generated domain (enable a public domain under **Settings →
   Networking** if needed).

---

## Option C — Any Node host / VM / Docker

The app is a standard Next.js server:

```bash
npm install            # .npmrc applies legacy-peer-deps
npm run build
GROQ_API_KEY=gsk_xxx npm run start   # listens on $PORT (default 3000)
```

Put it behind a reverse proxy (nginx/Caddy) for HTTPS if self-hosting.

---

## Environment variables (set on the host, never commit them)

| Variable | Required | Default |
| --- | --- | --- |
| `GROQ_API_KEY` | ✅ Yes | — |
| `GROQ_MODEL` | No | `llama-3.3-70b-versatile` |
| `EMBEDDING_MODEL` | No | `Xenova/all-MiniLM-L6-v2` |

---

## Post-deploy checklist

- [ ] `GROQ_API_KEY` is set in the host's env (not in the repo).
- [ ] Open the site, upload a PDF, confirm "N chunks indexed".
- [ ] Ask a question and confirm a streamed answer (first one after cold start is slow — that's the model loading).
