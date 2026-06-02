import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createReadStream } from "fs";
import PDFParse from "pdf-parse";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, ".cache", "pdfs");
const INDEX_FILE = path.join(__dirname, "..", "data", "lectures.json");
const CHUNKS_OUTPUT = path.join(__dirname, "..", "data", "chunks.json");

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

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 200;

function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
}

function isQALecture(content: string): boolean {
  const qaPattern = /^\s*Q[\.\s:]/m;
  const qCount = (content.match(/^\s*Q[\.\s:]/gm) || []).length;
  return qCount >= 2;
}

function chunkByQA(content: string, lectureId: number): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = content.split("\n");
  let currentQ = "";
  let currentA = "";
  let position = 0;

  for (const line of lines) {
    if (line.match(/^\s*Q[\.\s:]/)) {
      // Save previous Q&A
      if (currentQ && currentA) {
        const qaBlock = `${currentQ}\n\n${currentA}`.trim();
        if (qaBlock.length > 50) {
          chunks.push({
            lecture_id: lectureId,
            position,
            content: qaBlock,
            content_hash: computeHash(qaBlock),
          });
          position++;
        }
      }
      currentQ = line;
      currentA = "";
    } else if (line.match(/^\s*A[\.\s:]/)) {
      currentA = line;
    } else if (currentQ) {
      if (!currentA) {
        currentQ += " " + line;
      } else {
        currentA += " " + line;
      }
    }
  }

  // Save last Q&A
  if (currentQ && currentA) {
    const qaBlock = `${currentQ}\n\n${currentA}`.trim();
    if (qaBlock.length > 50) {
      chunks.push({
        lecture_id: lectureId,
        position,
        content: qaBlock,
        content_hash: computeHash(qaBlock),
      });
    }
  }

  return chunks;
}

function chunkBySlidingWindow(
  content: string,
  lectureId: number
): Chunk[] {
  const chunks: Chunk[] = [];
  const words = content.split(/\s+/);

  for (let i = 0; i < words.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const chunk = words.slice(i, i + CHUNK_SIZE).join(" ");
    if (chunk.length > 100) {
      chunks.push({
        lecture_id: lectureId,
        position: chunks.length,
        content: chunk,
        content_hash: computeHash(chunk),
      });
    }
  }

  return chunks;
}

async function extractPdfText(filePath: string): Promise<string> {
  try {
    const dataBuffer = await fs.readFile(filePath);
    const data = await PDFParse(dataBuffer);
    return cleanText(data.text);
  } catch (error) {
    throw new Error(
      `Failed to parse PDF: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function processPdf(lecture: Lecture): Promise<Chunk[]> {
  const pdfPath = path.join(
    CACHE_DIR,
    `E${String(lecture.number).padStart(3, "0")}.pdf`
  );

  try {
    // Check if file exists
    await fs.access(pdfPath);
  } catch {
    console.warn(`⚠ PDF not found for lecture ${lecture.number}, skipping`);
    return [];
  }

  try {
    const text = await extractPdfText(pdfPath);

    if (text.length < 100) {
      console.warn(`⚠ Lecture ${lecture.number}: extracted text too short`);
      return [];
    }

    // Try Q&A chunking first
    if (isQALecture(text)) {
      return chunkByQA(text, lecture.number);
    }

    // Fall back to sliding window
    return chunkBySlidingWindow(text, lecture.number);
  } catch (error) {
    console.warn(
      `⚠ Error processing lecture ${lecture.number}: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

async function loadLectures(): Promise<Lecture[]> {
  const data = await fs.readFile(INDEX_FILE, "utf-8");
  return JSON.parse(data);
}

async function saveChunks(chunks: Chunk[]): Promise<void> {
  await fs.mkdir(path.dirname(CHUNKS_OUTPUT), { recursive: true });
  await fs.writeFile(CHUNKS_OUTPUT, JSON.stringify(chunks, null, 2), "utf-8");
  console.log(
    `✓ Saved ${chunks.length} chunks to ${path.relative(process.cwd(), CHUNKS_OUTPUT)}`
  );
}

async function main() {
  try {
    console.log("=== Pathwork Lectures PDF Extractor & Chunker ===\n");

    const lectures = await loadLectures();
    console.log(`Processing ${lectures.length} lectures...\n`);

    const allChunks: Chunk[] = [];
    let processedCount = 0;
    let skippedCount = 0;

    for (const lecture of lectures) {
      try {
        const chunks = await processPdf(lecture);
        if (chunks.length > 0) {
          allChunks.push(...chunks);
          process.stdout.write(
            `[${processedCount + skippedCount + 1}/${lectures.length}] E${String(lecture.number).padStart(3, "0")}: ${chunks.length} chunks\n`
          );
          processedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        process.stdout.write(
          `[${processedCount + skippedCount + 1}/${lectures.length}] E${String(lecture.number).padStart(3, "0")}: ERROR - ${error instanceof Error ? error.message : String(error)}\n`
        );
        skippedCount++;
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Processed: ${processedCount} lectures`);
    console.log(`Skipped: ${skippedCount} lectures`);
    console.log(`Total chunks: ${allChunks.length}`);

    if (allChunks.length === 0) {
      console.error("No chunks extracted");
      process.exit(1);
    }

    await saveChunks(allChunks);

    const avgChunksPerLecture =
      (allChunks.length / processedCount).toFixed(1);
    console.log(`Avg chunks per lecture: ${avgChunksPerLecture}`);
  } catch (error) {
    console.error(
      "Fatal error:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

main();
