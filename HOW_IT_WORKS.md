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

## 11. Constraints & Assumptions (with concrete numbers)

### 11.1 Hard numbers — the actual limits

| Thing | Value | Where it comes from |
| --- | --- | --- |
| **Chunk size** | **1000 characters** | `RecursiveCharacterTextSplitter` in `lib/store.ts` |
| **Chunk overlap** | **150 characters** | same — so each chunk adds ~850 *new* chars |
| **Chunks per document** | ≈ `totalChars / 850` | e.g. 2,126 chars → 3 chunks; 39,000 chars → ~46 chunks |
| **Minimum extractable text** | **10 characters** | below this the PDF is rejected as scanned (`ingest/route.ts`) |
| **Embedding vector size** | **384 numbers** | the `all-MiniLM-L6-v2` model |
| **Embedding model input cap** | **~256 tokens (~1,000 chars)** | model limit — text beyond this in a chunk is truncated; this is *why* chunk size is 1,000 |
| **Chunks retrieved per question** | **5** (`k = 5`) | `retrieveContext(..., 5)` in `chat/route.ts` |
| **Context sent to the LLM** | ~5 chunks ≈ **5,000 chars ≈ ~1,250 tokens** | top-5 excerpts + prompt + history |
| **LLM context window** | **128,000 tokens** | Llama 3.3 70B on Groq — we use a tiny fraction |
| **LLM temperature** | **0.2** | `chat/route.ts` (low = factual) |
| **Route time budget** | **60 s** (`maxDuration = 60`) | a hint; ignored on a persistent host like Render |
| **PDF file size** | **No hard limit in code** | bounded by server RAM + patience (see below) |
| **Practical PDF size** | comfortably **up to ~hundreds of pages** | limited by the host's memory, not the code |

### 11.2 Soft / environmental constraints

- **Server memory** is the real ceiling. On **Render free tier (512 MB RAM)** the embedding model + Node runtime use a few hundred MB; very large PDFs (thousands of pages) can hit the limit. Each stored vector is tiny (~3 KB), so vectors aren't the bottleneck — the model + runtime are.
- **No eviction / TTL on sessions.** Every upload's vectors stay in RAM until the server restarts. Many uploads in one server lifetime accumulate memory.
- **Sequential embedding.** Chunks are embedded one-by-one in a single Node process, so a huge PDF or many simultaneous uploads index slower.
- **Cold start (Render free).** Instance sleeps after ~15 min idle; first request after that takes **~30–50 s** (wake + one-time model download ~25 MB). Observed: a first upload took **~28 s**; subsequent ones ~1–2 s.
- **Groq free-tier rate limits** (approximate, subject to change — check `console.groq.com/settings/limits`): on the order of **~30 requests/min** and a **per-minute/day token cap**. Heavy use returns `429`.
- **Single server.** In-memory state means it does **not** scale across multiple instances (one instance wouldn't see another's uploads).

### 11.3 Assumptions (what must be true for it to work)

- **The PDF has a real text layer** (not a scan/photo). Scanned/image-only PDFs extract 0 chars and are rejected — no OCR.
- **The answer lives in the top-5 retrieved chunks.** If the relevant passage isn't among the 5 nearest, the answer may be incomplete (tune `chunkSize`/`k`).
- **Mostly English text.** `all-MiniLM-L6-v2` is English-optimised; other languages work but retrieval quality may drop.
- **One long-lived server process** (Render/Railway/VM), since the store is in-memory — *not* serverless (Vercel).
- **The browser tab stays open.** Session id + chat history live in the tab; a refresh starts fresh and needs a re-upload.
- **Network is available** to reach Groq (every answer) and, on first run, the Hugging Face CDN (model download).
- **A valid `GROQ_API_KEY`** is set and within rate limits.

---

## 12. ❓ Q&A bank — answer anything about it

> Each answer ends with **📌 Constraints/assumptions** so you can defend the answer
> and state its limits. Numbers are summarised in §11.

**Q: In one sentence, what does it do?**
Upload any PDF and ask questions; it retrieves the relevant passages and an AI answers from them (RAG).
📌 *Assumes the PDF has a text layer; only the top-5 relevant passages are used per answer.*

