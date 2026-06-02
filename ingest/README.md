# Ingestion Pipeline

Batch pipeline to scrape, download, and process Pathwork Lectures.

## Scripts (run in order)

### 1. Fetch Index (`1-fetch-index.ts`)
Scrapes lecture metadata from pathwork.org.

```bash
npm run ingest:index
```

**Output:** `data/lectures.json` (258 lectures with number, title, date, URL)

**Features:**
- Rate-limited requests (≥1.5s between fetches)
- Compliance verification (robots.txt, copyright)
- Retry with exponential backoff
- Fallback: generates metadata from known PDF URL pattern

### 2. Download PDFs (`2-download-pdfs.ts`)
Downloads all 258 PDFs from pathwork.org.

```bash
npm run ingest:download
```

**Output:** `ingest/.cache/pdfs/E001.pdf` ... `E258.pdf`

**Features:**
- Caches PDFs locally (skips re-downloads)
- Rate-limited (≥1.5s between requests)
- Timeout protection (30s per download)
- Detailed progress reporting

### 3. Extract & Chunk (`3-extract-chunk.ts`)
Extracts text from PDFs and chunks into passages.

```bash
npm run ingest:chunk
```

**Output:** `data/chunks.json` (passages with lecture_id, position, content, content_hash)

**Features:**
- PDF text extraction with pdf-parse
- Smart chunking:
  - Question & Answer lectures: chunks by Q/A pairs
  - Standard lectures: sliding window (800 words, 200-word overlap)
- Content hash for idempotence

### 4. Embed & Store (`4-embed-store.ts`) [TODO]
Computes embeddings and stores chunks in Supabase.

```bash
npm run ingest:embed
```

**Input:** `data/chunks.json`
**Output:** Chunks stored in Supabase with embeddings

**Features:**
- Batch embedding via OpenRouter
- Idempotent storage (hash-based deduplication)
- Full-text search index for Postgres
- Rate-limit respecting

## Setup

```bash
npm install
npm run ingest:index    # Step 1
npm run ingest:download # Step 2 (long-running)
npm run ingest:chunk    # Step 3
```

## Notes

- All scripts are **rate-limited** and **idempotent** (safe to re-run)
- PDFs cached in `ingest/.cache/pdfs/` (not in git)
- Data files in `data/` (not in git)
- Respects `pathwork.org` copyright and robots.txt

## Environment

Required for step 4:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (write access)
- `OPENROUTER_API_KEY`
