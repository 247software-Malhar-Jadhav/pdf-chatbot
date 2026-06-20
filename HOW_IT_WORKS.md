# 📘 How It Works — Complete Project Guide

This is the **master document** for the PDF Chatbot. It explains *everything*:
what the project is, how it's built, how data flows, **what data is collected and
where it goes**, and a large **Q&A bank** so you can confidently answer any
question about it.

> Companion docs:
> - **[AI_FLOW.md](./AI_FLOW.md)** — deep dive on the AI internals (tokens, embeddings, pooling, retrieval).
> - **[FLOW_MAP.md](./FLOW_MAP.md)** — clickable map: every step → exact file & line in VS Code.
> - **[README.md](./README.md)** — setup & run instructions.

---

## 1. What is this project? (the one-paragraph pitch)

It's a web app where you **upload any PDF and chat with it**. You ask questions in
plain English ("What's the notice period?", "Who signed this?") and get answers
**grounded in the document** — the app finds the relevant passages and an AI writes
the answer from them. It works on any text-based PDF (contracts, papers, manuals,
invoices, reports) and is built with **Next.js + LangChain** using **free models**:
a local embedding model for search and Groq's hosted Llama 3.3 for answering.

**The core technique is called RAG — Retrieval-Augmented Generation.**

---

## 2. The problem it solves

A large language model (LLM) on its own:
- Hasn't read *your* PDF, so it can't answer questions about it.
- Can't fit a whole long PDF into a single prompt (context-length limits + cost).
- Tends to "hallucinate" — make up plausible but wrong answers.

**RAG fixes all three:** we store the PDF as searchable vectors, fetch only the few
passages relevant to each question, and instruct the LLM to answer *only* from those
passages. The result is accurate, cheap, and scoped to your document.

---

## 3. Architecture at a glance

```
┌────────────────────────── BROWSER (client) ──────────────────────────┐
│  components/PdfChat.tsx                                                │
│   • drag-and-drop upload      • chat UI + live streaming              │
│   • generates a per-tab sessionId   • holds chat history in state     │
└───────────────┬───────────────────────────────────┬──────────────────┘
                │ POST /api/ingest (file)            │ POST /api/chat (question + history)
                ▼                                    ▼
┌────────────────────────── NEXT.JS SERVER (Node) ─────────────────────┐
│  app/api/ingest/route.ts            app/api/chat/route.ts             │
│        │                                   │                          │
│   lib/pdf.ts  (PDF → text)            lib/store.ts → retrieveContext   │
│   lib/store.ts (chunk, embed, store)        │ similaritySearch        │
│        │                                    ▼                          │
│   lib/embeddings.ts ◄───────────────  lib/embeddings.ts (embedQuery)  │
│   (LOCAL model: text → vectors)             │                          │
│   stores vectors in RAM (globalThis)        ▼                          │
│                                       ChatGroq (prompt → LLM → stream) │
└────────────────────────────────────────────┬─────────────────────────┘
                                              │ HTTPS (only the excerpts + question)
                                              ▼
                                   ┌────────────────────────┐
                                   │   GROQ CLOUD (LLM API)  │
                                   │   Llama 3.3 70B         │
                                   └────────────────────────┘
```

Two pieces of "AI":
1. **Embedding model** — runs **locally on your server**, free, no key. Turns text into vectors for search.
2. **Groq Llama 3.3** — runs in **Groq's cloud**, free tier, needs an API key. Writes the answer.

---

## 4. Tech stack & why each choice

| Layer | Tool | Why this choice |
| --- | --- | --- |
| Framework | **Next.js 14 (App Router)** | One codebase for UI + API routes; built-in streaming |
| LLM | **Groq — Llama 3.3 70B** | Very fast inference, generous **free** tier, no card |
| Embeddings | **transformers.js** (`all-MiniLM-L6-v2`) | Runs **locally**, no API key, **free**, private |
| RAG glue | **LangChain** | Standard splitter, vector store, prompt+LLM chaining |
| Vector store | **MemoryVectorStore** | Zero-config, no database to run |
| PDF parsing | **pdf-parse** | Reliable text-layer extraction |
| UI | **React + Tailwind CSS** | Fast, clean dark interface |
| Language | **TypeScript** | Type safety across client and server |

