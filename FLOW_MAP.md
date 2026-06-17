# 🗺️ AI Flow Map — Clickable Code Walkthrough

Every step below links straight to the **exact line in VS Code**. Click a link and
VS Code jumps to that file and line (the code has a matching `// STEP n` comment
right there).

> **If the links don't open VS Code:** they use the `vscode://file/...` protocol.
> - Make sure VS Code is installed and "Open with VS Code" / URL handler is enabled.
> - Viewing this file *inside* VS Code's Markdown preview works best.
> - Links are absolute to `/home/crest/study/ai/pdf-chatbot`. If you move the
>   project, run a find-replace on that path in this file.
> - For the plain `path:line` form (e.g. in a terminal or GitHub), the table at
>   the bottom lists every location too.

---

## 🅰️ UPLOAD pipeline — indexing the PDF (runs once per file)

| # | Step | What happens | Open in VS Code |
| --- | --- | --- | --- |
| 1 | **PDF → text** | Extract the PDF's text layer; reject scans | [ingest/route.ts:34](vscode://file/home/crest/study/ai/pdf-chatbot/app/api/ingest/route.ts:34) · [pdf.ts:15](vscode://file/home/crest/study/ai/pdf-chatbot/lib/pdf.ts:15) |
| 2 | **Chunking** | Split text into ~1000-char overlapping pieces | [store.ts:58](vscode://file/home/crest/study/ai/pdf-chatbot/lib/store.ts:58) |
| 3 | **Embed chunks** | Each chunk → 384-d vector (local model) | [embeddings.ts:51](vscode://file/home/crest/study/ai/pdf-chatbot/lib/embeddings.ts:51) |
| 3c | ↳ pooling + normalize | Per-token vectors → one unit vector | [embeddings.ts:59](vscode://file/home/crest/study/ai/pdf-chatbot/lib/embeddings.ts:59) |
| 4 | **Index** | Store (text, metadata, vector) in RAM | [store.ts:81](vscode://file/home/crest/study/ai/pdf-chatbot/lib/store.ts:81) |

---

## 🅱️ CHAT pipeline — answering a question (runs every message)

| # | Step | What happens | Open in VS Code |
| --- | --- | --- | --- |
| 6b | **Session id** | Browser tags every request with its tab id | [PdfChat.tsx:14](vscode://file/home/crest/study/ai/pdf-chatbot/components/PdfChat.tsx:14) |
| 6c | **Send history** | Full conversation re-sent to the server | [PdfChat.tsx:98](vscode://file/home/crest/study/ai/pdf-chatbot/components/PdfChat.tsx:98) |
| 5 | **Embed question** | Question → 384-d vector (same model) | [embeddings.ts:76](vscode://file/home/crest/study/ai/pdf-chatbot/lib/embeddings.ts:76) |
| 5 | **Retrieve** | Cosine search → top-5 closest chunks | [store.ts:108](vscode://file/home/crest/study/ai/pdf-chatbot/lib/store.ts:108) · [chat/route.ts:61](vscode://file/home/crest/study/ai/pdf-chatbot/app/api/chat/route.ts:61) |
| 7b | **The LLM** | Configure Groq Llama 3.3 (temp 0.2, stream) | [chat/route.ts:70](vscode://file/home/crest/study/ai/pdf-chatbot/app/api/chat/route.ts:70) |
| 6c | **History → messages** | Prior turns become LangChain messages | [chat/route.ts:79](vscode://file/home/crest/study/ai/pdf-chatbot/app/api/chat/route.ts:79) |
| 7a | **Grounding prompt** | System rules that forbid hallucination | [chat/route.ts:15](vscode://file/home/crest/study/ai/pdf-chatbot/app/api/chat/route.ts:15) |
| 7a | **Build prompt** | system + excerpts + history + question | [chat/route.ts:90](vscode://file/home/crest/study/ai/pdf-chatbot/app/api/chat/route.ts:90) |
| 7c | **Run chain (LCEL)** | `prompt.pipe(model).stream(...)` | [chat/route.ts:99](vscode://file/home/crest/study/ai/pdf-chatbot/app/api/chat/route.ts:99) |
| 7d | **Stream out** | Push each token to the HTTP response | [chat/route.ts:109](vscode://file/home/crest/study/ai/pdf-chatbot/app/api/chat/route.ts:109) |
| 7e | **Live typing** | Browser reads stream, appends tokens | [PdfChat.tsx:111](vscode://file/home/crest/study/ai/pdf-chatbot/components/PdfChat.tsx:111) |

---

## 💾 Persistence — where "context" lives

| Kind | What | Open in VS Code |
| --- | --- | --- |
| 6a | **Document vectors** (server RAM, `globalThis`) | [store.ts:24](vscode://file/home/crest/study/ai/pdf-chatbot/lib/store.ts:24) |
| 3e | **Embedding model** (loaded once, shared) | [embeddings.ts:33](vscode://file/home/crest/study/ai/pdf-chatbot/lib/embeddings.ts:33) |
| 6b | **Session id** (browser, per tab) | [PdfChat.tsx:14](vscode://file/home/crest/study/ai/pdf-chatbot/components/PdfChat.tsx:14) |
| 6c | **Chat history** (browser React state) | [PdfChat.tsx:98](vscode://file/home/crest/study/ai/pdf-chatbot/components/PdfChat.tsx:98) |

---

## 🎯 The two AI models at a glance

| Component | Open in VS Code | Role |
| --- | --- | --- |
| **#1 Embedding model** (local, free) | [embeddings.ts:13](vscode://file/home/crest/study/ai/pdf-chatbot/lib/embeddings.ts:13) | Text → vectors (retrieval) |
| **#2 Groq Llama 3.3** (cloud, free tier) | [chat/route.ts:70](vscode://file/home/crest/study/ai/pdf-chatbot/app/api/chat/route.ts:70) | Vectors' text → written answer |

---

## 📋 Plain `path:line` reference (terminal / GitHub friendly)

Copy-paste into a terminal as `code -g <path>:<line>`:

```
UPLOAD
  1   app/api/ingest/route.ts:34      PDF -> text
  1   lib/pdf.ts:15                   pdf-parse extraction
  2   lib/store.ts:58                 chunking
  3   lib/embeddings.ts:51            embedDocuments (chunks -> vectors)
  3c  lib/embeddings.ts:59            pooling + normalize
  4   lib/store.ts:81                 MemoryVectorStore.fromDocuments (index)

CHAT
  6b  components/PdfChat.tsx:14        session id
  6c  components/PdfChat.tsx:98        send full history
  5   lib/embeddings.ts:76            embedQuery (question -> vector)
  5   lib/store.ts:108                similaritySearch (top-5)
  5   app/api/chat/route.ts:61        retrieveContext call
  7b  app/api/chat/route.ts:70        ChatGroq (LLM)
  6c  app/api/chat/route.ts:79        history -> messages
  7a  app/api/chat/route.ts:15        SYSTEM_PROMPT (grounding)
  7a  app/api/chat/route.ts:90        build ChatPromptTemplate
  7c  app/api/chat/route.ts:99        chain = prompt.pipe(model).stream
  7d  app/api/chat/route.ts:109       server streams tokens out
  7e  components/PdfChat.tsx:111       client reads stream (live typing)

PERSISTENCE
  6a  lib/store.ts:24                 globalThis.__pdfStores (doc vectors)
  3e  lib/embeddings.ts:33            model loaded once
```

> 📖 For the full conceptual explanation of each step (tokens, embeddings,
> pooling, cosine similarity, persistence), see **[AI_FLOW.md](./AI_FLOW.md)**.
