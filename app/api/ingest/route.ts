import { NextRequest, NextResponse } from "next/server";
import { extractPdfText } from "@/lib/pdf";
import { ingestPdf } from "@/lib/store";

// transformers.js + pdf-parse need the Node runtime (not the edge runtime).
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const sessionId = formData.get("sessionId");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file uploaded." },
        { status: 400 }
      );
    }
    if (typeof sessionId !== "string" || !sessionId) {
      return NextResponse.json(
        { error: "Missing session id." },
        { status: 400 }
      );
    }
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF files are supported." },
        { status: 400 }
      );
    }

    // ── STEP 1 — PDF -> TEXT. Reads the PDF's text layer (lib/pdf.ts).
    const buffer = Buffer.from(await file.arrayBuffer());
    const { text, numPages } = await extractPdfText(buffer);

    // A scanned/image-only PDF has no text layer -> reject (would need OCR).
    if (!text || text.length < 10) {
      return NextResponse.json(
        {
          error:
            "Could not extract text from this PDF. It may be a scanned/image-only document.",
        },
        { status: 422 }
      );
    }

    // ── STEPS 2-4 — chunk -> embed -> store in memory (lib/store.ts).
    const { numChunks } = await ingestPdf({
      sessionId,
      fileName: file.name,
      text,
      numPages,
    });

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      numPages,
      numChunks,
      chars: text.length,
    });
  } catch (err) {
    console.error("[ingest] error:", err);
    return NextResponse.json(
      { error: "Failed to process the PDF." },
      { status: 500 }
    );
  }
}
