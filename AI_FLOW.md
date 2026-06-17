# 🧠 AI Flow — How Tokens, Embeddings & Context Work in This Project

This document explains the **AI internals** of the PDF Chatbot: how text becomes
tokens, how tokens become embeddings (vectors), how those vectors are searched,
how the context is assembled for the LLM, and **where/how state persists**.

It maps every concept to the exact code in this repo.

---

## 0. The mental model: RAG (Retrieval-Augmented Generation)

The LLM (Groq's Llama 3.3) **never reads your whole PDF.** That would be slow,
expensive, and hit context limits. Instead:

1. **Index once (on upload):** the PDF is cut into small pieces and each piece is
   converted into a *vector* (a list of numbers that encodes meaning).
2. **Retrieve per question:** the question is also turned into a vector, and we
   find the few PDF pieces whose vectors are *closest* to it.
3. **Generate:** only those few pieces are pasted into the prompt, and the LLM
   writes an answer grounded in them.

```
UPLOAD (index):   PDF ─► text ─► chunks ─► tokens ─► embeddings(vectors) ─► vector store
ASK   (retrieve): question ─► tokens ─► embedding ─► nearest chunks ─► prompt ─► LLM ─► answer
```

Two different models do two different jobs:

| Model | Where it runs | Job | Cost |
| --- | --- | --- | --- |
| `all-MiniLM-L6-v2` (embeddings) | **Locally**, in Node | Turn text into vectors (retrieval) | Free |
| `llama-3.3-70b-versatile` (LLM) | Groq cloud | Write the answer from retrieved text | Free tier |

---

## 1. From PDF to text

**File:** `lib/pdf.ts` · **Called by:** `app/api/ingest/route.ts`

```ts
const data = await pdfParse(buffer);   // pdf-parse extracts the text layer
return { text: data.text.trim(), numPages: data.numpages };
```

- `pdf-parse` reads the PDF's **text layer** (the actual characters embedded in
  the file).
- If a PDF is a **scanned image**, there is no text layer → `text` is empty. The
  ingest route rejects it (`text.length < 10`) with a clear message. (Supporting
  scans would require OCR, e.g. Tesseract.)

---

## 2. Chunking — why and how

**File:** `lib/store.ts` → `ingestPdf()` (lines 49–61)

```ts
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,      // ~1000 characters per chunk
  chunkOverlap: 150,    // each chunk repeats the last 150 chars of the previous one
});
const chunks = await splitter.splitText(text);
```

**Why chunk at all?**
- Embedding models have a **maximum input length** (see §3). A whole PDF won't fit.
- Retrieval is **more precise** on small pieces — you get the exact paragraph that
  answers the question instead of a whole page of noise.

**Why `RecursiveCharacterTextSplitter`?**
It tries to split on natural boundaries first — paragraphs (`\n\n`), then lines
(`\n`), then sentences, then words — so chunks stay semantically coherent rather
than being cut mid-word.

**Why the 150-char overlap?**
A fact may straddle a boundary ("...the notice period is | 30 days..."). Overlap
makes sure each idea appears whole in at least one chunk, so retrieval never
loses it at the seam.

Each chunk is wrapped in a LangChain `Document` with metadata so we can trace it
back later:

```ts
new Document({
  pageContent: chunk,
  metadata: { source: fileName, chunk: i },   // chunk index = its "source" id
});
```

---

## 3. Tokens & Embeddings — the core of the AI

**File:** `lib/embeddings.ts` (the `LocalEmbeddings` class)

This is where text becomes numbers. It happens in **three internal stages**,
all inside the transformers.js `feature-extraction` pipeline:

### 3a. Tokenization (text → tokens)

When you call the extractor on a string, the model **first tokenizes** it:

```
"the notice period is 30 days"
   ──► ["the", "notice", "period", "is", "30", "days"]   (conceptually)
   ──► [101, 1996, 4034, 2558, 2003, 2382, 2420, 102]    (token IDs the model understands)
```

- `all-MiniLM-L6-v2` uses a **WordPiece** tokenizer with a fixed vocabulary
  (~30k tokens). Rare words are split into sub-word pieces (e.g. "tokenization"
  → "token" + "##ization").
- Special tokens `[CLS]` (101) and `[SEP]` (102) are added at the start/end.
- The model has a **max of 256–512 tokens** per input — which is exactly *why*
  we chunk in §2.

