import ReactMarkdown from "react-markdown";
import { useCallback, useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";

type Msg = { id: string; role: Role; content: string };

function id() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setError(null);
    setInput("");
    const userMsg: Msg = { id: id(), role: "user", content: text };
    const assistantId = id();
    const assistantMsg: Msg = { id: assistantId, role: "assistant", content: "" };

    const historyForApi = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setLoading(true);

    let streamFailed = false;
    let gotReply = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historyForApi }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        buf = buf.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as { text?: string; error?: string };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text !== undefined && parsed.text !== "") {
              gotReply = true;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + parsed.text }
                    : m
                )
              );
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } catch (e) {
      streamFailed = true;
      setError(e instanceof Error ? e.message : "Something went wrong");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setLoading(false);
    }

    if (!streamFailed && !gotReply) {
      setError(
        "No reply was received. Add OPENAI_API_KEY/ANTHROPIC_API_KEY, run Ollama, or set MOCK_MODE=true for offline fallback."
      );
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    }
  }

  function clearChat() {
    if (loading) return;
    setMessages([]);
    setError(null);
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-10 border-b border-black/5 bg-surface/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
              Assistant
            </h1>
            <p className="text-[11px] leading-snug text-ink-muted sm:text-xs">
              Cloud keys, local Ollama, or offline MOCK_MODE (no API).
            </p>
          </div>
          <button
            type="button"
            onClick={clearChat}
            disabled={loading || messages.length === 0}
            className="min-h-[44px] shrink-0 touch-manipulation rounded-lg border border-black/10 bg-surface-card px-3 py-2 text-sm text-ink-muted transition active:bg-surface-muted hover:bg-surface-muted hover:text-ink disabled:opacity-40"
          >
            New chat
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-[max(9rem,calc(6.5rem+env(safe-area-inset-bottom,0px)))] pt-5 sm:pt-6">
        {messages.length === 0 && !loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center sm:px-4">
            <p className="text-base text-ink-muted sm:text-[15px]">
              Ask anything from your phone — same chat, streaming replies.
            </p>
            <p className="max-w-md text-left text-sm leading-relaxed text-ink-faint sm:text-center">
              <span className="font-medium text-ink-muted">On Render:</span> set{" "}
              <code className="rounded bg-surface-muted px-1 font-mono text-[13px]">OPENAI_API_KEY</code> (or Anthropic)
              in Environment. <span className="font-medium text-ink-muted">At home:</span> same in{" "}
              <code className="rounded bg-surface-muted px-1 font-mono text-[13px]">.env.local</code>, or use Ollama with no
              cloud key.
            </p>
          </div>
        )}

        <ul className="flex flex-col gap-6">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-3 text-surface shadow-sm"
                    : "max-w-[95%] rounded-2xl rounded-bl-md border border-black/6 bg-surface-card px-4 py-3 text-ink shadow-sm"
                }
              >
                {m.role === "user" ? (
                  <p className="whitespace-pre-wrap text-base leading-relaxed sm:text-[15px]">
                    {m.content}
                  </p>
                ) : (
                  <div className="prose-assistant text-base leading-relaxed text-ink sm:text-[15px]">
                    {m.content ? (
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    ) : loading ? (
                      <span className="text-ink-faint">Thinking…</span>
                    ) : null}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <div ref={bottomRef} />
      </main>

      <div className="fixed bottom-0 left-0 right-0 border-t border-black/5 bg-surface/95 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pt-3 backdrop-blur-md">
        <form
          className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            rows={2}
            enterKeyHint="send"
            inputMode="text"
            autoComplete="off"
            autoCorrect="on"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message…"
            disabled={loading}
            className="min-h-[52px] flex-1 resize-none rounded-xl border border-black/10 bg-surface-card px-4 py-3 text-base text-ink shadow-inner outline-none ring-accent/30 placeholder:text-ink-faint focus:border-accent/40 focus:ring-2 disabled:opacity-50 sm:min-h-[48px] sm:text-[15px]"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="min-h-[48px] w-full touch-manipulation rounded-xl bg-accent px-5 py-3 text-base font-medium text-white shadow-sm transition active:bg-accent-hover hover:bg-accent-hover disabled:opacity-40 sm:min-h-[48px] sm:w-auto sm:shrink-0 sm:text-sm"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
