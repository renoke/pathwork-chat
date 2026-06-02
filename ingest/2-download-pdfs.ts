import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, ".cache", "pdfs");
const INDEX_FILE = path.join(__dirname, "..", "data", "lectures.json");

const USER_AGENT =
  "Pathwork-RAG/1.0 (+https://github.com/renaud-kern/pathwork-rag)";
const RATE_LIMIT_MS = 1500;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const TIMEOUT_MS = 30000;

interface Lecture {
  number: number;
  title: string;
  date: string | null;
  url: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  retryCount = 0
): Promise<Response> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal as any,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 429 && retryCount < MAX_RETRIES) {
        const backoffMs =
          INITIAL_BACKOFF_MS * Math.pow(2, retryCount) +
          Math.random() * 1000;
        console.warn(
          `[Retry ${retryCount + 1}/${MAX_RETRIES}] Rate limited on ${url}. Waiting ${backoffMs.toFixed(0)}ms...`
        );
        await sleep(backoffMs);
        return fetchWithRetry(url, retryCount + 1);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const backoffMs =
        INITIAL_BACKOFF_MS * Math.pow(2, retryCount) +
        Math.random() * 1000;
      console.warn(
        `[Retry ${retryCount + 1}/${MAX_RETRIES}] Error: ${error instanceof Error ? error.message : String(error)}. Waiting ${backoffMs.toFixed(0)}ms...`
      );
      await sleep(backoffMs);
      return fetchWithRetry(url, retryCount + 1);
    }
    throw error;
  }
}

async function loadLectures(): Promise<Lecture[]> {
  const data = await fs.readFile(INDEX_FILE, "utf-8");
  return JSON.parse(data);
}

async function getCachePath(number: number): Promise<string> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  return path.join(CACHE_DIR, `E${String(number).padStart(3, "0")}.pdf`);
}

async function downloadPdf(lecture: Lecture): Promise<string> {
  const cachePath = await getCachePath(lecture.number);

  // Check if already cached
  try {
    await fs.access(cachePath);
    return cachePath;
  } catch {
    // Not cached, proceed to download
  }

  try {
    const response = await fetchWithRetry(lecture.url);

    if (!response.body) {
      throw new Error("Response body is empty");
    }

    const tempPath = cachePath + ".tmp";
    await pipeline(response.body as any, createWriteStream(tempPath));

    // Verify the file was written
    const stats = await fs.stat(tempPath);
    if (stats.size === 0) {
      await fs.unlink(tempPath);
      throw new Error("Downloaded file is empty");
    }

    // Move temp file to final location
    await fs.rename(tempPath, cachePath);
    return cachePath;
  } catch (error) {
    const tempPath = cachePath + ".tmp";
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

async function main() {
  try {
    console.log("=== Pathwork Lectures PDF Downloader ===\n");

    const lectures = await loadLectures();
    console.log(`Loaded ${lectures.length} lectures from metadata\n`);

    let successCount = 0;
    let cachedCount = 0;
    const errors: { number: number; error: string }[] = [];

    for (const lecture of lectures) {
      try {
        const cachePath = await getCachePath(lecture.number);

        try {
          await fs.access(cachePath);
          process.stdout.write(
            `[${successCount + cachedCount + 1}/${lectures.length}] E${String(lecture.number).padStart(3, "0")} (cached)\n`
          );
          cachedCount++;
        } catch {
          const startTime = Date.now();
          await downloadPdf(lecture);
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          process.stdout.write(
            `[${successCount + cachedCount + 1}/${lectures.length}] E${String(lecture.number).padStart(3, "0")} (${duration}s)\n`
          );
          successCount++;
        }

        await sleep(RATE_LIMIT_MS);
      } catch (error) {
        errors.push({
          number: lecture.number,
          error: error instanceof Error ? error.message : String(error),
        });
        process.stdout.write(
          `[${successCount + cachedCount + errors.length}/${lectures.length}] E${String(lecture.number).padStart(3, "0")} (ERROR: ${error instanceof Error ? error.message : String(error)})\n`
        );
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Downloaded: ${successCount}`);
    console.log(`From cache: ${cachedCount}`);
    console.log(`Errors: ${errors.length}`);
    console.log(`Total: ${successCount + cachedCount} / ${lectures.length}`);

    if (errors.length > 0) {
      console.log(`\nFailed downloads:`);
      errors.slice(0, 10).forEach(({ number, error }) => {
        console.log(`  E${String(number).padStart(3, "0")}: ${error}`);
      });
      if (errors.length > 10) {
        console.log(`  ... and ${errors.length - 10} more`);
      }
    }

    if (successCount + cachedCount === 0) {
      console.error("No PDFs downloaded");
      process.exit(1);
    }
  } catch (error) {
    console.error(
      "Fatal error:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

main();