> You don't call the tokenizer directly — transformers.js does it inside the
> pipeline. But this is the literal answer to "how are tokens created": the
> tokenizer maps characters → vocabulary token IDs.

### 3b. Model forward pass (tokens → per-token vectors)

The token IDs are run through the transformer network (6 layers — the "L6" in
the name). The output is **one vector per token** (each 384 numbers wide):

```
8 tokens ──► matrix of shape [8 × 384]
```

### 3c. Pooling + normalization (per-token vectors → one vector)

We need **one** vector for the whole chunk, not one per token. That's what these
options do (lines 43–46 and 55–57):

```ts
const output = await extractor(text, {
  pooling: "mean",     // average all the per-token vectors into ONE 384-d vector
  normalize: true,     // scale it to length 1 (unit vector)
});
vectors.push(Array.from(output.data as Float32Array));   // → number[] of length 384
```

- **`pooling: "mean"`** → averages the per-token vectors into a single 384-number
  vector that represents the *meaning of the whole chunk*.
- **`normalize: true`** → rescales the vector to length 1. This makes
  similarity comparison fast and consistent (cosine similarity becomes a simple
  dot product). **This is critical** — without it, similarity scores would be
  skewed by text length.

**Result:** every chunk and every question becomes a point in 384-dimensional
space. Texts with similar meaning land close together; unrelated texts land far
apart. *That* spatial closeness is what we search.

### 3d. Two entry points

```ts
embedDocuments(texts: string[]): Promise<number[][]>   // many chunks → many vectors  (used at UPLOAD)
embedQuery(text: string):        Promise<number[]>     // one question → one vector    (used at CHAT)
```

Both go through the **same model**, so a question and the chunks that answer it
are embedded into the *same* vector space — the only way the comparison is
meaningful.

### 3e. Why it's free & loaded once

```ts
private async getExtractor() {
  if (!this.extractorPromise) {
    this.extractorPromise = import("@huggingface/transformers")
      .then(({ pipeline }) => pipeline("feature-extraction", this.modelName));
  }
  return this.extractorPromise;     // model loaded ONCE, then reused forever
}
```

- The model (~25 MB) downloads on **first use**, caches to disk, and runs
  **locally** on the CPU — no API key, no per-call cost.
- `extractorPromise` caches the loaded pipeline so the model isn't reloaded on
  every request.
- The `import(...)` is **dynamic** so this Node-only dependency is never bundled
  into the browser.

---

## 4. The vector store — indexing the embeddings

**File:** `lib/store.ts` → `ingestPdf()` (line 63)

```ts
const store = await MemoryVectorStore.fromDocuments(docs, embeddings);
```

- `MemoryVectorStore.fromDocuments` internally calls
  `embeddings.embedDocuments(allChunks)` (§3) and stores each
  **(chunk text, metadata, vector)** triple **in RAM**.
- It's an **in-memory** store — no database, no setup. Trade-off: it lives only
  as long as the Node process (see §6 on persistence).

---

## 5. Retrieval — finding the right chunks

**File:** `lib/store.ts` → `retrieveContext()` (lines 77–92)

```ts
const results = await entry.store.similaritySearch(query, k);   // k = 5
```

What `similaritySearch` does under the hood:
1. Embeds the **question** with `embedQuery` (§3) → one 384-d vector.
2. Compares it against **every stored chunk vector** using **cosine similarity**
   (because vectors are normalized, this is just a dot product).
3. Returns the **top `k=5`** most similar chunks.

Then we format them into a single context string and record which chunks were
used:

```ts
const context = results
  .map((r, i) => `[Excerpt ${i + 1}]\n${r.pageContent}`)
  .join("\n\n");
const sources = results.map((r) => r.metadata?.chunk ?? -1);   // chunk indices used
```

> `sources` is returned to the chat route and sent back as an `X-Sources` HTTP
> header, so a UI could show "answer based on chunks 3, 7, 12."

---

## 6. ⭐ How context PERSISTS — two very different kinds

This is the part people most often confuse. There are **two** separate notions
of "context" in this app, persisted in two different ways.

### 6a. Document context (the PDF's vectors) — persists **server-side, in memory**

**File:** `lib/store.ts` (lines 23–35)

