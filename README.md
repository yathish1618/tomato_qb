# TOMATO Question Bank CMS — Collections & Sets build

## Run
1. Install Flask: `pip install flask`
2. From this folder: `python app.py`
3. Open: `http://127.0.0.1:5000`

## Data
- `data/questions/<UUID>/question.json`
- `data/questions/<UUID>/source.png`
- `data/taxonomy.json`
- `data/tag_pool.json`
- `data/collections.json`
- `backups/questions/<UUID>/...`

## Collections and sets
Collections and sets are metadata, not physical folders. Questions remain in their UUID folders.

Each question may contain:
```json
"collection_id": "isi",
"set_id": "tomato-practice"
```

Existing question JSON files do not need to contain these keys initially. The CMS adds them when a question is saved or when a bulk assignment is performed. Bulk assignment overwrites existing values and creates a timestamped backup first.

`data/collections.json` stores the collection and set definitions. IDs are stable; names can be edited in the Collections & Sets panel.

## Bulk assignment
Use the sidebar filters (including Tag, Collection, and Set) to isolate the target questions. Click **Bulk Assign**, choose a collection and set, confirm, and the CMS updates every currently filtered question. Each changed JSON is backed up before replacement.

## Notes
- The UI remains plain HTML/CSS/JS with a tiny Flask filesystem API.
- No database, API key, React, or Node build step is required.
- MathJax is loaded from its CDN, matching the existing CMS reference.
