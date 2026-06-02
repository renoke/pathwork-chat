import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { getConfig, getConfigNumber, getConfigInt } from "../../lib/config";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openRouterKey = process.env.OPENROUTER_API_KEY;

if (!supabaseUrl || !supabaseServiceKey || !openRouterKey) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const EMBEDDING_MODEL = getConfig("EMBEDDING_MODEL", "openai/text-embedding-3-small");
const LLM_MODEL = getConfig("LLM_MODEL", "openai/gpt-4o");
const LLM_TEMPERATURE = getConfigNumber("LLM_TEMPERATURE", 0.7);
const LLM_FREQUENCY_PENALTY = getConfigNumber("LLM_FREQUENCY_PENALTY", 0.3);
const LLM_TOP_P = getConfigNumber("LLM_TOP_P", 0.95);
const RETRIEVAL_TOP_K = getConfigInt("RETRIEVAL_TOP_K", 10);
const RETRIEVAL_VECTOR_WEIGHT = getConfigNumber("RETRIEVAL_VECTOR_WEIGHT", 0.6);
const RETRIEVAL_TEXT_WEIGHT = getConfigNumber("RETRIEVAL_TEXT_WEIGHT", 0.4);

const SYSTEM_PROMPT = getConfig("SYSTEM_PROMPT", "You are an expert of Pathwork lectures.");

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

async function embedText(text: string): Promise<number[]> {
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouterKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding failed: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as any;
  return data.data[0].embedding;
}

async function searchContext(
  embedding: number[],
  query: string
): Promise<{ context: string; references: Array<{ id: number; title: string }> }> {
  const { data, error } = await supabase.rpc("search_pathwork", {
    query_embedding: embedding,
    query_text: query,
    match_count: RETRIEVAL_TOP_K,
    vector_weight: RETRIEVAL_VECTOR_WEIGHT,
    text_weight: RETRIEVAL_TEXT_WEIGHT,
  });

  if (error) {
    throw new Error(`Search failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return {
      context: "No relevant context found in the lectures.",
      references: [],
    };
  }

  // Extract unique lecture references
  const uniqueLectures = new Map<
    number,
    string
  >();
  data.forEach((chunk: any) => {
    if (!uniqueLectures.has(chunk.lecture_id)) {
      uniqueLectures.set(chunk.lecture_id, chunk.lecture_title);
    }
  });

  const contextText = data
    .map(
      (chunk: any) =>
        `[Lecture E${String(chunk.lecture_id).padStart(3, "0")}: ${chunk.lecture_title}]\n${chunk.content}`
    )
    .join("\n\n---\n\n");

  const references = Array.from(uniqueLectures.entries()).map(([id, title]) => ({
    id,
    title,
  }));

  return { context: contextText, references };
}

async function* streamChat(
  userMessage: string,
  context: string,
  references: Array<{ id: number; title: string }>,
  messageHistory: ChatMessage[]
): AsyncGenerator<string> {
  // Build conversation messages - include history but only recent messages to avoid token limits
  const conversationMessages: ChatMessage[] = [
    ...messageHistory.slice(-6), // Keep last 6 messages (3 exchanges) for context
    { role: "user", content: userMessage },
  ];

  // Format available references for the prompt
  const referencesText =
    references.length > 0
      ? `\n\nAvailable lecture references (extract these when citing):\n${references.map((r) => `- E${String(r.id).padStart(3, "0")}: ${r.title}`).join("\n")}`
      : "";

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouterKey}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        {
          role: "system",
          content: `${SYSTEM_PROMPT}\n\nContext from the lectures:\n\n${context}${referencesText}`,
        },
        ...conversationMessages,
      ],
      temperature: LLM_TEMPERATURE,
      frequency_penalty: LLM_FREQUENCY_PENALTY,
      top_p: LLM_TOP_P,
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LLM failed: ${response.status} - ${error}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body as any) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") {
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        } catch {
          // Ignore parsing errors
        }
      }
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: "No messages provided" },
        { status: 400 }
      );
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== "user") {
      return NextResponse.json(
        { error: "Last message must be from user" },
        { status: 400 }
      );
    }

    const userMessage = lastMessage.content;

    // Embed the latest user message for context search
    const embedding = await embedText(userMessage);

    // Search for relevant context
    const { context, references } = await searchContext(embedding, userMessage);

    // Stream response from LLM with full conversation history
    const encoder = new TextEncoder();
    const customReadable = new ReadableStream({
      async start(controller) {
        try {
          for await (const content of streamChat(
            userMessage,
            context,
            references,
            messages.slice(0, -1) // All messages except the last user message
          )) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
            );
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new NextResponse(customReadable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
