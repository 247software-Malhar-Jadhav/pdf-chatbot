# 📄 PDF Chatbot

> Upload **any** PDF and chat with it — contracts, research papers, manuals, invoices, reports, books, anything. Ask questions in plain language and get answers grounded in the document, with streaming responses.

Built with **Next.js (App Router)** and **LangChain**, using **100% free models** — no paid API keys, no cloud database, no credit card.

### 🌐 Live demo

**→ https://pdf-chatbot-u7ej.onrender.com**

> Hosted on Render's free tier, so the instance sleeps when idle — the **first
> visit may take ~30–50 s** to wake up and load the embedding model. It's fast
> after that.

---

## ✨ Features

- 💬 **Chat with any PDF** — works on any text-based PDF, not just one document type.
- 🆓 **Completely free stack** — free LLM tier + local embeddings + in-memory vectors.
- ⚡ **Streaming answers** — responses appear token-by-token, like ChatGPT.
- 🧠 **RAG (Retrieval-Augmented Generation)** — answers are grounded in your document, so the model doesn't make things up.
- 🔒 **Private embeddings** — your PDF is embedded **locally on your machine**; the text never leaves your server except the small relevant excerpts sent to the LLM.
- 🖱️ **Drag-and-drop upload** with a clean dark UI.
- 🗂️ **Conversation memory** — follow-up questions keep context from earlier in the chat.
- 🚫 **Scanned-PDF detection** — image-only PDFs are detected and reported clearly.

---

## 🧩 Tech Stack

