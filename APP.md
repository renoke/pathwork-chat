# Pathwork RAG - Chat Application

Next.js application for semantic search and AI chat on Pathwork Lectures.

## Structure

```
app/
├── layout.tsx              # Root layout
├── page.tsx               # Home page (chat interface)
├── page.module.css
├── api/
│   └── chat/
│       └── route.ts       # Chat endpoint (TODO: Phase 5)
├── components/
│   ├── ChatInterface.tsx  # Chat UI component
│   └── ChatInterface.module.css
└── lib/
    ├── supabase.ts        # Supabase client
    └── retrieval.ts       # Hybrid search utility
```

## Running

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Environment

Public (client-side):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server (API):
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENROUTER_API_KEY`

## Features (Scaffolded)

- ✓ Chat UI with message history
- ✓ Example prompts
- ✓ Loading state
- ✓ Source citations (UI only, needs API)
- ✓ Responsive design

## Next Steps (Phase 5)

Implement `/api/chat` route:
1. Extract user message from request
2. Embed query via OpenRouter
3. Retrieve via hybrid search
4. Stream response with citations
5. Format sources

See `app/api/chat/route.ts` for TODO.
