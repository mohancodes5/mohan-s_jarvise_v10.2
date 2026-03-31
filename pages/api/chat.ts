import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    responseLimit: false,
  },
};

type ChatMessage = { role: "user" | "assistant"; content: string };

function buildOfflineReply(input: string): string {
  const text = input.trim();
  if (!text) return "Please type a message.";
  const low = text.toLowerCase();

  if (low.includes("hello") || low.includes("hi")) {
    return "Hello! I am running in offline mode (no API key).";
  }
  if (low.includes("time")) {
    return `Current server time: ${new Date().toLocaleString()}`;
  }
  if (low.includes("help")) {
    return [
      "Offline mode is active.",
      "- No cloud APIs are used.",
      "- Responses are basic and rule-based.",
      "- Add OPENAI_API_KEY or ANTHROPIC_API_KEY for full AI replies.",
    ].join("\n");
  }

  return [
    "Offline mode reply:",
    "",
    `You said: "${text}"`,
    "",
    "For full AI responses, set OPENAI_API_KEY or ANTHROPIC_API_KEY.",
  ].join("\n");
}

async function streamOffline(
  messages: ChatMessage[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
) {
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const reply = buildOfflineReply(lastUser);

  for (const word of reply.split(" ")) {
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify({ text: `${word} ` })}\n\n`)
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function ollamaContentToString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const t = (part as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

async function streamOllama(
  messages: ChatMessage[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
) {
  const base = (
    process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
  ).replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";

  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });
  } catch (e) {
    const hint = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Cannot reach Ollama at ${base} (${hint}). On Render set OPENAI_API_KEY or ANTHROPIC_API_KEY — Ollama only works where it is actually running. On your PC, run \`ollama serve\` and \`ollama pull ${model}\`.`
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      text?.slice(0, 500) ||
        `Ollama returned ${res.status}. Is the model pulled? Try: ollama pull ${model}`
    );
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body from Ollama");

  const dec = new TextDecoder();
  let buf = "";
  let cumulativePrefix = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let j: {
        message?: { content?: unknown };
        error?: string;
      };
      try {
        j = JSON.parse(trimmed) as typeof j;
      } catch {
        continue;
      }
      if (j.error) throw new Error(j.error);
      const full = ollamaContentToString(j.message?.content);
      if (!full) continue;

      let delta = "";
      if (full.startsWith(cumulativePrefix)) {
        delta = full.slice(cumulativePrefix.length);
        cumulativePrefix = full;
      } else {
        delta = full;
        cumulativePrefix += full;
      }

      if (delta) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`)
        );
      }
    }
  }
}

async function streamOpenAI(
  messages: ChatMessage[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  const openai = new OpenAI({
    apiKey: key,
    ...(baseURL ? { baseURL } : {}),
  });

  try {
    const stream = await openai.chat.completions.create({
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      max_tokens: 4096,
    });

    for await (const chunk of stream) {
      const t = chunk.choices[0]?.delta?.content;
      if (t) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: t })}\n\n`)
        );
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`OpenAI: ${msg}`);
  }
}

function createChatStream(messages: ChatMessage[]): ReadableStream<Uint8Array> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        if (anthropicKey) {
          const model =
            process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
          const anthropic = new Anthropic({ apiKey: anthropicKey });
          const stream = anthropic.messages.stream({
            model,
            max_tokens: 8192,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          });

          let sentText = false;
          for await (const event of stream) {
            if (event.type !== "content_block_delta") continue;
            if (event.delta.type === "text_delta" && event.delta.text) {
              sentText = true;
              const chunk = JSON.stringify({ text: event.delta.text });
              controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            } else if (
              event.delta.type === "thinking_delta" &&
              event.delta.thinking
            ) {
              sentText = true;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ text: event.delta.thinking })}\n\n`
                )
              );
            }
          }

          if (!sentText) {
            try {
              const text = await stream.finalText();
              if (text?.trim()) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
                );
              }
            } catch {
              /* non-text-only stream */
            }
          }
        } else if (openaiKey) {
          await streamOpenAI(messages, controller, encoder);
        } else if (process.env.MOCK_MODE === "true") {
          await streamOffline(messages, controller, encoder);
        } else {
          await streamOllama(messages, controller, encoder);
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Stream error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });
}

async function pipeStreamToResponse(
  stream: ReadableStream<Uint8Array>,
  res: NextApiResponse
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) res.write(Buffer.from(value));
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body as { messages?: ChatMessage[] };
  const messages = body.messages?.filter(
    (m) =>
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string"
  );

  if (!messages?.length) {
    res.status(400).json({
      error: "messages[] required with role user|assistant and content",
    });
    return;
  }

  const stream = createChatStream(messages);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  await pipeStreamToResponse(stream, res);
}