**Q: What is RAG?**
Retrieval-Augmented Generation — instead of asking the LLM blindly, you first *retrieve* relevant text from your data and give it to the LLM so the answer is grounded and accurate.
📌 *Constraint: answer quality is capped by retrieval — if the right chunk isn't retrieved, the LLM can't use it.*

**Q: Which AI models are used?**
Two: (1) a **local** embedding model `all-MiniLM-L6-v2` (384-dim, ~256-token input cap), and (2) **Groq's Llama 3.3 70B** (128k-token context) in the cloud for writing answers.
📌 *Assumes a Node server with disk for the local model + network access to Groq.*

**Q: Is it really free?**
Yes. Embeddings run locally at no cost. Groq has a free API tier (no credit card). No database to pay for.
📌 *Constraint: Groq free tier has rate limits (~30 req/min + token caps); Render free tier has 512 MB RAM and sleeps when idle.*

**Q: How big a PDF can I upload? How many characters/pages?**
There is **no hard size limit in the code** — any PDF is accepted. The practical limit is **server memory and patience**, not a fixed number: on Render's 512 MB free tier it comfortably handles documents up to **roughly a few hundred pages**. Text is what matters, not file size: each ~1,000 characters becomes one chunk, and each chunk is a tiny 384-number vector (~3 KB), so even a 300-page doc (~750k chars → ~880 chunks) is only ~3 MB of vectors. The real cost is the embedding model + Node runtime (~a few hundred MB) and indexing time.
📌 *Constraint: bounded by host RAM (512 MB on Render free), no enforced max; very large PDFs may OOM or index slowly. Minimum: must extract ≥10 characters or it's rejected as scanned.*

**Q: How many chunks will my PDF become?**
Roughly **`total_characters / 850`** (1,000-char chunks minus 150-char overlap). Examples seen in testing: 1,331 chars → 2 chunks, 2,126 chars → 3 chunks, ~39,000 chars → ~46 chunks.
📌 *Constraint: fixed by `chunkSize: 1000` / `chunkOverlap: 150` in `lib/store.ts`; change there to re-tune.*

**Q: What's an embedding / vector?**
A list of **384 numbers** that represents the *meaning* of a piece of text. Texts with similar meaning produce vectors that are close together, which is how we "search by meaning" instead of by keyword.
📌 *Constraint: the model embeds at most ~256 tokens (~1,000 chars) per call — longer text is truncated, which is exactly why chunks are capped at 1,000 chars.*

**Q: How are tokens created?**
The embedding model's tokenizer (WordPiece) splits text into sub-word units from a ~30k-word vocabulary and maps them to numeric IDs before the model processes them. (Details in AI_FLOW.md §3.)
📌 *Constraint: max ~256 tokens per embedding input; English-optimised vocabulary.*

**Q: How does it find the right answer in the PDF?**
It embeds your question into the same vector space as the chunks, then uses **cosine similarity** to find the **5** chunks whose vectors are closest, and sends those to the LLM.
📌 *Constraint: `k = 5`; assumes the answer is within those 5. Raise `k` for broad questions, but that sends more tokens to the LLM.*

**Q: Why split the PDF into chunks?**
Embedding models have input-length limits (~256 tokens here), and retrieval is more precise on small pieces. The 150-char overlap prevents losing a fact that sits on a chunk boundary.
📌 *Assumption: relevant facts fit within a ~1,000-char window; facts spread across many distant pages may need a higher `k`.*

**Q: How much data is actually sent to the cloud (Groq) per question?**
Only the **5 retrieved excerpts (~5,000 chars ≈ ~1,250 tokens) + your question + the chat history** — never the whole PDF. That's well under Llama 3.3's 128k-token context.
📌 *Constraint: long conversations grow the history sent each turn, which counts toward Groq's per-minute token cap.*

**Q: Does my PDF get uploaded to OpenAI/Groq/the cloud?**
No. The PDF is parsed and embedded **locally**. Only the few **retrieved excerpts + your question** go to Groq to generate each answer — never the whole document.
📌 *Assumption: "local" means on the server running the app. Groq still sees the excerpts you ask about. For zero egress, swap to a local LLM (Ollama).*

**Q: Where is my data stored? Is there a database?**
No database. The PDF's vectors live in the server's RAM (keyed by a random session id). The uploaded file is never written to disk. Everything clears on restart.
📌 *Constraint: in-memory, no persistence, no eviction — vectors accumulate until the process restarts.*

