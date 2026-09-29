# TOMATO Question Bank

TOMATO is a mathematics question-bank CMS and public question browser built around a Flask API, SQLite, and a Vite-powered frontend.

The current architecture is designed for a large question bank rather than for a small collection of JSON files. The runtime source of truth is the SQLite database; the older JSON question-bank layout is now primarily a migration/import/export format.

---

## 1. Architecture

```text
                         ┌───────────────────────┐
                         │       Browser         │
                         └───────────┬───────────┘
                                     │ HTTP
                         ┌───────────▼───────────┐
                         │      Flask / API      │
                         │        app.py         │
                         └───────────┬───────────┘
                                     │
                         ┌───────────▼───────────┐
                         │       SQLite          │
                         │ data/question_bank.db │
                         └────────────────────────┘
```

The frontend is split conceptually into two experiences:

```text
Admin / CMS
    Vite
      ├── Lexical editor
      ├── MathLive math input
      └── structured-content renderer

Public question bank
    Vite
      └── lightweight renderer
            └── MathJax rendering
```

The browser never downloads the SQLite database. The browser requests paginated question data and individual question records through Flask APIs.

---

## 2. Backend

### Flask

The backend entry point is:

```text
app.py
```

Responsibilities include:

- SQLite connection management
- question CRUD
- search/filter/pagination
- question navigation
- collections and sets
- topics and subtopics
- tags
- group questions
- bulk collection/set assignment
- source-image serving
- frontend/static-file serving

SQLite connections are created per Flask request and closed through Flask's application-context teardown.

SQLite uses:

```text
foreign_keys = ON
busy_timeout = 5000
WAL journal mode
```

### Important API groups

Questions:

```text
GET  /api/questions
GET  /api/questions/<uuid>
PUT  /api/questions/<uuid>
GET  /api/questions/<uuid>/neighbors
GET  /api/questions/<uuid>/source
POST /api/questions/bulk-assign
```

Groups:

```text
GET /api/groups/<uuid>
```

Catalogs:

```text
GET  /api/collections
POST /api/collections
POST /api/collections/<id>/sets
PUT  /api/collections/<id>
PUT  /api/collections/<id>/sets/<id>

GET  /api/topics
POST /api/topics
POST /api/topics/<id>/subtopics
PUT /api/topics/<id>
PUT /api/topics/<id>/subtopics/<id>

GET /api/tags
```

Health:

```text
GET /api/health
```

---

## 3. SQLite database

The runtime database is:

```text
data/question_bank.db
```

The schema is defined in:

```text
data/schema.sql
```

Important tables:

```text
collections
sets
topics
subtopics

questions
groups
group_children

question_topics
question_collections
question_tags

question_fts
```

### Question record

The `questions` table keeps relational/searchable metadata in normal SQLite columns:

```text
id
type
group_id
question_number
grade
marks
difficulty
review_status
publication_status
created_at
updated_at
```

Structured content is stored in JSON columns:

```text
content_json
options_json
answer_json
solution_json
figures_json
tags_json
source_json
```

This gives us a hybrid model:

```text
Relational data
    → filtering, joins, indexes, counts

Structured JSON
    → ordered mathematical question content
```

### Full-text search

SQLite FTS5 is used through:

```text
question_fts
```

The backend converts structured content into searchable plain text using:

```text
content_model.py
```

UUID searches are handled separately as exact ID lookups.

---

## 4. Canonical content model

The application no longer treats a question as one undifferentiated HTML/text string.

Question, option, solution, and group content are represented as ordered content blocks.

Current block types include:

```text
paragraph
bullet_list
numbered_list
table
figure
math
```

Inline content can contain:

```text
text
math
```

Text nodes may contain marks such as:

```text
bold
italic
underline
strikethrough
```

### Example

