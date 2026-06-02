-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Lectures table (metadata)
CREATE TABLE IF NOT EXISTS lectures (
  number INT PRIMARY KEY,
  title TEXT NOT NULL,
  date DATE,
  url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Chunks table (content with embeddings)
CREATE TABLE IF NOT EXISTS chunks (
  id BIGSERIAL PRIMARY KEY,
  lecture_id INT NOT NULL REFERENCES lectures(number) ON DELETE CASCADE,
  "position" INT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  embedding VECTOR(1536),
  fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient retrieval
CREATE INDEX IF NOT EXISTS idx_chunks_lecture_id ON chunks(lecture_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON chunks USING gin(fts);
CREATE INDEX IF NOT EXISTS idx_chunks_content_hash ON chunks(content_hash);

-- Function for hybrid search (vector + full-text)
CREATE OR REPLACE FUNCTION search_pathwork(
  query_embedding VECTOR(1536),
  query_text TEXT,
  match_count INT DEFAULT 10,
  vector_weight FLOAT DEFAULT 0.6,
  text_weight FLOAT DEFAULT 0.4
)
RETURNS TABLE (
  chunk_id BIGINT,
  lecture_id INT,
  lecture_title TEXT,
  "position" INT,
  content TEXT,
  vector_similarity FLOAT,
  text_similarity FLOAT,
  combined_score FLOAT
) AS $$
BEGIN
  RETURN QUERY
  WITH vector_matches AS (
    SELECT
      c.id,
      c.lecture_id,
      l.title,
      c."position",
      c.content,
      1 - (c.embedding <=> query_embedding) as vector_sim
    FROM chunks c
    JOIN lectures l ON c.lecture_id = l.number
    WHERE c.embedding IS NOT NULL
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  text_matches AS (
    SELECT
      c.id,
      c.lecture_id,
      l.title,
      c."position",
      c.content,
      ts_rank(c.fts, websearch_to_tsquery('english', query_text)) as text_sim
    FROM chunks c
    JOIN lectures l ON c.lecture_id = l.number
    WHERE websearch_to_tsquery('english', query_text) @@ c.fts
    ORDER BY ts_rank(c.fts, websearch_to_tsquery('english', query_text)) DESC
    LIMIT match_count * 2
  ),
  combined AS (
    SELECT
      COALESCE(v.id, t.id) as chunk_id,
      COALESCE(v.lecture_id, t.lecture_id) as lecture_id,
      COALESCE(v.title, t.title) as lecture_title,
      COALESCE(v."position", t."position") as "position",
      COALESCE(v.content, t.content) as content,
      COALESCE(v.vector_sim, 0) as vector_similarity,
      COALESCE(t.text_sim, 0) as text_similarity,
      (COALESCE(v.vector_sim, 0) * vector_weight + COALESCE(t.text_sim, 0) * text_weight) as combined_score
    FROM vector_matches v
    FULL OUTER JOIN text_matches t ON v.id = t.id
  )
  SELECT * FROM combined
  WHERE vector_similarity > 0 OR text_similarity > 0
  ORDER BY combined_score DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
