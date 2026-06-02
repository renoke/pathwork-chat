"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{
    lecture_id: number;
    title: string;
    content: string;
    similarity: number;
  }>;
}

const EXAMPLE_PROMPTS = [
  "What is the essence of spiritual growth?",
  "Explain the concept of self-awareness in spiritual development",
  "What are the barriers to spiritual growth?",
  "How does self-honesty relate to spiritual development?",
  "What is the role of the lower self in spiritual growth?",
  "How can I overcome fear in my spiritual journey?",
  "What does it mean to align with divine will?",
  "How can I deepen my spiritual consciousness?",
  "What is the relationship between ego and spiritual growth?",
  "How do I recognize spiritual blockages in myself?",
];

function getRandomExamples(count: number): string[] {
  const shuffled = [...EXAMPLE_PROMPTS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [examplePrompts, setExamplePrompts] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExamplePrompts(getRandomExamples(3));
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...messages,
            { role: "user", content: input },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      const assistantId = (Date.now() + 1).toString();
      let assistantContent = "";

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, assistantMessage]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                assistantContent += data.content;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, content: assistantContent }
                      : msg
                  )
                );
              }
            } catch {
              // Ignore parsing errors
            }
          }
        }
      }
    } catch (error) {
      console.error("Error:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "400px", background: "white", borderRadius: "12px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column" }}>
        {messages.length === 0 ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "24px", color: "#999" }}>
            <p>Ask a question about the Pathwork Lectures...</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
              {examplePrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => setInput(prompt)}
                  style={{ padding: "12px 16px", background: "#f0f0f0", border: "1px solid #ddd", borderRadius: "8px", cursor: "pointer", fontSize: "0.95rem", color: "#333" }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {messages.map((message) => (
              <div key={message.id} style={{ display: "flex", gap: "12px", justifyContent: message.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "80%", padding: "12px 16px", borderRadius: "8px", wordWrap: "break-word", background: message.role === "user" ? "#007bff" : "#f0f0f0", color: message.role === "user" ? "white" : "#333", borderBottomRightRadius: message.role === "user" ? 0 : 8, borderBottomLeftRadius: message.role === "assistant" ? 0 : 8 }}>
                  {message.role === "user" ? (
                    <p style={{ margin: 0, lineHeight: 1.5 }}>{message.content}</p>
                  ) : (
                    <div style={{ margin: 0, lineHeight: 1.6, fontSize: "0.95rem" }}>
                      <ReactMarkdown
                        components={{
                          h1: ({node, ...props}) => <h2 style={{ margin: "8px 0 4px", fontSize: "1.3em", fontWeight: 600 }} {...props} />,
                          h2: ({node, ...props}) => <h3 style={{ margin: "6px 0 3px", fontSize: "1.1em", fontWeight: 600 }} {...props} />,
                          h3: ({node, ...props}) => <h4 style={{ margin: "4px 0 2px", fontSize: "1em", fontWeight: 600 }} {...props} />,
                          p: ({node, ...props}) => <p style={{ margin: "4px 0" }} {...props} />,
                          ul: ({node, ...props}) => <ul style={{ margin: "4px 0", paddingLeft: "20px" }} {...props} />,
                          ol: ({node, ...props}) => <ol style={{ margin: "4px 0", paddingLeft: "20px" }} {...props} />,
                          li: ({node, ...props}) => <li style={{ margin: "2px 0" }} {...props} />,
                          strong: ({node, ...props}) => <strong style={{ fontWeight: 700 }} {...props} />,
                          em: ({node, ...props}) => <em style={{ fontStyle: "italic" }} {...props} />,
                          code: ({node, ...props}) => <code style={{ background: "rgba(0,0,0,0.1)", padding: "2px 4px", borderRadius: "3px", fontFamily: "monospace", fontSize: "0.9em" }} {...props} />,
                          blockquote: ({node, ...props}) => <blockquote style={{ margin: "4px 0", paddingLeft: "8px", borderLeft: "3px solid rgba(0,0,0,0.2)" }} {...props} />,
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  )}
                  {message.sources && message.sources.length > 0 && (
                    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(0,0,0,0.1)", fontSize: "0.9rem" }}>
                      <div style={{ fontWeight: 600, marginBottom: "8px", color: "#555" }}>Sources:</div>
                      {message.sources.map((source, idx) => (
                        <a
                          key={idx}
                          href={`https://pathwork.org/wp-content/uploads/lectures/pdf/E${String(source.lecture_id).padStart(3, "0")}.PDF`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "block", color: "#0066cc", textDecoration: "none", padding: "4px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >
                          E{String(source.lecture_id).padStart(3, "0")}: {source.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-start" }}>
                <div style={{ maxWidth: "80%", padding: "12px 16px", borderRadius: "8px", background: "#f0f0f0", display: "flex", gap: "4px" }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{ width: "8px", height: "8px", background: "#999", borderRadius: "50%" }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "10px", padding: "12px", borderTop: "1px solid #eee", background: "#fafafa" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={messages.length === 0 ? "Ask about the Pathwork Lectures..." : "Ask a follow-up question..."}
          disabled={isLoading}
          style={{ flex: 1, padding: "12px 16px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "1rem", outline: "none", background: isLoading ? "#f0f0f0" : "white", cursor: isLoading ? "not-allowed" : "auto" }}
        />
        <button type="submit" disabled={isLoading} style={{ padding: "12px 24px", background: isLoading ? "#ccc" : "#007bff", color: "white", border: "none", borderRadius: "8px", cursor: isLoading ? "not-allowed" : "pointer", fontSize: "1rem", fontWeight: 600 }}>
          {isLoading ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