```ts
const globalForStore = globalThis as unknown as {
  __pdfStores?: Map<string, StoreEntry>;
  __embeddings?: LocalEmbeddings;
};

const embeddings = globalForStore.__embeddings ?? new LocalEmbeddings();
globalForStore.__embeddings = embeddings;

const stores: Map<string, StoreEntry> = globalForStore.__pdfStores ?? new Map();
globalForStore.__pdfStores = stores;
```

- Each uploaded PDF's vector store is kept in a **`Map` keyed by `sessionId`**:
  `sessionId → { store, fileName, numPages, numChunks, createdAt }`.
- The `Map` (and the loaded embedding model) are hung off **`globalThis`**. Why?
  In Next.js dev, hot-reload re-imports modules; attaching to `globalThis` means
  the store and the model **survive hot-reloads** instead of being recreated.
- **Lifetime:** as long as the Node server process runs. A **full server
  restart wipes it** — which is exactly why uploads had to be re-done after every
  restart during testing. (For true persistence, swap `MemoryVectorStore` for
  Chroma / pgvector / Pinecone — see README.)
- **A new upload for the same session replaces the old store** (`stores.set(...)`
  in `ingestPdf`), so re-uploading resets that session's document.

### 6b. The `sessionId` — links a browser tab to its document

**File:** `components/PdfChat.tsx`

```ts
function makeSessionId() {
  return "sess-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const [sessionId] = useState(makeSessionId);   // generated once per tab
```

- The browser generates a random `sessionId` **once per tab** and sends it with
  **every** `/api/ingest` and `/api/chat` request.
- The server uses it as the `Map` key, so each tab only sees its own PDF. It is
  **not** stored in a cookie or DB — refresh the page and you get a new session
  (and must re-upload).

### 6c. Conversation context (chat history) — persists **client-side, in React state**

**File:** `components/PdfChat.tsx` → `messages` state; sent in `send()`

```ts
const next: Message[] = [...messages, { role: "user", content: question }];
...
body: JSON.stringify({ sessionId, messages: next }),   // FULL history sent each time
```

- The chatbot has **no server-side memory of the conversation.** The entire
  message list lives in React state in the browser.
- On every question, the **whole history is re-sent** to `/api/chat`.
- The server then feeds prior turns to the LLM as conversation history
  (`app/api/chat/route.ts`, lines 74–80):

```ts
const history = messages
  .slice(0, messages.lastIndexOf(lastUser))   // everything before the new question
  .map((m) => m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content));
```

  This is why follow-up questions ("and who signed it?") understand what "it"
  refers to — the model sees the earlier turns. **Lifetime:** until you refresh
  or click "New PDF" (which clears `messages`).

### Persistence summary

| What | Where it lives | Keyed by | Survives page refresh? | Survives server restart? |
| --- | --- | --- | --- | --- |
| PDF vectors (document context) | Server RAM (`globalThis.__pdfStores`) | `sessionId` | ✅ (store stays) but tab gets new id → re-upload | ❌ |
| Embedding model | Server RAM (`globalThis.__embeddings`) | — | ✅ | ❌ (re-downloads from disk cache) |
| `sessionId` | Browser React state | — | ❌ (new id per load) | n/a |
| Chat history (conversation context) | Browser React state | — | ❌ | n/a |

---

## 7. Assembling the prompt & generating the answer

**File:** `app/api/chat/route.ts`

### 7a. Build the prompt (lines 82–86)

```ts
const prompt = ChatPromptTemplate.fromMessages([
  ["system", SYSTEM_PROMPT],               // rules + {fileName} + {context} (retrieved excerpts)
  new MessagesPlaceholder("history"),      // prior turns (§6c)
  ["human", "{question}"],                 // the new question
]);
```

The `SYSTEM_PROMPT` (lines 15–27) is the **grounding instruction**. The key line:

> *"If the answer is not contained in the excerpts, say you couldn't find it in
> the document instead of inventing an answer."*

This is what makes the bot **stick to your PDF** and reduces hallucination. The
`{context}` placeholder is filled with the 5 retrieved excerpts from §5.

### 7b. The model (lines 66–71)

```ts
const model = new ChatGroq({
  apiKey: groqKey,
  model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  temperature: 0.2,        // low → factual & consistent, not creative
  streaming: true,         // emit tokens as they're generated
});
```

`temperature: 0.2` keeps answers deterministic and faithful to the source —
appropriate for a document Q&A tool.

### 7c. Run the chain (lines 88–95)