---

## 5. The two pipelines (data flow)

### 5A. UPLOAD pipeline — "index the PDF" (happens once per file)

1. **Upload** — browser sends the PDF + a `sessionId` to `POST /api/ingest` as form data.
2. **PDF → text** — `lib/pdf.ts` extracts the text layer. If it's a scanned image (no text), it's rejected (would need OCR).
3. **Chunking** — `lib/store.ts` splits the text into ~1000-character pieces with 150-char overlap.
4. **Embedding** — each chunk is run through the **local** model → a 384-number vector (`lib/embeddings.ts`).
5. **Indexing** — all `(chunk text, metadata, vector)` triples are stored in RAM, keyed by `sessionId`.
6. **Response** — the server returns `{ ok, fileName, numPages, numChunks, chars }`. The UI shows "N chunks indexed."

### 5B. CHAT pipeline — "answer a question" (happens every message)

1. **Ask** — browser sends `{ sessionId, messages: [...full history] }` to `POST /api/chat`.
2. **Key check** — reject if `GROQ_API_KEY` is missing or still the placeholder.
3. **Embed question** — the question is embedded with the **same** local model → one vector.
4. **Retrieve** — `similaritySearch` compares that vector to all stored chunk vectors (cosine similarity) and returns the **top 5** closest chunks.
5. **Build prompt** — a system prompt (with grounding rules + the 5 excerpts) + prior chat turns + the new question.
6. **Generate** — the prompt goes to **Groq Llama 3.3**, which streams the answer token-by-token.
7. **Stream back** — the server forwards tokens as a plain-text HTTP stream; the browser appends them live (the "typing" effect).

> Step-by-step with exact line numbers: see **[FLOW_MAP.md](./FLOW_MAP.md)**.

---

## 6. ⭐ Data collection, storage & privacy (the important part)

This is what people most often ask. Here is **exactly** what data exists, where it
lives, and what leaves your machine.

### What data the app handles

| Data | Created when | Where it's processed | Where it's stored | Leaves your machine? |
| --- | --- | --- | --- | --- |
| **The PDF file** | You upload | Server RAM (parsed in memory) | **Not saved to disk**; only its text-as-vectors in RAM | ❌ No |
| **Extracted text / chunks** | On upload | Server RAM | Server RAM (vector store) | ❌ No |
| **Chunk vectors (embeddings)** | On upload | Local model, server | Server RAM (`globalThis.__pdfStores`) | ❌ No |
| **Your question** | You ask | Server | Not persisted server-side | ✅ **Yes — sent to Groq** |
| **Top-5 retrieved excerpts** | Each question | Server | — | ✅ **Yes — sent to Groq** (only these, not the whole PDF) |
| **Chat history** | As you chat | Browser React state | Browser memory only | ✅ **Yes — re-sent to Groq each turn** |
| **`sessionId`** | Page load | Browser | Browser memory (random, anonymous) | Sent to your own server only |
| **Embedding model (~25 MB)** | First run | Downloaded from Hugging Face CDN | Cached on server disk | (download only, once) |

### The one network egress that matters

The **only** user content that leaves your machine to a third party is sent to
**Groq** when generating an answer: the **retrieved excerpts + your question + the
chat history**. Crucially, **the full PDF is never sent** — only the ~5 small
passages relevant to each question. Embeddings are computed **locally**, so the
document text itself is never uploaded anywhere for indexing.

### What is NOT collected / stored

- ❌ No database. ❌ No user accounts or logins. ❌ No cookies for tracking.
- ❌ The uploaded PDF is **not written to disk** — it lives in memory only.
- ❌ No analytics on your documents or questions (other than standard server error logs printed to the console).
- ❌ Nothing survives a server restart (the in-memory store is cleared).

### Privacy caveats to be honest about

- **Groq sees the excerpts + questions** you send. That's inherent to using a hosted LLM. To keep *everything* local, swap Groq for **Ollama** (a local LLM) — see README §"Swapping models".
- **Next.js telemetry** is anonymous and about the framework, not your data; it can be disabled with `npx next telemetry disable`.
- On **first run**, the embedding model is downloaded from the Hugging Face CDN (a one-time fetch of model files, not your data).

---

## 7. Where state lives & how long (persistence)

