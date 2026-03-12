# Bookish — The Shape of Every Story

> Narrative arc analysis engine that ingests classics from Project Gutenberg, runs a multi-stage NLP pipeline over Kafka, warehouses results in BigQuery, and renders the emotional shape of every story in an interactive frontend.

---

## Overview

Most people pick books by cover, genre, or reviews. Bookish lets you see *inside* the story before you open it — mapping how tension rises, where the climax hits, when characters appear, and how the mood shifts from first page to last.

The backend is a distributed event-driven pipeline: books flow from the Gutenberg API through Kafka, get chunked and NLP-analyzed by parallel workers, and land in BigQuery. The frontend visualizes everything in real time — sparkline previews on every book card, full arc charts, cross-book comparisons, and a data-driven read recommendation engine.

---

## Architecture

```
Gutenberg API
     │
     ▼
 Ingester (Python)
  - Fetches catalog via Gutendex
  - Downloads full-text files
  - Writes metadata → BigQuery `books`
  - Produces → Kafka: books-to-process
     │
     ▼
 Chunker (Python)                         consumer group: chunker
  - Detects chapter boundaries (regex)
  - Falls back to 500-word sliding windows
  - Produces → Kafka: book-chunks (8 partitions, round-robin)
     │
     ▼
 NLP Worker (Python)                      consumer group: nlp-worker
  - DistilBERT sentiment scoring
  - Tension = negativity × 0.6 + conflict_density × 0.4
  - spaCy NER → character extraction
  - Pacing = sentence length variance
  - Produces → Kafka: arc-events (8 partitions)
     │
     ▼
 Stream Processor (Python / Kotlin ref)   consumer group: stream-processor
  - Batches arc events (100 rows)
  - Sinks → BigQuery `book_arcs` via batch load job
     │
     ▼
 BigQuery
  - `books` — metadata dimension table
  - `book_arcs` — one row per chunk, range-partitioned on chunk_index
  - `characters` — computed by post-processing script
     │
     ▼
 FastAPI                                  serves arc + analytics endpoints
     │
     ▼
 Vite + React + Recharts                  interactive arc visualization
```

---

## Tech Stack

| Layer | Tech | Why |
|---|---|---|
| **Ingestion** | Python + Gutendex API | Structured access to 70k+ public domain texts, no API key |
| **Message bus** | Apache Kafka (KRaft, no Zookeeper) | Decoupled pipeline stages, parallel chunk processing across 8 partitions |
| **NLP** | DistilBERT + spaCy `en_core_web_sm` | Transformer sentiment at scale, lightweight NER for character tracking |
| **Stream processing** | Python (Kotlin reference impl kept) | Stateless consumer with manual offset commits, flush-on-drain semantics |
| **Data warehouse** | Google BigQuery | Columnar storage, UNNEST for repeated subjects, free-tier batch loads |
| **Infrastructure** | Terraform | BigQuery dataset + tables as code, reproducible across environments |
| **Containerization** | Docker + Docker Compose | Single `server/requirements.txt` shared across all services via build context |
| **API** | FastAPI + Uvicorn | Async, auto-documented, typed responses |
| **Frontend** | Vite + React + TypeScript + Recharts + Tailwind CSS v3 | Fast HMR, type-safe API client, custom dark theme |

---

## NLP Pipeline Detail

### Tension Score
```
negativity      = (1.0 - sentiment) / 2          # maps [−1, 1] → [0, 1]
conflict_density = keyword_hits / total_words     # ~200 conflict keywords
tension_score   = negativity × 0.6 + conflict_density × 0.4
```

Conflict keywords span five categories: **violence**, **death & injury**, **pursuit & threat**, **betrayal**, and **emotional intensity**.

### Sentiment
DistilBERT (`distilbert-base-uncased-finetuned-sst-2-english`) scores each chunk. Raw logits are converted to a continuous `[-1.0, 1.0]` scale — not just positive/negative binary.

### Character Extraction
spaCy NER (`PERSON` entities) per chunk. A post-processing script (`scripts/build_characters.py`) aggregates mention counts, first/last appearance, and peak presence across the full book and writes to the `characters` table.

### Pacing
Sentence length variance per chunk — short, punchy sentences = high pacing score. Normalized across the book.

---

## Kafka Design

| Topic | Partitions | Key | Consumer Group |
|---|---|---|---|
| `books-to-process` | 1 | none | `chunker` |
| `book-chunks` | 8 | none (round-robin) | `nlp-worker` |
| `arc-events` | 8 | none (round-robin) | `stream-processor` |

**Why no partition key on `book-chunks`?** Chunks don't need to be processed in order — each message carries `chunk_index` and `book_id`. BigQuery reconstructs the arc at read time with `ORDER BY chunk_index`. This lets all 8 NLP workers pull from all 8 partitions freely, maximizing parallelism.

**Drain mode:** All consumers support `--drain` — they exit cleanly after 3 consecutive empty polls (15s idle). This makes the pipeline scriptable end-to-end.

**KRaft mode:** Kafka runs without Zookeeper. Cluster metadata is managed internally via the Raft consensus algorithm — one less distributed system to operate.

---

## BigQuery Schema