```ts
const chain = prompt.pipe(model);          // LCEL: fill template → send to LLM
const stream = await chain.stream({
  fileName: retrieved.fileName,
  context:  retrieved.context,             // the 5 excerpts
  history,                                 // prior turns
  question: lastUser.content,
});
```

`prompt.pipe(model)` is **LCEL** (LangChain Expression Language): it wires the
filled prompt directly into the LLM. `.stream(...)` returns an async iterator of
token chunks instead of waiting for the full answer.

### 7d. Stream tokens to the browser (lines 97–125)

```ts
const readable = new ReadableStream({
  async start(controller) {
    for await (const chunk of stream) {
      const text = typeof chunk.content === "string" ? chunk.content : "";
      if (text) controller.enqueue(encoder.encode(text));   // push each token out
    }
    controller.close();
  },
});
return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8", ... } });
```

The LLM's token stream is re-emitted as an HTTP streaming response.

### 7e. Client reads the stream (`components/PdfChat.tsx` → `send()`)

```ts
const reader = res.body.getReader();
const decoder = new TextDecoder();
let acc = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  acc += decoder.decode(value, { stream: true });
  // update the last assistant message with the accumulated text → live typing effect
}
```

Each decoded chunk is appended to the assistant's message in React state, which
is what produces the word-by-word "typing" effect in the UI.

---

## 8. End-to-end trace (one question)

```
You type:  "What is the notice period?"
  │
  ▼  components/PdfChat.tsx → send()
POST /api/chat  { sessionId, messages:[...history, {user:"What is the notice period?"}] }
  │
  ▼  app/api/chat/route.ts
1. validate GROQ_API_KEY                                   (lines 31–40)
2. pick last user message                                  (line 50)
3. retrieveContext(sessionId, question, 5)                 (line 58)
     └─ lib/store.ts → similaritySearch
          ├─ embedQuery(question)  → 384-d vector          (lib/embeddings.ts)
          ├─ cosine-compare vs all stored chunk vectors
          └─ return top-5 chunks as "context"
4. build ChatPromptTemplate(system+context, history, question)  (lines 82–86)
5. ChatGroq(llama-3.3, temp 0.2, streaming)                (lines 66–71)
6. chain.stream(...)  → token iterator                     (lines 88–95)
7. pipe tokens into a ReadableStream                       (lines 97–117)
  │
  ▼  HTTP streamed text/plain
components/PdfChat.tsx reads stream → appends tokens → live answer on screen
```

---

## 9. File-to-concept cheat sheet

| Concept | File | Symbol |
| --- | --- | --- |
| PDF → text | `lib/pdf.ts` | `extractPdfText` |
| Chunking | `lib/store.ts` | `RecursiveCharacterTextSplitter` |
| Tokenization + embedding | `lib/embeddings.ts` | `LocalEmbeddings.embed*` |
| Vector store (index) | `lib/store.ts` | `MemoryVectorStore.fromDocuments` |
| Retrieval (search) | `lib/store.ts` | `retrieveContext` / `similaritySearch` |
| Document-context persistence | `lib/store.ts` | `globalThis.__pdfStores` Map |
| Session id | `components/PdfChat.tsx` | `makeSessionId` |
| Conversation persistence | `components/PdfChat.tsx` | `messages` state |
| Prompt assembly | `app/api/chat/route.ts` | `ChatPromptTemplate` |
| LLM call + streaming | `app/api/chat/route.ts` | `ChatGroq` + `chain.stream` |
| Live typing in UI | `components/PdfChat.tsx` | `reader.read()` loop |

---

## 10. Quick glossary

- **Token** — a sub-word unit from the model's fixed vocabulary; text is converted
  to a list of token IDs before the model can process it.
- **Embedding / vector** — a list of numbers (here, 384) that encodes the *meaning*
  of a piece of text. Similar meaning → nearby vectors.
- **Pooling** — combining many per-token vectors into one (we use the mean).
- **Cosine similarity** — measures the angle between two vectors; the closer to 1,
  the more similar the meanings. With normalized vectors it's just a dot product.
- **Chunk** — a ~1000-char slice of the PDF that is embedded and stored as one unit.
- **Vector store** — the structure holding all chunk vectors so they can be searched.
- **RAG** — Retrieval-Augmented Generation: retrieve relevant text, then let the LLM
  generate an answer using it.
- **LCEL** — LangChain Expression Language; the `prompt.pipe(model)` composition style.
