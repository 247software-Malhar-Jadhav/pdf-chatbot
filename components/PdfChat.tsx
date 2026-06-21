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

// Tiny markdown renderer: **bold**, `code`, and line breaks. Keeps answers tidy
// without pulling in a full markdown dependency.
function renderRich(text: string) {
  const lines = text.split("\n");
  return lines.map((line, li) => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
    return (
      <span key={li}>
        {parts.map((p, pi) => {
          if (p.startsWith("**") && p.endsWith("**")) {
            return (
              <strong key={pi} className="font-semibold text-white">
                {p.slice(2, -2)}
              </strong>
            );
          }
          if (p.startsWith("`") && p.endsWith("`")) {
            return (
              <code
                key={pi}
                className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em]"
              >
                {p.slice(1, -1)}
              </code>
            );
          }
          return <span key={pi}>{p}</span>;
        })}
        {li < lines.length - 1 && <br />}
      </span>
    );
  });
}

const SUGGESTIONS = [
  "Summarize this document",
  "What are the key points?",
  "List any important dates",
  "Who are the people involved?",
];

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
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  // Auto-grow the composer textarea up to a max height.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

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
          content: `I've read **${data.fileName}** — ${data.numPages} page${
            data.numPages === 1 ? "" : "s"
          }, indexed into ${data.numChunks} searchable chunks. Ask me anything about it.`,
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

  async function ask(question: string) {
    const q = question.trim();
    if (!q || streaming || !doc) return;
    setError(null);
    setInput("");

    const next: Message[] = [...messages, { role: "user", content: q }];
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

  const showSuggestions = doc && messages.length <= 1 && !streaming;

  return (
    <main className="mx-auto flex h-[100dvh] max-w-3xl flex-col px-4">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-white/5 py-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-lg shadow-lg shadow-indigo-500/30">
            <span className="drop-shadow">📄</span>
          </div>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">
              <span className="gradient-text">PDF Chatbot</span>
            </h1>
            <p className="text-[11px] text-gray-500">
              Chat with any PDF · LangChain · free models
            </p>
          </div>
        </div>
        {doc && (
          <button
            onClick={reset}
            className="group flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:border-white/20 hover:bg-white/5"
          >
            <svg
              className="h-3.5 w-3.5 transition group-hover:rotate-90"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            New PDF
          </button>
        )}
      </header>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          <span>⚠️</span>
          {error}
        </div>
      )}

      {/* Upload state */}
      {!doc ? (
        <div className="flex flex-1 items-center justify-center pb-16">
          <div className="w-full">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`group relative flex w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed px-8 py-20 text-center transition-all duration-300 ${
                dragActive
                  ? "scale-[1.01] border-indigo-400 bg-indigo-500/10"
                  : "border-white/15 bg-panel/40 hover:border-indigo-400/50 hover:bg-panel/60"
              }`}
            >
              {/* soft glow */}
              <div className="pointer-events-none absolute -top-20 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl transition group-hover:bg-indigo-500/30" />

              {uploading ? (
                <>
                  <div className="mb-5 h-12 w-12 animate-spin-slow rounded-full border-[3px] border-indigo-500/30 border-t-indigo-400" />
                  <p className="text-base font-medium text-gray-200">
                    Reading &amp; indexing your PDF…
                  </p>
                  <p className="mt-1.5 text-xs text-gray-500">
                    First run downloads a small embedding model (~30s, one time).
                  </p>
                </>
              ) : (
                <>
                  <div className="animate-float mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 text-3xl ring-1 ring-white/10">
                    📄
                  </div>
                  <p className="text-lg font-semibold text-white">
                    Drop a PDF here, or{" "}
                    <span className="gradient-text">click to browse</span>
                  </p>
                  <p className="mt-1.5 text-sm text-gray-400">
                    Any PDF works — contracts, papers, manuals, reports…
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                    {["🔒 Runs locally", "🆓 Free models", "⚡ Streaming"].map(
                      (t) => (
                        <span
                          key={t}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-gray-400"
                        >
                          {t}
                        </span>
                      )
                    )}
                  </div>
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
        </div>
      ) : (
        <>
          {/* Doc badge */}
          <div className="mt-3 flex items-center gap-2 self-start rounded-full border border-white/10 bg-panel/60 px-3 py-1.5 text-xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-emerald-400/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="max-w-[40vw] truncate font-medium text-gray-200">
              {doc.fileName}
            </span>
            <span className="text-gray-600">·</span>
            <span className="text-gray-400">{doc.numPages}p</span>
            <span className="text-gray-600">·</span>
            <span className="text-gray-400">{doc.numChunks} chunks</span>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="scroll-thin flex-1 space-y-5 overflow-y-auto py-5"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex animate-fade-up items-start gap-3 ${
                  m.role === "user" ? "flex-row-reverse" : ""
                }`}
              >
                {/* Avatar */}
                <div
                  className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg text-sm ${
                    m.role === "user"
                      ? "bg-white/10 text-gray-300"
                      : "bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-md shadow-indigo-500/30"
                  }`}
                >
                  {m.role === "user" ? "🧑" : "✨"}
                </div>
                {/* Bubble */}
                <div
                  className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "rounded-tr-sm bg-gradient-to-br from-indigo-500 to-indigo-600 text-white"
                      : "glass rounded-tl-sm border border-white/10 text-gray-100"
                  }`}
                >
                  {m.content ? (
                    renderRich(m.content)
                  ) : (
                    <span className="inline-flex gap-1 py-1">
                      <span className="typing-dot text-indigo-300">●</span>
                      <span className="typing-dot text-indigo-300">●</span>
                      <span className="typing-dot text-indigo-300">●</span>
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* Suggested prompts */}
            {showSuggestions && (
              <div className="flex animate-fade-up flex-wrap gap-2 pl-11">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-gray-300 transition hover:border-indigo-400/50 hover:bg-indigo-500/10 hover:text-white"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent pb-5 pt-2">
            <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-panel/80 p-2 shadow-xl shadow-black/30 transition focus-within:border-indigo-400/60 focus-within:ring-2 focus-within:ring-indigo-500/20">
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(input);
                  }
                }}
                rows={1}
                placeholder="Ask something about this PDF…"
                className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-white placeholder-gray-500 outline-none"
              />
              <button
                onClick={() => ask(input)}
                disabled={streaming || !input.trim()}
                aria-label="Send"
                className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {streaming ? (
                  <span className="h-3.5 w-3.5 animate-spin-slow rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-gray-600">
              Answers are generated from your PDF · Enter to send · Shift+Enter for
              newline
            </p>
          </div>
        </>
      )}
    </main>
  );
}