### `books`
| Column | Type | Notes |
|---|---|---|
| `book_id` | STRING | Gutenberg ID |
| `title` | STRING | |
| `author` | STRING | |
| `subjects` | STRING REPEATED | Used with UNNEST for genre aggregations |
| `language` | STRING | |
| `publish_year` | INTEGER | |
| `word_count` | INTEGER | |
| `gcs_path` | STRING | Raw text location (GCS or null for local) |
| `processed_at` | TIMESTAMP | |

### `book_arcs`
One row per chunk per book. Range-partitioned by `chunk_index`, clustered by `book_id`.

| Column | Type | Notes |
|---|---|---|
| `book_id` | STRING | |
| `chunk_index` | INTEGER | Sequential position |
| `position_pct` | FLOAT | 0.0–1.0 through the book |
| `chapter` | STRING | Detected chapter label |
| `word_count` | INTEGER | |
| `sentiment_score` | FLOAT | −1.0 to 1.0 |
| `tension_score` | FLOAT | 0.0–1.0 composite |
| `pacing_score` | FLOAT | 0.0–1.0 |
| `conflict_density` | FLOAT | Keyword hit ratio |
| `dominant_characters` | STRING REPEATED | Top NER entities in chunk |

### `characters`
Computed post-pipeline by `scripts/build_characters.py`.

| Column | Type | Notes |
|---|---|---|
| `book_id` | STRING | |
| `character_name` | STRING | As extracted by NER |
| `mention_count` | INTEGER | |
| `first_appearance_pct` | FLOAT | |
| `last_appearance_pct` | FLOAT | |
| `peak_presence_pct` | FLOAT | |

> **Note on free tier:** BigQuery free tier blocks DML (`DELETE`, `INSERT`) and streaming inserts. The pipeline uses `load_table_from_json` (batch load jobs) for all writes. Table clears use `drop + recreate` (DDL) instead of `DELETE FROM`.

---

## Frontend

### Library
Book grid with tension sparklines on every card — you see the shape of the story before you click. Skeleton loading, lazy arc fetching.

### Book Detail
Full arc visualization: AreaChart (intensity, mood, pace), chapter reference lines, character swimlane timeline, stat badges (overall intensity, climax %, climax position, chapter count), theme tags.

### Compare
Overlay tension curves for 2–4 books on the same chart. Color-coded lines, book title tooltips on hover. After comparing, a **Verdict card** scores each book on a weighted composite (intensity × 0.5 + pace × 0.3 + mood × 0.2) and recommends which to read first with a plain-English reason.

### Explore
BigQuery-powered genre fingerprints — average intensity, mood, and pace per subject, rendered as a color-interpolated bar chart. Toggle between metrics. Full sortable data table below.

---

## Project Structure

```
bookish/
├── server/
│   ├── ingester/            # Gutenberg → local/GCS + Kafka + BigQuery
│   ├── chunker/             # Kafka consumer: text → chunks → Kafka
│   ├── nlp-worker/          # Kafka consumer: chunks → NLP → Kafka
│   ├── stream-processor/    # Kafka consumer: arc-events → BigQuery
│   │   └── src/             # Kotlin reference implementation (kept for learning)
│   ├── api/                 # FastAPI: arc + analytics endpoints
│   ├── scripts/
│   │   └── build_characters.py   # Post-pipeline character aggregation
│   ├── terraform/           # BigQuery dataset + tables as code
│   ├── requirements.txt     # Shared across all Python services
│   ├── orchestrate.py       # Master script: clean → ingest → chunk → NLP → sink → serve
│   └── .env.example
├── client/                  # Vite + React + TypeScript
│   └── src/
│       ├── api/             # Typed fetch client
│       ├── components/      # ArcChart, BookCard, Sparkline, Navbar
│       └── pages/           # Library, BookDetail, Compare, Explore
├── docker-compose.yml       # Full local orchestration
└── README.md
```

---

## API

| Endpoint | Description |
|---|---|
| `GET /api/books` | Paginated catalog, author/language filters |
| `GET /api/books/{id}` | Book metadata |
| `GET /api/books/{id}/arc` | All arc chunks ordered by `chunk_index` |
| `GET /api/books/{id}/characters` | Character presence data |
| `GET /api/compare?ids=1,2,3` | Arc data grouped by `book_id` |
| `GET /api/explore/genres` | Avg intensity/mood/pace per subject via `UNNEST` |

---

## Running Locally

**1. Environment**
```bash
cp server/.env.example server/.env
# set GCP_PROJECT_ID, BQ_DATASET, KAFKA_BOOTSTRAP
```

**2. Infrastructure**
```bash
cd server/terraform && terraform init && terraform apply
```

**3. Kafka** (on a separate machine or Docker locally)
```bash
# Set your LAN IP in docker-compose.yml KAFKA_ADVERTISED_LISTENERS
docker compose up -d kafka
```

**4. Run everything**
```bash
cd server
python orchestrate.py --limit 50
# Cleans BQ tables → ingests → chunks → NLP → sinks → starts API + client
```

Or stage by stage:
```bash
python ingester/main.py --local --limit 50
python chunker/main.py --drain
python nlp-worker/main.py --drain
python stream-processor/main.py --drain
python scripts/build_characters.py
uvicorn api.main:app --port 8000
cd ../client && npm run dev
```

---

## Data Source

[Project Gutenberg](https://www.gutenberg.org) via the [Gutendex API](https://gutendex.com) — 70,000+ public domain books, full text downloads, structured metadata. No API key required.
