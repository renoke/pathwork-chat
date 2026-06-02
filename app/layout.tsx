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
      <body style={{ margin: 0, padding: 0, fontFamily: "system-ui" }}>
        {children}
      </body>
    </html>
  );
}
