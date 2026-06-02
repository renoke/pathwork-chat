# Pathwork RAG Setup Guide

## Current Status

✓ **Phase 1-3 Complete:**
- ✓ Fetched 258 lecture metadata
- ✓ Downloaded 258 PDFs (10 MB cached)
- ✓ Extracted & chunked into 2,420 passages
- ✓ Ready for embedding & storage

## Phase 4: Database Setup & Embedding

### Step 1: Create Supabase Tables

The SQL schema creates:
- **lectures** table (metadata: number, title, date, url)
- **chunks** table (content passages + embeddings)
- **search_pathwork()** function (hybrid vector + full-text search)
- Indexes for fast retrieval (HNSW for vectors, GIN for full-text)

**How to apply:**

Option A (Recommended): Copy-paste SQL into Supabase UI
```bash
npm run db:schema  # View the SQL
```
Then:
1. Go to: https://supabase.com/dashboard
2. Select your project
3. Go to **SQL Editor** → **New query**
4. Copy the SQL output above and paste it
5. Click **Run**

Option B (Manual): Visit Supabase → SQL Editor, copy-paste db/schema.sql

### Step 2: Run Embedding & Storage

Once the schema is applied:

```bash
npm run ingest:embed
```

This will:
1. Insert 258 lectures into the `lectures` table
2. Fetch existing chunks (for idempotence)
3. Embed new chunks via OpenRouter (text-embedding-3-small)
4. Batch insert chunks with embeddings into Supabase
5. Skip chunks already stored (via content_hash)

**Time estimate:** ~2-3 minutes (2,420 chunks ÷ 25 per batch)

### Environment Variables

All secrets in `.env.local` (do NOT commit):

```
SUPABASE_URL=https://mvsevzjyfnuskmnbjoqf.supabase.co
SUPABASE_ANON_KEY=sb_publishable_i3x10a34MMyM2zEzR01-Vw_3IRLmWqe
SUPABASE_SERVICE_ROLE_KEY=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
OPENROUTER_API_KEY=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
```

⚠️ **Security Warning:** These keys are real. If exposed publicly, **rotate them immediately** in:
- Supabase → Settings → API Keys
- OpenRouter → Account → API Keys

## Next Steps

After embedding:
1. **Phase 5:** Build the chat API (Next.js Route Handler with Vercel AI SDK)
2. **Phase 6:** Build the UI (React chat interface with source citations)
3. **Phase 7:** Deploy (Vercel + Supabase pooler + rate-limiting)

## Commands Reference

```bash
# Ingestion pipeline
npm run ingest:index      # Fetch metadata
npm run ingest:download   # Download PDFs
npm run ingest:chunk      # Extract & chunk
npm run ingest:embed      # Embed & store

# Database
npm run db:schema         # View SQL schema
npm run db:apply          # (WIP) Auto-apply schema

# Quality
npm run typecheck
npm run lint
```

## Architecture

```
Pathwork Lectures RAG
├── ingest/                # Batch pipeline (offline)
│   ├── 1-fetch-index.ts   # → data/lectures.json
│   ├── 2-download-pdfs.ts # → ingest/.cache/pdfs/
│   ├── 3-extract-chunk.ts # → data/chunks.json
│   └── 4-embed-store.ts   # → Supabase
├── app/                   # Web app (Next.js, online)
│   ├── page.tsx           # Chat UI
│   └── api/chat/          # Chat endpoint
├── db/
│   └── schema.sql         # Tables + indexes + search function
└── data/
    ├── lectures.json      # 258 metadata
    └── chunks.json        # 2,420 chunks
```

## Hybrid Search Strategy

The `search_pathwork()` RPC function combines:
- **Vector search:** Semantic similarity (embedding distance)
- **Full-text search:** Exact keyword matching (tsvector + websearch)
- **Reciprocal Rank Fusion:** Combines both scores (60% vector, 40% text by default)

This handles both conceptual queries ("What is the mask?") and specific terms ("Pistis Sophia").
