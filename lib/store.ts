import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "@langchain/core/documents";
import { LocalEmbeddings } from "./embeddings";

/**
 * In-memory RAG store.
 *
 * Each uploaded PDF gets its own vector store, keyed by a session id that the
 * browser generates. Everything lives in the server process — no database
 * required, which keeps the project free and zero-config.
 *
 * We hang state off globalThis so it survives Next.js hot-reloads in dev.
 */
type StoreEntry = {
  store: MemoryVectorStore;
  fileName: string;
  numPages: number;
  numChunks: number;
  createdAt: number;
};

// ═════════════════════════════════════════════════════════════════════════
// STEP 6a — DOCUMENT-CONTEXT PERSISTENCE (server-side, in memory).
// We hang state off globalThis so it survives Next.js hot-reloads in dev.
//   __pdfStores  : Map of  sessionId -> { vector store + metadata }
//   __embeddings : the embedding model, loaded ONCE and shared by all sessions
// Lifetime: as long as the Node process runs. A full server restart wipes this
// (that's why uploads must be redone after a restart).
// ═════════════════════════════════════════════════════════════════════════
const globalForStore = globalThis as unknown as {
  __pdfStores?: Map<string, StoreEntry>;
  __embeddings?: LocalEmbeddings;
};

// Single shared embeddings instance so the local model is loaded only once.
const embeddings =
  globalForStore.__embeddings ?? new LocalEmbeddings();
globalForStore.__embeddings = embeddings;

// sessionId -> that session's indexed PDF. Each browser tab gets its own entry.
const stores: Map<string, StoreEntry> =
  globalForStore.__pdfStores ?? new Map();
globalForStore.__pdfStores = stores;

/**
 * Split raw PDF text into chunks, embed them, and store under `sessionId`.
 * Replaces any existing store for that session (i.e. a new upload resets it).
 */
export async function ingestPdf(params: {
  sessionId: string;
  fileName: string;
  text: string;
  numPages: number;
}): Promise<{ numChunks: number }> {
  const { sessionId, fileName, text, numPages } = params;

  // ── STEP 2 — CHUNKING ──────────────────────────────────────────────────
  // Split the PDF text into ~1000-char pieces with 150-char overlap.
  // Why: embedding models have a max input length, and retrieval is sharper on
  // small pieces. The overlap stops a fact being lost at a chunk boundary.
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 150,
  });

  const chunks = await splitter.splitText(text);
  // Wrap each chunk in a Document; metadata.chunk lets us trace which piece
  // an answer came from (returned later as the X-Sources header).
  const docs = chunks.map(
    (chunk, i) =>
      new Document({
        pageContent: chunk,
        metadata: { source: fileName, chunk: i },
      })
  );

  // ── STEP 4 — INDEXING ──────────────────────────────────────────────────
  // fromDocuments() calls embeddings.embedDocuments() (STEP 3) on every chunk
  // and stores each (text, metadata, vector) triple in RAM. No database.
  const store = await MemoryVectorStore.fromDocuments(docs, embeddings);

  // Save under this session id. A new upload for the same session replaces it.
  stores.set(sessionId, {
    store,
    fileName,
    numPages,
    numChunks: docs.length,
    createdAt: Date.now(),
  });

  return { numChunks: docs.length };
}

/** Retrieve the most relevant chunks for a question. */
export async function retrieveContext(
  sessionId: string,
  query: string,
  k = 5
): Promise<{ context: string; sources: number[]; fileName: string } | null> {
  const entry = stores.get(sessionId);
  if (!entry) return null;

  // ── STEP 5 — RETRIEVAL ─────────────────────────────────────────────────
  // similaritySearch(): (1) embeds the question via embedQuery (STEP 3),
  // (2) compares it to every stored chunk vector with cosine similarity,
  // (3) returns the top-k closest chunks. This is the "R" in RAG.
  const results = await entry.store.similaritySearch(query, k);

  // Stitch the retrieved chunks into one labelled context block for the prompt.
  const context = results
    .map((r, i) => `[Excerpt ${i + 1}]\n${r.pageContent}`)
    .join("\n\n");
  // Which chunk indices were used (surfaced to the client as X-Sources).
  const sources = results.map((r) => (r.metadata?.chunk as number) ?? -1);

  return { context, sources, fileName: entry.fileName };
}

export function hasSession(sessionId: string): boolean {
  return stores.has(sessionId);
}

export function getSessionInfo(sessionId: string): StoreEntry | undefined {
  return stores.get(sessionId);
}
