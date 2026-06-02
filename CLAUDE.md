# CLAUDE.md — Pathwork Lectures RAG

Contexte projet pour Claude Code. Lire entièrement avant toute action.

## Objectif

Application de recherche sémantique + chat IA sur le corpus des **258 Pathwork Lectures (édition 1996)** d'Eva Pierrakos. L'utilisateur pose des questions (souvent en **français**), l'app récupère les passages pertinents (corpus en **anglais**), et un LLM **synthétise, explique et cite ses sources** en français.

Deux briques distinctes, à ne jamais mélanger :
1. **`ingest/`** — pipeline batch hors-ligne (scrape → extract → chunk → embed → store). Lancé occasionnellement, pas déployé.
2. **`app/`** — application web (API + chat) qui ne fait que *récupération + génération*. Ne contient aucune logique d'ingestion.

## Contraintes non négociables

- **Droit d'auteur.** Les lectures appartiennent à l'International Pathwork Foundation. Avant tout scraping, vérifier `https://pathwork.org/robots.txt` et la page `https://pathwork.org/copyright-trademark/`. Le scraper doit être **rate-limité** (≥ 1 s entre requêtes, User-Agent identifiable). Le chat **ne reproduit jamais une lecture intégrale** : il synthétise et renvoie vers la source. Toujours citer (n° de lecture + titre + lien).
- **Anti-hallucination.** Le LLM répond **uniquement** à partir du contexte récupéré. S'il ne trouve rien de pertinent, il dit « je ne trouve pas cela dans le corpus » plutôt que d'inventer.
- **Citations obligatoires** dans chaque réponse : numéro(s) de lecture, titre, lien vers la lecture d'origine.
- **Idempotence** du pipeline : ré-exécuter l'ingestion ne doit jamais dupliquer ni re-télécharger/re-embedder l'inchangé (hash de contenu).

## Stack & décisions arrêtées (ne pas « corriger »)

- **Langage** : TypeScript.
- **Framework** : **Next.js (App Router)**. UI + API dans le même projet. Le endpoint chat est une **Route Handler** (`app/api/chat/route.ts`), runtime **Node.js** (pas Edge : on a besoin du client Postgres/Supabase). UI client avec le hook `useChat` du SDK Vercel AI.
- **Chat** : Vercel AI SDK (`streamText` côté serveur, `useChat` côté client, tool calling, streaming).
- **LLM (génération)** : via **OpenRouter** (une seule clé).
- **Embeddings** : via **OpenRouter** également (l'API embeddings unifiée d'OpenRouter existe depuis fin 2025, compatible OpenAI). Pas de second fournisseur à gérer.
- **Base** : **Supabase Postgres + pgvector** (vecteurs) + **full-text search natif Postgres** (`tsvector`).

### Modèle d'embedding

Le corpus est en anglais, les requêtes en français → **modèle multilingue obligatoire** (cross-lingual). Choix par défaut : un modèle multilingue OpenRouter (ex. Qwen3 Embedding ou Gemini Embedding 2), **dimensions ≤ 1536** pour rester sur le type `vector` standard de pgvector avec index HNSW. Au-delà (3072), il faut passer en `halfvec`. Fixer la dimension une fois et ne plus en changer sans re-générer tous les vecteurs.
Note : pas de streaming en embeddings (sortie complète, déterministe) — sans importance, c'est un batch.

## Source de données

- Page d'index (titres, n°, dates, liens) : `https://pathwork.org/lecture-categories/pathwork-lectures-1996-ed/?range=1-258`
- **PDF par lecture, URL prévisible** : `https://pathwork.org/wp-content/uploads/lectures/pdf/E001.PDF` … jusqu'à `E258.PDF`.
- **Privilégier les PDF** pour le texte (propres, structurés). Le scraping HTML sert **uniquement** aux métadonnées depuis la page d'index.
- Les lectures « Questions and Answers » ont une structure Q/R : envisager un chunking par paire question/réponse plutôt que par fenêtre fixe.

## Structure du repo

```
/
├── CLAUDE.md
├── ingest/                 # pipeline batch (hors-ligne)
│   ├── 1-fetch-index.ts    # scrape métadonnées des 258 lectures
│   ├── 2-download-pdfs.ts  # télécharge E001..E258 (rate-limité, cache disque)
│   ├── 3-extract-chunk.ts  # PDF→texte (unpdf/pdf-parse)→nettoyage→chunks
│   ├── 4-embed-store.ts    # embeddings batch → Supabase (idempotent par hash)
│   └── lib/
├── app/                    # Next.js (App Router)
│   ├── app/
│   │   ├── page.tsx        # UI chat (useChat, sources cliquables)
│   │   └── api/chat/route.ts  # streamText + récupération (runtime Node)
│   └── lib/
│       ├── retrieval.ts    # recherche hybride + rerank + query rewriting
│       └── supabase.ts     # client (pooler)
├── db/
│   ├── schema.sql
│   └── search_hybrid.sql   # fonction RPC de recherche hybride
└── eval/
    ├── testset.json        # 20-30 paires question → lecture(s) attendue(s)
    └── run-eval.ts         # recall@k
```

