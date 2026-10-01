# TOMATO Question Bank

TOMATO is a mathematics question-bank CMS and public question browser built around a Flask API, SQLite, and a Vite-powered frontend.

The runtime source of truth is the SQLite database;

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
cd frontend
npm run dev
```

Terminal 2:

```bash
python app.py
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

---


## 10. Utilities

The `utils/` directory contains both current database utilities and older one-time ingestion/cleanup tools.

The following two scripts are used under Bulk Operations as part of CMS view.

```text
utils/migrate_json_to_sqlite.py
utils/delete_questions_from_json.py
```

---

## 11. Cloud Run deployment

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

---

## 12. Local URLs

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

## 13. Production URLs

```text
Public:
https://tomato-qb-13736577417.asia-south1.run.app/

CMS:
https://tomato-qb-13736577417.asia-south1.run.app/cms
```

---