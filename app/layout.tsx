import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pathwork Lectures RAG",
  description: "Semantic search and AI chat on 258 Pathwork Lectures",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, padding: 0, fontFamily: "'Merriweather', serif" }}>
        {children}
      </body>
    </html>
  );
}
