import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE = path.join(__dirname, "..", "data", "lectures.json");
const CHUNKS_FILE = path.join(__dirname, "..", "data", "chunks.json");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openRouterKey = process.env.OPENROUTER_API_KEY;

if (!supabaseUrl || !supabaseServiceKey || !openRouterKey) {
  console.error(
    "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or OPENROUTER_API_KEY"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const BATCH_SIZE = 25;
const RATE_LIMIT_MS = 1000;

interface Lecture {
  number: number;
  title: string;
  date: string | null;
  url: string;
}

interface Chunk {
  lecture_id: number;
  position: number;
  content: string;
  content_hash: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as any;
    return data.data.map((item: any) => item.embedding);
  } catch (error) {
    throw new Error(
      `Embedding failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function loadLectures(): Promise<Lecture[]> {
  const data = await fs.readFile(INDEX_FILE, "utf-8");
  return JSON.parse(data);
}

async function loadChunks(): Promise<Chunk[]> {
  const data = await fs.readFile(CHUNKS_FILE, "utf-8");
  return JSON.parse(data);
}

async function insertLectures(lectures: Lecture[]): Promise<void> {
  console.log(`Inserting ${lectures.length} lectures...`);

  const { error } = await supabase.from("lectures").upsert(lectures, {
    onConflict: "number",
  });

  if (error) {
    throw new Error(`Failed to insert lectures: ${error.message}`);
  }

  console.log("✓ Lectures inserted");
}

async function getExistingChunkHashes(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("chunks")
    .select("content_hash");

  if (error) {
    console.warn(`Warning: Could not fetch existing hashes: ${error.message}`);
    return new Set();
  }

  return new Set(data?.map((row: any) => row.content_hash) || []);
}

async function insertChunksWithEmbeddings(
  chunks: Array<Chunk & { embedding: number[] }>
): Promise<void> {
  console.log(`Inserting ${chunks.length} chunks with embeddings...`);

  const batchSize = 100;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const { error } = await supabase.from("chunks").insert(
      batch.map((chunk) => ({
        lecture_id: chunk.lecture_id,
        position: chunk.position,
        content: chunk.content,
        content_hash: chunk.content_hash,
        embedding: chunk.embedding,
      }))
    );

    if (error) {
      throw new Error(`Failed to insert batch: ${error.message}`);
    }

    console.log(
      `  Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)}`
    );
  }

  console.log("✓ Chunks inserted");
}

async function main() {
  try {
    console.log("=== Pathwork Lectures Embedding & Storage ===\n");

    const lectures = await loadLectures();
    const chunks = await loadChunks();

    console.log(`Loaded ${lectures.length} lectures`);
    console.log(`Loaded ${chunks.length} chunks\n`);

    // Insert lectures
    await insertLectures(lectures);

    // Check existing chunks
    const existingHashes = await getExistingChunkHashes();
    const newChunks = chunks.filter(
      (chunk) => !existingHashes.has(chunk.content_hash)
    );

    console.log(
      `\nNew chunks to embed: ${newChunks.length} (${chunks.length - newChunks.length} already stored)`
    );

    if (newChunks.length === 0) {
      console.log("No new chunks to process");
      return;
    }

    // Batch embed new chunks
    const chunksWithEmbeddings: Array<Chunk & { embedding: number[] }> = [];

    for (let i = 0; i < newChunks.length; i += BATCH_SIZE) {
      const batch = newChunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((chunk) => chunk.content);

      console.log(
        `\nEmbedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(newChunks.length / BATCH_SIZE)} (${texts.length} chunks)...`
      );

      const embeddings = await embedTexts(texts);

      batch.forEach((chunk, idx) => {
        chunksWithEmbeddings.push({
          ...chunk,
          embedding: embeddings[idx],
        });
      });

      if (i + BATCH_SIZE < newChunks.length) {
        await sleep(RATE_LIMIT_MS);
      }
    }

    // Insert chunks with embeddings
    await insertChunksWithEmbeddings(chunksWithEmbeddings);

    console.log(`\n✓ Successfully embedded and stored ${newChunks.length} chunks`);
    console.log(`Total chunks in database: ${chunks.length}`);
  } catch (error) {
    console.error(
      "Fatal error:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

main();
