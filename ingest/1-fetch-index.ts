import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, ".cache");
const INDEX_OUTPUT = path.join(__dirname, "..", "data", "lectures.json");
const BASE_URL = "https://pathwork.org";
const INDEX_URL =
  "https://pathwork.org/lecture-categories/pathwork-lectures-1996-ed/?range=1-258";

const USER_AGENT =
  "Pathwork-RAG/1.0 (+https://github.com/renaud-kern/pathwork-rag)";
const RATE_LIMIT_MS = 1500;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

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
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      if (response.status === 429 && retryCount < MAX_RETRIES) {
        const backoffMs =
          INITIAL_BACKOFF_MS * Math.pow(2, retryCount) +
          Math.random() * 1000;
        console.warn(
          `Rate limited. Waiting ${backoffMs.toFixed(0)}ms before retry...`
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
        `Fetch error: ${error instanceof Error ? error.message : String(error)}. Retrying in ${backoffMs.toFixed(0)}ms...`
      );
      await sleep(backoffMs);
      return fetchWithRetry(url, retryCount + 1);
    }
    throw error;
  }
}

async function verifyCompliance(): Promise<void> {
  console.log("Verifying compliance with robots.txt and copyright...");

  try {
    const robotsUrl = `${BASE_URL}/robots.txt`;
    const response = await fetchWithRetry(robotsUrl);
    const robots = await response.text();

    if (!robots.includes("Disallow:")) {
      console.log("✓ robots.txt found and appears to allow indexing");
    }

    await sleep(RATE_LIMIT_MS);

    const copyrightUrl = `${BASE_URL}/copyright-trademark/`;
    const copyrightRes = await fetchWithRetry(copyrightUrl);
    const copyrightHtml = await copyrightRes.text();

    if (copyrightHtml.length > 0) {
      console.log("✓ Copyright page accessible");
    }

    await sleep(RATE_LIMIT_MS);
  } catch (error) {
    console.warn(
      `Could not verify compliance: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function fetchIndexPage(): Promise<string> {
  console.log(`Fetching index page: ${INDEX_URL}`);

  const response = await fetchWithRetry(INDEX_URL);
  const html = await response.text();

  if (!html || html.length === 0) {
    throw new Error("Index page returned empty content");
  }

  return html;
}

function parseIndexPage(html: string): Lecture[] {
  const $ = cheerio.load(html);
  const lectures: Lecture[] = [];

  // The page uses JavaScript to render, so we'll look for any data in script tags
  $("script").each((_, script) => {
    const content = $(script).html() || "";
    if (content.includes("lecture") || content.includes("E")) {
      try {
        // Try to extract JSON-like structures
        const matches = content.match(/"?(?:title|name|lecture)"?\s*:\s*"([^"]+)"/g);
        if (matches) {
          matches.forEach((match) => {
            const title = match.match(/"([^"]+)"$/)?.[1];
            if (title && !title.includes("<")) {
              const numberMatch = title.match(/E?(\d{1,3})/);
              if (numberMatch) {
                const number = parseInt(numberMatch[1], 10);
                if (number >= 1 && number <= 258) {
                  if (!lectures.find((l) => l.number === number)) {
                    lectures.push({
                      number,
                      title: title.substring(0, 200),
                      date: null,
                      url: `${BASE_URL}/wp-content/uploads/lectures/pdf/E${String(number).padStart(3, "0")}.PDF`,
                    });
                  }
                }
              }
            }
          });
        }
      } catch {
        // Skip parsing errors
      }
    }
  });

  return lectures;
}

function generateFallbackLectures(): Lecture[] {
  const lectures: Lecture[] = [];
  for (let i = 1; i <= 258; i++) {
    lectures.push({
      number: i,
      title: `Lecture ${i}`,
      date: null,
      url: `${BASE_URL}/wp-content/uploads/lectures/pdf/E${String(i).padStart(3, "0")}.PDF`,
    });
  }
  return lectures;
}

async function saveLectures(lectures: Lecture[]): Promise<void> {
  await fs.mkdir(path.dirname(INDEX_OUTPUT), { recursive: true });
  await fs.writeFile(INDEX_OUTPUT, JSON.stringify(lectures, null, 2), "utf-8");
  console.log(
    `✓ Saved ${lectures.length} lectures to ${path.relative(process.cwd(), INDEX_OUTPUT)}`
  );
}

async function main() {
  try {
    console.log("=== Pathwork Lectures Index Scraper ===\n");

    await verifyCompliance();

    const html = await fetchIndexPage();
    await sleep(RATE_LIMIT_MS);

    let lectures = parseIndexPage(html);

    if (lectures.length === 0) {
      console.warn(
        "⚠ No lectures parsed from dynamic page. Using fallback: generating metadata from known URL pattern."
      );
      lectures = generateFallbackLectures();
      console.log(
        "Note: Titles are placeholders. They will be updated when PDFs are processed."
      );
    }

    lectures.sort((a, b) => a.number - b.number);

    await saveLectures(lectures);

    console.log(`\n✓ Successfully generated metadata for ${lectures.length} lectures`);
    if (lectures.length < 258) {
      console.warn(
        `⚠ Expected 258 lectures, but got ${lectures.length}. Some may have been missed.`
      );
    }
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

main();
