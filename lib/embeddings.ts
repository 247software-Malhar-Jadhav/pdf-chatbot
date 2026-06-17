import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";

/**
 * Local, free embeddings powered by transformers.js (@huggingface/transformers).
 *
 * The model runs entirely on the server machine — no API key, no network calls
 * after the first download (the model is cached on disk). This keeps the whole
 * RAG pipeline free.
 *
 * Default model: Xenova/all-MiniLM-L6-v2 (384-dim, fast, solid quality).
 */
// ═════════════════════════════════════════════════════════════════════════
// AI COMPONENT #1 — THE EMBEDDING MODEL (runs locally, free).
// Converts text into 384-dimensional vectors that capture *meaning*.
// Used in two places: indexing the PDF (upload) and embedding the question (chat).
// ═════════════════════════════════════════════════════════════════════════
export class LocalEmbeddings extends Embeddings {
  private modelName: string;
  // The transformers.js pipeline is lazily created once and reused.
  private extractorPromise: Promise<any> | null = null;

  constructor(
    fields?: EmbeddingsParams & { model?: string }
  ) {
    super(fields ?? {});
    this.modelName =
      fields?.model ||
      process.env.EMBEDDING_MODEL ||
      "Xenova/all-MiniLM-L6-v2";
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3e — Load the model ONCE, reuse forever.
  // The ~25MB model downloads on first use, caches to disk, and runs locally
  // on the CPU (no API key, no per-call cost). `extractorPromise` memoises it.
  // The dynamic import() keeps this Node-only package out of the browser bundle.
  // ═══════════════════════════════════════════════════════════════════════
  private async getExtractor() {
    if (!this.extractorPromise) {
      this.extractorPromise = import("@huggingface/transformers").then(
        ({ pipeline }) => pipeline("feature-extraction", this.modelName)
      );
    }
    return this.extractorPromise;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3 (UPLOAD) — Turn many chunks into many vectors.
  // Called by MemoryVectorStore.fromDocuments() during ingestion.
  // ═══════════════════════════════════════════════════════════════════════
  async embedDocuments(texts: string[]): Promise<number[][]> {
    const extractor = await this.getExtractor();
    const vectors: number[][] = [];
    // Process sequentially to keep memory predictable for large PDFs.
    for (const text of texts) {
      // Inside extractor(): (3a) tokenize text -> token IDs,
      // (3b) run the 6-layer model -> one vector per token.
      const output = await extractor(text, {
        // STEP 3c — pooling+normalize: average the per-token vectors into ONE
        // 384-d vector ("mean"), then scale it to length 1 ("normalize") so
        // cosine similarity later becomes a simple, length-independent dot product.
        pooling: "mean",
        normalize: true,
      });
      // The Float32Array of 384 numbers IS the embedding for this chunk.
      vectors.push(Array.from(output.data as Float32Array));
    }
    return vectors;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3 (CHAT) — Turn ONE question into ONE vector.
  // Uses the SAME model as embedDocuments, so the question and the chunks live
  // in the same 384-d space and can be meaningfully compared (see STEP 5).
  // ═══════════════════════════════════════════════════════════════════════
  async embedQuery(text: string): Promise<number[]> {
    const extractor = await this.getExtractor();
    const output = await extractor(text, {
      pooling: "mean",
      normalize: true,
    });
    return Array.from(output.data as Float32Array);
  }
}