```json
{
  "content": [
    {
      "type": "paragraph",
      "inlines": [
        {
          "type": "text",
          "text": "Consider the function "
        },
        {
          "type": "math",
          "latex": "f(x)=\\frac{1}{x}",
          "display": false
        }
      ]
    },
    {
      "type": "table",
      "header_rows": 1,
      "rows": [
        {
          "cells": [
            {
              "content": [
                {
                  "type": "paragraph",
                  "inlines": [
                    {"type": "text", "text": "x"}
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

The schemas are maintained in:

```text
schema/
├── content-block.schema.json
├── question.schema.json
└── group.schema.json
```

The Python helpers for this model are in:

```text
content_model.py
```

---

## 5. Mathematical representation

LaTeX is the canonical representation of mathematical expressions.

The important separation is:

```text
MathLive
    ↓
authoring/input

LaTeX
    ↓
stored representation

MathJax
    ↓
browser rendering
```

The application does not store the rendered HTML/SVG as canonical question content.

This keeps the mathematical content portable to future clients such as:

- mobile
- web
- PDF generation
- other exporters

---

## 6. Admin/CMS frontend

Frontend source:

```text
frontend/src/
├── admin.js
├── collections.js
├── topics.js
├── public.js
├── editor/
│   └── content-editor.js
└── shared/
    └── content-renderer.js
```

### Admin application

The CMS page is:

```text
/cms
```

The main admin module is:

```text
frontend/src/admin.js
```

It handles:

- paginated question loading
- search and filtering
- question navigation
- editor hydration
- save operations
- source preview
- topic/subtopic classification
- collection/set classification
- tags
- review/publication status
- group navigation
- bulk collection/set operations

### Rich editor

The rich content editor is:

```text
frontend/src/editor/content-editor.js
```

It is built with the open-source Lexical packages currently pinned in:

```text
frontend/package.json
```

Current editor functionality includes:

- bold
- italic
- underline
- lists
- tables
- figures
- mathematical blocks
- undo/redo
- structured content serialization

Math input uses:

```text
MathLive
```

The editor stores canonical TOMATO content blocks rather than storing Lexical's internal state as the application database schema.

### Shared renderer

The renderer is:

```text
frontend/src/shared/content-renderer.js
```

The same content representation can therefore be rendered by both admin and public interfaces.

---

## 7. Public question bank

Public source:

```text
frontend/src/public.js
frontend/public.html
frontend/public.css
```

The public root route is:

```text
/
```

The public view provides:

- Collections & Sets
- Topics & Subtopics
- catalog search
- question-count sorting
- question search
- filters
- paginated question loading
- group-question context
- previous/next navigation
- clickable MCQ options
- Check Answer behavior
- solution reveal
- MathJax rendering

Navigation state is held in the frontend application state; the public catalog does not need to transmit the full question bank to the browser.

---

## 8. Vite frontend build

Frontend project:

```text
frontend/package.json
frontend/vite.config.js
```

Vite builds four HTML entry points:

```text
index.html
public.html
collections.html
topics.html
```

Build output:

```text
frontend/dist/
```

The built frontend is served by Flask.

### Development

Terminal 1:

```bash
python app.py
```

Terminal 2:

```bash
cd frontend
npm run dev
```

Vite runs on port 5173 and proxies API requests to Flask on port 5000.

### Production build

```bash
cd frontend
npm install
npm run build
```

For reproducible dependency installation, keep the generated:

```text
frontend/package-lock.json
```

in version control.

`node_modules/` and `dist/` should remain ignored.

---

## 9. Python dependencies

Current runtime dependencies are intentionally small:

```text
Flask
gunicorn
```

SQLite uses Python's standard-library `sqlite3` module, so no SQLite package is required in `requirements.txt`.

The current `requirements.txt` therefore does not need additional runtime packages solely because the application moved from JSON to SQLite.

Some older utility scripts use additional packages such as Pillow. Those are ingestion/maintenance utilities, not runtime Cloud Run dependencies. If those utilities remain in active use, their dependencies should be installed in the environment used for those utilities rather than adding unnecessary packages to the production runtime.

---

## 10. Data migration

The main migration utility is:

```text
utils/migrate_json_to_sqlite.py
```

It can migrate an older JSON-backed project directly into SQLite.

Typical usage:

```bash
python utils/migrate_json_to_sqlite.py \
    --project "path/to/legacy/project" \
    --db "data/question_bank.db" \
    --reset