There are **three** different "memories" in this app — a common point of confusion:

| State | Lives in | Keyed by | Survives page refresh? | Survives server restart? |
| --- | --- | --- | --- | --- |
| **Document vectors** (the indexed PDF) | Server RAM (`globalThis.__pdfStores`) | `sessionId` | The store stays, but the tab gets a new id → re-upload | ❌ No |
| **Embedding model** | Server RAM (loaded once) | — | ✅ | ❌ (re-loads from disk cache) |
| **`sessionId`** | Browser React state | — | ❌ (new id each load) | n/a |
| **Chat history** (conversation) | Browser React state | — | ❌ | n/a |

**Key takeaways for explaining it:**
- The PDF index is **in-memory and per server process** — great for a demo, not durable. For production you'd swap `MemoryVectorStore` for a real vector DB (Chroma, Supabase pgvector, Pinecone).
- The chatbot has **no server-side conversation memory** — the browser re-sends the whole history each request, and the server feeds it to the LLM as context. That's why follow-up questions work, and also why a refresh starts fresh.

---

## 8. File-by-file reference

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | Renders the app (just mounts `PdfChat`) |
| `app/layout.tsx` | Root HTML layout + metadata |
| `app/globals.css` | Tailwind + small custom styles (typing dots, scrollbar) |
| `components/PdfChat.tsx` | **The whole UI**: upload, drag-drop, chat, streaming reader, sessionId, chat history |
| `app/api/ingest/route.ts` | Upload endpoint: validate → parse → ingest |
| `app/api/chat/route.ts` | Chat endpoint: key check → retrieve → prompt → LLM → stream |
| `lib/pdf.ts` | PDF → text (pdf-parse) |
| `lib/store.ts` | Chunking, embedding/indexing, retrieval, the in-memory store |
| `lib/embeddings.ts` | The local embedding model wrapper (text → vectors) |
| `next.config.mjs` | Keeps node-only packages (transformers, pdf-parse) un-bundled |
| `.env.local` | Holds your `GROQ_API_KEY` (git-ignored, never committed) |

---

## 9. API contract (request/response shapes)

### `POST /api/ingest` (multipart form)
**Send:** `file` = the PDF, `sessionId` = string
**Get:**
```json
{ "ok": true, "fileName": "doc.pdf", "numPages": 12, "numChunks": 34, "chars": 28150 }
```
**Errors:** `400` (no file / no session), `422` (no extractable text = scanned), `500` (parse failure).

