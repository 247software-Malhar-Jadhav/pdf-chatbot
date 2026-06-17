"use client";

import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

type DocInfo = {
  fileName: string;
  numPages: number;
  numChunks: number;
  chars: number;
};

// ── STEP 6b — SESSION ID. Generated once per browser tab and sent with every
// request. The server uses it to key this tab's PDF vectors (lib/store.ts).
// Not persisted: a page refresh makes a new id, so the PDF must be re-uploaded.
function makeSessionId() {
  return "sess-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function PdfChat() {
  const [sessionId] = useState(makeSessionId);
  const [doc, setDoc] = useState<DocInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  async function handleFile(file: File) {
    setError(null);
    if (file.type && file.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      return;
    }
    setUploading(true);
    setMessages([]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sessionId", sessionId);
      const res = await fetch("/api/ingest", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setDoc({
        fileName: data.fileName,
        numPages: data.numPages,
        numChunks: data.numChunks,
        chars: data.chars,
      });
      setMessages([
        {
          role: "assistant",
          content: `I've read **${data.fileName}** (${data.numPages} page${
            data.numPages === 1 ? "" : "s"
          }, ${data.numChunks} chunks). Ask me anything about it.`,
        },
      ]);
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function send() {
    const question = input.trim();
    if (!question || streaming || !doc) return;
    setError(null);
    setInput("");

    const next: Message[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setStreaming(true);
    // Placeholder assistant message we stream into.
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      // STEP 6c — send the FULL message history so the server can give the LLM
      // conversation context (the server keeps no chat memory of its own).
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, messages: next }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to get a response.");
      }

      // STEP 7e — read the streamed tokens and append them live, producing the
      // word-by-word "typing" effect (mirror of STEP 7d on the server).
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (e: any) {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          content: "⚠️ " + (e.message || "Error generating response."),
        };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }

  function reset() {
    setDoc(null);
    setMessages([]);
    setInput("");
    setError(null);
  }

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col px-4">
      {/* Header */}
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 text-xl">
            📄
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">PDF Chatbot</h1>
            <p className="text-xs text-gray-400">
              Chat with any PDF · LangChain · free models
            </p>
          </div>
        </div>
        {doc && (
          <button
            onClick={reset}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-gray-300 transition hover:bg-white/5"
          >
            New PDF
          </button>
        )}
      </header>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Upload state */}
      {!doc ? (
        <div className="flex flex-1 items-center justify-center pb-16">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 py-16 text-center transition ${
              dragActive
                ? "border-accent bg-accent/10"
                : "border-white/15 bg-panel/60 hover:border-white/30"
            }`}
          >
            {uploading ? (
              <>
                <div className="mb-4 h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <p className="text-gray-300">
                  Reading & indexing your PDF…
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  First run downloads a small embedding model (~30s).
                </p>
              </>
            ) : (
              <>
                <div className="mb-3 text-4xl">⬆️</div>
                <p className="text-lg font-medium text-white">
                  Drop a PDF here, or click to browse
                </p>
                <p className="mt-1 text-sm text-gray-400">
                  Any PDF works — contracts, papers, manuals, reports…
                </p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Doc badge */}
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-panel/70 px-3 py-2 text-xs text-gray-400">
            <span className="text-accent">●</span>
            <span className="font-medium text-gray-200">{doc.fileName}</span>
            <span>·</span>
            <span>{doc.numPages} pages</span>
            <span>·</span>
            <span>{doc.numChunks} chunks indexed</span>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="scroll-thin flex-1 space-y-4 overflow-y-auto pb-4"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-accent text-white"
                      : "bg-panel text-gray-100"
                  }`}
                >
                  {m.content || (
                    <span className="inline-flex gap-1">
                      <span className="typing-dot">●</span>
                      <span className="typing-dot">●</span>
                      <span className="typing-dot">●</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent pb-5 pt-2">
            <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-panel/80 p-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="Ask something about this PDF…"
                className="max-h-32 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-white placeholder-gray-500 outline-none"
              />
              <button
                onClick={send}
                disabled={streaming || !input.trim()}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40 enabled:hover:bg-indigo-500"
              >
                {streaming ? "…" : "Send"}
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-gray-600">
              Answers are generated from your PDF. Enter to send · Shift+Enter
              for newline.
            </p>
          </div>
        </>
      )}
    </main>
  );
}