```

The migration reads legacy question/group JSON plus the legacy catalog/mapping JSON files, then creates the relational SQLite structure and canonical structured content.

Source JSON is not modified by the migration.

### Exporting back to JSON

```text
utils/export_sqlite_to_json.py
```

can recreate a portable JSON representation from the database.

### Database utilities

```text
utils/inspect_sqlite.py
utils/backup_sqlite.py
```

are intended for routine inspection and backup.

---

## 11. Legacy JSON data

The application no longer uses these as its runtime source of truth:

```text
data/questions/*/question.json
data/groups/*/group.json
data/collections.json
data/topics.json
data/mappings/question_topics.json
data/mappings/question_collections.json
data/tag_pool.json
```

They are useful as:

- migration sources
- archival evidence
- export/import material
- ingestion interchange data

The question/group **source images** are different: those can still be needed by the CMS for source inspection and should not be deleted merely because the JSON records have been migrated.

For a production deployment, keep the runtime database and necessary media assets separate from legacy migration data.

---

## 12. Utilities

The `utils/` directory contains both current database utilities and older one-time ingestion/cleanup tools.

Current/important:

```text
migrate_json_to_sqlite.py
export_sqlite_to_json.py
inspect_sqlite.py
backup_sqlite.py
```

Legacy / migration-era tools:

```text
repair_latex_json.py
create_math_validation_bundle.py
validate_mathjax_bundle.js
update_mcq_answers_from_csv.py
export_topics_missing_qs.py
crop_questions.py
misc.py
```

These are not imported by the Flask application.

Some of them are useful when working with the older JSON ingestion pipeline; they do not belong in the runtime execution path.

---

## 13. Cloud Run deployment

Cloud Run is a good fit for the Flask/Vite application, but there is one important storage limitation.

Cloud Run's writable container filesystem is ephemeral and instance-local. Data written there is lost when the instance stops. Cloud Run documentation recommends persistent external storage for data that must survive instance shutdown. See the Cloud Run container runtime documentation.

This has an important consequence for the current SQLite design:

```text
SQLite + writable CMS
+
multiple Cloud Run instances
```

is **not a durable production persistence architecture**.

A database bundled into the container image can support read-only/public use, but CMS edits made to one instance are not a durable shared database.

For a production multi-user CMS, the long-term storage layer should therefore move to a persistent database service such as PostgreSQL/Cloud SQL while retaining the current question/content model and Flask API boundaries.

Source images should likewise use durable storage rather than relying on the writable Cloud Run filesystem.

### Web-server entrypoint

This repository contains `gunicorn` in `requirements.txt`, but the current `Procfile` still contains:

```text
web: python app.py
```

For Cloud Run, the production entrypoint should use a WSGI server such as Gunicorn and bind to Cloud Run's `$PORT`.

A typical entrypoint is:

```text
web: gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 app:app
```

The exact worker/thread configuration should be tuned for the service.

For local development, `python app.py` remains convenient.

---

## 14. Recommended production project hygiene

Before treating the repository as the long-term production repository:

1. Keep `frontend/package-lock.json`.
2. Keep `node_modules/` and `frontend/dist/` out of version control.
3. Keep the production Python requirements minimal.
4. Move legacy JSON migration material out of the runtime data directory when the ingestion process is fully migrated to SQLite.
5. Keep source images/assets in durable storage for Cloud Run.
6. Move the writable SQLite database to persistent database infrastructure before relying on Cloud Run for multi-user CMS writes.
7. Use Gunicorn for the Cloud Run web process.

---

## 15. Local URLs

```text
Public:
http://127.0.0.1:5000/

CMS:
http://127.0.0.1:5000/cms

Collections management:
http://127.0.0.1:5000/collections

Topics management:
http://127.0.0.1:5000/topics
```

---

## 16. Current source-of-truth principle

The intended hierarchy is:

```text
Source PDF / source images
        ↓
Ingestion / migration tools
        ↓
SQLite + canonical content model
        ↓
CMS editing
        ↓
Public question bank
```

The CMS/database is the authoritative edited representation of a question.

OCR or legacy JSON is evidence/input, not the final authority.
