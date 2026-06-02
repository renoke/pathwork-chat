"use client";

import ChatInterface from "./components/ChatInterface";

export default function Home() {
  return (
    <main style={{ display: "flex", justifyContent: "center", minHeight: "100vh", padding: "20px" }}>
      <div style={{ width: "100%", maxWidth: "1200px", display: "flex", flexDirection: "column", gap: "24px" }}>
        <header style={{ textAlign: "center", padding: "20px 0" }}>
          <h1 style={{ fontSize: "2.5rem", marginBottom: "8px" }}>Pathwork Lectures</h1>
          <p style={{ fontSize: "1.1rem", color: "#666" }}>Search & chat with 258 lectures from Eva Pierrakos</p>
        </header>

        <ChatInterface />
      </div>
    </main>
  );
}