**Q: Why do I have to re-upload after refreshing or restarting?**
The session id is per browser tab (lost on refresh), and the vector store is in-memory (lost on server restart, including Render's idle sleep). It's a demo-friendly, zero-config design.
📌 *Constraint: no durable storage + per-tab sessions. Fix with a persistent vector DB + stable auth/session.*

**Q: How does it remember earlier messages in the chat?**
It doesn't, server-side. The browser keeps the chat history and re-sends it with each question; the server passes it to the LLM as conversation context.
📌 *Constraint: history lives only in the tab and grows the token cost of each request; cleared on refresh / "New PDF".*

**Q: How does streaming work?**
Groq streams tokens as it generates them; the server re-emits them as an HTTP stream; the browser reads the stream and appends each token, producing the live "typing" effect.
📌 *Assumption: the host supports streaming responses (Render does; serverless platforms vary).*

**Q: Why doesn't it hallucinate / make things up?**
The system prompt instructs the model to answer **only** from the provided excerpts and to say it couldn't find the answer otherwise. Low `temperature` (0.2) also keeps it factual.
📌 *Constraint: grounding is best-effort, not guaranteed — an LLM can still err; it only sees the 5 retrieved chunks, not the whole doc.*

**Q: What if the PDF is a scanned image?**
There's no text to extract, so it's rejected (needs ≥10 extractable chars) with a clear message. Supporting scans would require adding OCR (e.g. Tesseract) before chunking.
📌 *Assumption: input PDFs have a digital text layer.*

**Q: Can it handle large PDFs / what's the bottleneck?**
Yes within reason — more pages just mean more chunks/vectors in RAM and longer indexing. The bottleneck is **server RAM** (512 MB on Render free) and the **sequential, one-by-one embedding**, not the vector storage. Retrieval still sends only the top 5 chunks per question regardless of size.
📌 *Constraint: ~hundreds of pages on free tier; thousands may OOM. First index after a cold start is slow (~30 s).*

**Q: What are the speed numbers?**
First upload after a cold start: **~30 s** (wake + one-time ~25 MB model download). After warm-up: indexing a small PDF ~1–2 s; each answer streams in a few seconds depending on length.
📌 *Constraint: Render free instance sleeps after ~15 min idle, so the cold-start cost recurs.*

**Q: How would I make this production-ready?**
Swap the in-memory store for a persistent vector DB, add user auth + stable sessions, add OCR for scans, add session eviction/TTL, and consider a managed embedding service if deploying serverless. (README §"Going to production".)
📌 *Assumption: current design targets a demo / single server, not multi-tenant scale.*

**Q: Can it run fully offline / on-prem?**
Embeddings already run locally. Replace `ChatGroq` with `ChatOllama` (local Llama via Ollama) and nothing leaves the machine.
📌 *Constraint: a local LLM needs significant RAM/CPU (or GPU) — well beyond the 512 MB free tier.*

**Q: What are the main libraries?**
Next.js (app + API), LangChain (splitter, vector store, prompt/LLM chaining), transformers.js (local embeddings), pdf-parse (PDF text), Tailwind (UI).
📌 *Constraint: `@huggingface/transformers` is heavy + native — it's why this can't run on Vercel's serverless functions.*

**Q: What's the single most important file?**
`lib/store.ts` for indexing+retrieval and `app/api/chat/route.ts` for the prompt+LLM. `lib/embeddings.ts` is the local model.
📌 *Constraint: the tuning knobs (chunk size, overlap, `k`, temperature, model) all live in these three files.*

**Q: How accurate is it?**
As accurate as retrieval + the source text. If the answer is in the document and lands in the top-5 chunks, it's reliable. If retrieval misses it, the answer may be incomplete — tunable via chunk size and `k`.
📌 *Constraint: accuracy ceiling = retrieval quality (k=5, 1,000-char chunks) + the LLM; no ground-truth verification step.*

**Q: Why can't this run on Vercel?**
Vercel is serverless: `/api/ingest` and `/api/chat` run as separate, stateless functions, so the in-memory vectors from upload aren't visible at chat time; and the local embedding model needs a writable disk + native runtime that serverless doesn't provide. It needs a persistent server (Render/Railway) — or a serverless refactor (e.g. Upstash Vector).
📌 *Constraint: architecture assumes one long-lived process with shared memory + disk.*

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