## Schéma DB (référence)

```sql
create extension if not exists vector;

create table lectures (
  number int primary key,
  title  text not null,
  date   date,
  url    text not null
);

create table chunks (
  id          bigint generated always as identity primary key,
  lecture_id  int references lectures(number),
  position    int,
  content     text not null,
  content_hash text not null unique,           -- idempotence
  embedding   vector(1536),
  fts         tsvector generated always as (to_tsvector('english', content)) stored
);

create index on chunks using hnsw (embedding vector_cosine_ops);
create index on chunks using gin (fts);
```

## Récupération (cœur de la qualité)

Recherche **hybride** dans une fonction RPC Postgres :
1. top-N vectoriel (cosine, pgvector) ;
2. top-N full-text (`websearch_to_tsquery`) ;
3. fusion **Reciprocal Rank Fusion** ;
4. **rerank** du top-k (endpoint Rerank d'OpenRouter ou cross-encoder) ;
5. renvoie chunks + métadonnées de lecture.

Avant d'embedder la requête : **query rewriting** (reformuler / éventuellement traduire la question FR ; HyDE possible). Le corpus regorge de termes spécifiques (« image-finding », « the mask », « lower self », « Pistis Sophia ») → le full-text est indispensable pour les termes exacts.

## Commandes (à compléter au fur et à mesure)

```bash
# Ingestion (dans l'ordre)
npm run ingest:index      # 1-fetch-index
npm run ingest:download   # 2-download-pdfs
npm run ingest:chunk      # 3-extract-chunk
npm run ingest:embed      # 4-embed-store

# Base
npm run db:migrate        # applique db/schema.sql + search_hybrid.sql

# App
npm run dev               # Next.js (UI + endpoint chat)
npm run eval              # recall@k sur eval/testset.json

# Qualité
npm run typecheck
npm run lint
```

## Conventions

- TypeScript strict, pas de `any` silencieux.
- Secrets uniquement via variables d'environnement (`.env`, jamais commit) : `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (pipeline) / `SUPABASE_ANON_KEY` (app).
- Sur Supabase en serverless : utiliser le **connection pooler** (port `6543`), pas la connexion directe.
- Le pipeline `ingest/` n'est jamais importé par `app/`.
- Tout appel réseau externe (OpenRouter, scraping) : retry avec backoff exponentiel.

## Pièges connus

- **OpenRouter embeddings** : pas de streaming (réponse complète) ; gérer les 429 (rate limit) avec backoff, et `allow_fallbacks: true` pour les 529.
- **pgvector + HNSW** : limité au type `vector` jusqu'à 2000 dims. Garder ≤ 1536, ou passer en `halfvec`.
- **Next.js Route Handler** : forcer `export const runtime = 'nodejs'` sur `api/chat` (le client Postgres/Supabase ne tourne pas sur Edge). Surveiller le timeout des fonctions serverless sur Vercel pour les réponses longues en streaming.
- **Corpus EN / requêtes FR** : ne pas embedder avec un modèle anglais-only. Le LLM répond en FR même si les sources citées sont en EN.
- **Scraping** : respecter le rate limit ; mettre les PDF en cache disque pour ne pas re-télécharger à chaque run.

## À NE PAS faire

- Ne pas reproduire le texte intégral d'une lecture dans une réponse de chat.
- Ne pas embedder du HTML brut : extraire le texte propre des PDF d'abord.
- Ne pas mélanger ingestion et app.
- Ne pas changer la dimension d'embedding sans re-générer toute la table `chunks`.
- Ne pas répondre hors corpus : à défaut de contexte pertinent, le dire.

## État d'avancement

- [ ] Phase 0 — Cadrage (vérif copyright/robots, projet Supabase, extension vector, choix dim embedding)
- [ ] Phase 1 — Ingestion (index → PDF → chunks)
- [ ] Phase 2 — Embeddings + stockage
- [ ] Phase 3 — Recherche hybride + rerank + query rewriting
- [ ] Phase 4 — App chat (streaming, citations, FR)
- [ ] Phase 5 — Éval (recall@k) + itération
- [ ] Phase 6 — Déploiement (pooler, secrets, rate-limit)