| Layer | Choice | Why | Cost |
| --- | --- | --- | --- |
| **Framework** | Next.js 14 (App Router) | Full-stack React, API routes, streaming | Free |
| **LLM** | [Groq](https://groq.com) — Llama 3.3 70B | Extremely fast inference, generous free tier | **Free** |
| **Embeddings** | [transformers.js](https://huggingface.co/docs/transformers.js) — `all-MiniLM-L6-v2` | Runs locally in Node, no API key | **Free** |
| **Orchestration** | [LangChain](https://js.langchain.com) | Chunking, retrieval, prompt + LLM chaining | Free |
| **Vector store** | LangChain `MemoryVectorStore` | Zero-config, no database | Free |
| **PDF parsing** | `pdf-parse` | Reliable text extraction | Free |
| **Styling** | Tailwind CSS | Fast, clean dark UI | Free |

The **only** thing you provide is a free Groq API key.

---

## 🏗️ How it works (RAG pipeline)

```
                         ┌─────────────────────── INGEST ───────────────────────┐
                         │                                                        │
  Upload PDF ──► extract text ──► split into chunks ──► embed locally ──► store in
  (pdf-parse)     (pdf-parse)    (1000 chars, 150       (transformers.js)   vector DB
                                  overlap)                                  (in-memory)
                         │                                                        │
                         └────────────────────────────────────────────────────────┘

                         ┌──────────────────────── CHAT ────────────────────────┐
                         │                                                        │
  Your question ──► embed question ──► similarity search ──► top 5 excerpts ──►   │
                    (transformers.js)   (vector store)                            │
                                                                                  ▼
                              streamed answer  ◄──  Groq LLM (Llama 3.3)  ◄── prompt
                                                    grounded in excerpts          (excerpts + question + history)
                         │                                                        │
                         └────────────────────────────────────────────────────────┘
```

**In short:** the PDF is broken into overlapping chunks and turned into vectors once. For each question, only the most relevant chunks are retrieved and sent to the LLM, so answers stay accurate and the prompt stays small.

---

## 🚀 Getting Started

### 1. Prerequisites

- **Node.js 18.18+** (Node 20+ recommended)
- A free **Groq API key** — sign up at <https://console.groq.com/keys> (no credit card required)

### 2. Install dependencies

```bash
npm install
```

> If you hit a peer-dependency error from an unused optional LangChain dependency, use:
> ```bash
> npm install --legacy-peer-deps
> ```

### 3. Add your Groq API key

```bash
cp .env.local.example .env.local
```

Then open `.env.local` and paste your key:

```env
GROQ_API_KEY=gsk_your_key_here
```

### 4. Run the dev server

```bash
npm run dev
```

Open <http://localhost:3000>, drop in a PDF, and start asking questions.

> ⏳ **First run note:** the very first upload downloads a small embedding model (~25 MB) and caches it to disk. This takes a few seconds once — every run after is instant.

### 5. Production build

```bash
npm run build
npm start
```

---

## ⚙️ Configuration

All set in `.env.local` (only the API key is required):

| Variable | Default | Description |
| --- | --- | --- |
| `GROQ_API_KEY` | — | **Required.** Your free Groq API key. |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Any Groq-hosted chat model (e.g. `llama-3.1-8b-instant`, `gemma2-9b-it`). |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Any transformers.js feature-extraction model. |

---

## 📁 Project Structure

```
pdf-chatbot/
├── app/
│   ├── api/
│   │   ├── ingest/route.ts   # Parse PDF → chunk → embed → store
│   │   └── chat/route.ts     # Retrieve context → stream Groq answer
│   ├── globals.css           # Tailwind + custom styles
│   ├── layout.tsx            # Root layout
│   └── page.tsx              # Home page
├── components/
│   └── PdfChat.tsx           # Upload + streaming chat UI (client component)
├── lib/
│   ├── pdf.ts                # PDF text extraction (pdf-parse)
│   ├── embeddings.ts         # Local free embeddings (transformers.js)
│   └── store.ts              # Chunking + in-memory vector store + retrieval
├── .env.local.example        # Env template
├── next.config.mjs           # Keeps node-only packages external
├── tailwind.config.ts
└── tsconfig.json
```

---

## 🔌 API Reference

### `POST /api/ingest`

Multipart form upload. Parses, chunks, embeds, and stores a PDF for a session.

**Form fields:** `file` (the PDF), `sessionId` (string)

**Response:**
```json
{ "ok": true, "fileName": "doc.pdf", "numPages": 12, "numChunks": 34, "chars": 28150 }
```

### `POST /api/chat`

Retrieves relevant excerpts and streams a grounded answer.

**Body:**
```json
{ "sessionId": "sess-abc", "messages": [{ "role": "user", "content": "What is the notice period?" }] }
```

**Response:** a streamed `text/plain` body (token-by-token).

---

## 🛠️ Troubleshooting

| Problem | Cause / Fix |
| --- | --- |
| `GROQ_API_KEY is not set` | Create `.env.local` and add your key, then restart `npm run dev`. |
| "Could not extract text from this PDF" | The PDF is **scanned / image-only** (no text layer). Add OCR (e.g. Tesseract) to support it. |
| `ERESOLVE` during install | Run `npm install --legacy-peer-deps`. |
| First chat is slow | The embedding model downloads once on first use, then caches. |
| Answers reset after restart | The vector store is **in-memory** — see "Going to production" below. |

---

## 📦 Going to production

This project is intentionally zero-config (in-memory store, per-tab sessions). To make it production-grade:

- **Persistent vectors:** swap `MemoryVectorStore` in `lib/store.ts` for [Chroma](https://js.langchain.com/docs/integrations/vectorstores/chroma), [Supabase pgvector](https://js.langchain.com/docs/integrations/vectorstores/supabase), or [Pinecone](https://js.langchain.com/docs/integrations/vectorstores/pinecone).
- **Multi-user / auth:** key stores by authenticated user instead of a random per-tab session id.
- **OCR:** pre-process scanned PDFs with Tesseract before ingestion.
- **Deploy:** works on any Node host (Render, Railway, Fly.io, a VM). Note that the local embedding model needs a Node runtime with filesystem access — serverless platforms with read-only filesystems may need a hosted embedding provider instead.

---

## 🔁 Swapping models

- **Fully offline LLM?** Replace `ChatGroq` in `app/api/chat/route.ts` with `ChatOllama` from `@langchain/ollama` and run [Ollama](https://ollama.com) locally.
- **Different free Groq model?** Just change `GROQ_MODEL` in `.env.local`.
- **Different embeddings?** Set `EMBEDDING_MODEL` to any transformers.js feature-extraction model.

---

## 📄 License

MIT — free to use, modify, and learn from.
