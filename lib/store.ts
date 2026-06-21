import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "@langchain/core/documents";
import { Index as UpstashIndex } from "@upstash/vector";
import { LocalEmbeddings } from "./embeddings";

/**
 * RAG store with TWO interchangeable backends, chosen automatically:
 *
 *  • UPSTASH (serverless / Vercel): a serverless HTTP vector DB that ALSO does
 *    the embeddings (the index is created with a built-in embedding model, so we
 *    upsert raw text and it embeds server-side). Required on serverless hosts
 *    because state must persist across separate function invocations and there
 *    is no local filesystem for a model.
 *    → Active when UPSTASH_VECTOR_REST_URL + UPSTASH_VECTOR_REST_TOKEN are set.
 *
 *  • IN-MEMORY (local dev / Render): LangChain MemoryVectorStore + the local
 *    transformers.js model. Zero external services, but lives only in the
 *    server process.
 *    → The fallback when no Upstash env is present.
 *
 * Both expose the same ingestPdf() / retrieveContext() API to the routes.
 */

const useUpstash = !!(
  process.env.UPSTASH_VECTOR_REST_URL && process.env.UPSTASH_VECTOR_REST_TOKEN
);

// Shared text splitter (same chunking strategy for both backends).
function makeSplitter() {
  return new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 150,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// UPSTASH BACKEND
// ─────────────────────────────────────────────────────────────────────────
let upstash: UpstashIndex | null = null;
function getUpstash(): UpstashIndex {
  if (!upstash) {
    upstash = new UpstashIndex({
      url: process.env.UPSTASH_VECTOR_REST_URL!,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
    });
  }
  return upstash;
}

async function ingestUpstash(params: {
  sessionId: string;
  fileName: string;
  text: string;
}): Promise<{ numChunks: number }> {
  const ns = getUpstash().namespace(params.sessionId);

  // A new upload replaces the previous document for this session.
  try {
    await ns.reset();
  } catch {
    /* namespace may not exist yet — fine */
  }

  const chunks = await makeSplitter().splitText(params.text);

  // `data` makes Upstash embed the text server-side. We keep the raw text and
  // tracing info in metadata so retrieval can return the passage + its source.
  const vectors = chunks.map((chunk, i) => ({
    id: `${params.sessionId}-${i}`,
    data: chunk,
    metadata: { text: chunk, source: params.fileName, chunk: i },
  }));

  // Upsert in batches to stay well within request-size limits.
  const BATCH = 50;
  for (let i = 0; i < vectors.length; i += BATCH) {
    await ns.upsert(vectors.slice(i, i + BATCH) as any);
  }

  return { numChunks: vectors.length };
}

async function retrieveUpstash(
  sessionId: string,
  query: string,
  k: number
): Promise<{ context: string; sources: number[]; fileName: string } | null> {
  const ns = getUpstash().namespace(sessionId);
  const results = await ns.query({
    data: query, // embedded server-side with the same model used at ingest
    topK: k,
    includeMetadata: true,
  });

  if (!results || results.length === 0) return null;

  const context = results
    .map((r, i) => `[Excerpt ${i + 1}]\n${(r.metadata as any)?.text ?? ""}`)
    .join("\n\n");
  const sources = results.map(
    (r) => ((r.metadata as any)?.chunk as number) ?? -1
  );
  const fileName = (results[0].metadata as any)?.source ?? "the document";

  return { context, sources, fileName };
}

// ─────────────────────────────────────────────────────────────────────────
// IN-MEMORY BACKEND (local dev / Render). State hangs off globalThis so it
// survives Next.js hot-reloads in dev.
// ─────────────────────────────────────────────────────────────────────────
type StoreEntry = {
  store: MemoryVectorStore;
  fileName: string;
  numPages: number;
  numChunks: number;
  createdAt: number;
};

const globalForStore = globalThis as unknown as {
  __pdfStores?: Map<string, StoreEntry>;
  __embeddings?: LocalEmbeddings;
};

const embeddings = globalForStore.__embeddings ?? new LocalEmbeddings();
globalForStore.__embeddings = embeddings;

const stores: Map<string, StoreEntry> =
  globalForStore.__pdfStores ?? new Map();
globalForStore.__pdfStores = stores;

async function ingestMemory(params: {
  sessionId: string;
  fileName: string;
  text: string;
  numPages: number;
}): Promise<{ numChunks: number }> {
  const chunks = await makeSplitter().splitText(params.text);
  const docs = chunks.map(
    (chunk, i) =>
      new Document({
        pageContent: chunk,
        metadata: { source: params.fileName, chunk: i },
      })
  );
  const store = await MemoryVectorStore.fromDocuments(docs, embeddings);
  stores.set(params.sessionId, {
    store,
    fileName: params.fileName,
    numPages: params.numPages,
    numChunks: docs.length,
    createdAt: Date.now(),
  });
  return { numChunks: docs.length };
}

async function retrieveMemory(
  sessionId: string,
  query: string,
  k: number
): Promise<{ context: string; sources: number[]; fileName: string } | null> {
  const entry = stores.get(sessionId);
  if (!entry) return null;
  const results = await entry.store.similaritySearch(query, k);
  const context = results
    .map((r, i) => `[Excerpt ${i + 1}]\n${r.pageContent}`)
    .join("\n\n");
  const sources = results.map((r) => (r.metadata?.chunk as number) ?? -1);
  return { context, sources, fileName: entry.fileName };
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API — routes call these; the backend is chosen automatically.
// ─────────────────────────────────────────────────────────────────────────

/** Chunk → embed → store the PDF text under `sessionId`. */
export async function ingestPdf(params: {
  sessionId: string;
  fileName: string;
  text: string;
  numPages: number;
}): Promise<{ numChunks: number }> {
  return useUpstash ? ingestUpstash(params) : ingestMemory(params);
}

/** Retrieve the most relevant chunks for a question. */
export async function retrieveContext(
  sessionId: string,
  query: string,
  k = 5
): Promise<{ context: string; sources: number[]; fileName: string } | null> {
  return useUpstash
    ? retrieveUpstash(sessionId, query, k)
    : retrieveMemory(sessionId, query, k);
}

/** Which backend is active (handy for debugging / health checks). */
export function activeBackend(): "upstash" | "memory" {
  return useUpstash ? "upstash" : "memory";
}