### `POST /api/chat` (JSON)
**Send:**
```json
{ "sessionId": "sess-abc", "messages": [{ "role": "user", "content": "What is the notice period?" }] }
```
**Get:** a **streamed** `text/plain` body (tokens as they're generated). Header `X-Sources` lists which chunk indices were used.
**Errors:** `400` (no session/message), `404` (no PDF for session), `500` (missing/invalid key or LLM error).

---

## 10. Configuration

Set in `.env.local` (only the key is required):

| Variable | Default | Notes |
| --- | --- | --- |
| `GROQ_API_KEY` | — | **Required.** Free from console.groq.com/keys (starts with `gsk_`). |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Any Groq chat model. |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Any transformers.js feature-extraction model. |

---

## 11. Limitations (be upfront about these)

- **Scanned/image PDFs** aren't supported (no text layer; needs OCR).
- **In-memory store** → data resets on server restart; not multi-server scalable.
- **Per-tab sessions** → refreshing the page requires re-uploading.
- **Groq free-tier rate limits** apply under heavy use.
- **Answer quality** depends on retrieval — if the right chunk isn't in the top 5, the answer may be incomplete (tune `chunkSize` / `k`).
- **Embeddings need a Node runtime with disk** → not ideal for read-only serverless; use a hosted embedding provider there.

---

## 12. ❓ Q&A bank — answer anything about it

**Q: In one sentence, what does it do?**
Upload any PDF and ask questions; it retrieves the relevant passages and an AI answers from them (RAG).

**Q: What is RAG?**
Retrieval-Augmented Generation — instead of asking the LLM blindly, you first *retrieve* relevant text from your data and give it to the LLM so the answer is grounded and accurate.

**Q: Which AI models are used?**
Two: (1) a **local** embedding model `all-MiniLM-L6-v2` for turning text into vectors, and (2) **Groq's Llama 3.3 70B** in the cloud for writing answers.

**Q: Is it really free?**
Yes. Embeddings run locally at no cost. Groq has a free API tier (no credit card). No database to pay for.

**Q: What's an embedding / vector?**
A list of 384 numbers that represents the *meaning* of a piece of text. Texts with similar meaning produce vectors that are close together, which is how we "search by meaning" instead of by keyword.

**Q: How are tokens created?**
The embedding model's tokenizer (WordPiece) splits text into sub-word units from a ~30k-word vocabulary and maps them to numeric IDs before the model processes them. (Details in AI_FLOW.md §3.)

**Q: How does it find the right answer in the PDF?**
It embeds your question into the same vector space as the chunks, then uses **cosine similarity** to find the 5 chunks whose vectors are closest, and sends those to the LLM.

**Q: Why split the PDF into chunks?**
Embedding models have input-length limits, and retrieval is more precise on small pieces. The 150-char overlap prevents losing a fact that sits on a chunk boundary.

**Q: Does my PDF get uploaded to OpenAI/Groq/the cloud?**
No. The PDF is parsed and embedded **locally**. Only the few **retrieved excerpts + your question** go to Groq to generate each answer — never the whole document.

**Q: Where is my data stored? Is there a database?**
No database. The PDF's vectors live in the server's RAM (keyed by a random session id). The uploaded file is never written to disk. Everything clears on restart.

**Q: Why do I have to re-upload after refreshing or restarting?**
The session id is per browser tab (lost on refresh), and the vector store is in-memory (lost on server restart). It's a demo-friendly, zero-config design; a real deployment would use a persistent vector DB + stable sessions.

**Q: How does it remember earlier messages in the chat?**
It doesn't, server-side. The browser keeps the chat history and re-sends it with each question; the server passes it to the LLM as conversation context.

**Q: How does streaming work?**
Groq streams tokens as it generates them; the server re-emits them as an HTTP stream; the browser reads the stream and appends each token, producing the live "typing" effect.

**Q: Why doesn't it hallucinate / make things up?**
The system prompt instructs the model to answer **only** from the provided excerpts and to say it couldn't find the answer otherwise. Low `temperature` (0.2) also keeps it factual.

**Q: What if the PDF is a scanned image?**
There's no text to extract, so it's rejected with a clear message. Supporting scans would require adding OCR (e.g. Tesseract) before chunking.

**Q: Can it handle large PDFs?**
Yes within reason — more pages just mean more chunks/vectors in RAM. Very large PDFs use more memory and take longer to index. Retrieval still only sends the top 5 chunks per question.

**Q: How would I make this production-ready?**
Swap the in-memory store for a persistent vector DB, add user auth + stable sessions, add OCR for scans, and consider a managed embedding service if deploying serverless. (README §"Going to production".)

**Q: Can it run fully offline / on-prem?**
Embeddings already run locally. Replace `ChatGroq` with `ChatOllama` (local Llama via Ollama) and nothing leaves the machine.

**Q: What are the main libraries?**
Next.js (app + API), LangChain (splitter, vector store, prompt/LLM chaining), transformers.js (local embeddings), pdf-parse (PDF text), Tailwind (UI).

**Q: What's the single most important file?**
`lib/store.ts` for indexing+retrieval and `app/api/chat/route.ts` for the prompt+LLM. `lib/embeddings.ts` is the local model.

**Q: How accurate is it?**
As accurate as retrieval + the source text. If the answer is in the document and lands in the top-5 chunks, it's reliable. If retrieval misses it, the answer may be incomplete — tunable via chunk size and `k`.

---

## 13. 30-second elevator explanation (memorize this)

> "It's a *chat-with-your-PDF* app built on **RAG**. When you upload a PDF, I extract
> its text, split it into chunks, and convert each chunk into a vector using a small
> **embedding model that runs locally** — so the document never leaves the machine.
> Those vectors are stored in memory. When you ask a question, I embed the question
> the same way, find the handful of chunks closest in meaning, and send just those
> passages plus your question to **Groq's Llama 3.3**, which streams back an answer
> grounded in the document. Two AI models, two jobs: the local one finds the right
> text, the cloud one writes the answer. It's all free and needs no database."
