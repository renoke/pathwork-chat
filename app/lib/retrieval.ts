import { supabase } from "./supabase";

export interface RetrievedChunk {
  lecture_id: number;
  lecture_title: string;
  position: number;
  content: string;
  similarity: number;
}

export async function hybridSearch(
  embedding: number[],
  query: string,
  topK: number = 10
): Promise<RetrievedChunk[]> {
  const { data, error } = await supabase.rpc("search_pathwork", {
    query_embedding: embedding,
    query_text: query,
    match_count: topK,
  });

  if (error) {
    console.error("Search error:", error);
    throw new Error(`Failed to search: ${error.message}`);
  }

  return (
    data?.map((row: any) => ({
      lecture_id: row.lecture_id,
      lecture_title: row.lecture_title,
      position: row.position,
      content: row.content,
      similarity: row.combined_score,
    })) || []
  );
}

export function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (chunk) =>
        `[E${String(chunk.lecture_id).padStart(3, "0")}: ${chunk.lecture_title}]\n${chunk.content}`
    )
    .join("\n\n---\n\n");
}
