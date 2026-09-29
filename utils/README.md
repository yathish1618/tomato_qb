# TOMATO utilities

## JSON → SQLite migration

```bash
python utils/migrate_json_to_sqlite.py --project . --db data/question_bank.db --reset
```

To migrate the JSON from another existing project directly into this project's database:

```bash
python utils/migrate_json_to_sqlite.py \
    --project "C:\path\to\current\tomato-qb" \
    --db "C:\path\to\this\tomato-qb\data\question_bank.db" \
    --reset
```

This reads the legacy question/group JSON and relationship/catalog JSON and writes the SQLite runtime database. It does not modify the source JSON.

The migrated content is converted to the canonical block model:

```text
question string → paragraph + inline math nodes
option string   → paragraph + inline math nodes
solution string → paragraph + inline math nodes
group string    → paragraph + inline math nodes
```

If a JSON record already contains `content`, `options`, or `solution` in the new block form, the migration preserves that structure.

For partial datasets, group child UUIDs not present in the migration input are reported and skipped.

## SQLite → JSON export

```bash
python utils/export_sqlite_to_json.py --db data/question_bank.db --output exported_json
```

This exports:

```text
questions/<UUID>/question.json
groups/<UUID>/group.json
collections.json
topics.json
mappings/question_topics.json
mappings/question_collections.json
```

## Database inspection

```bash
python utils/inspect_sqlite.py --db data/question_bank.db
```

## SQLite backup

```bash
python utils/backup_sqlite.py --db data/question_bank.db --output backups/question_bank.db
```

## LaTeX cleanup

`repair_latex_json.py` works on raw JSON text and defaults to a dry run.

```bash
python utils/repair_latex_json.py .
```

Apply changes only after reviewing the report:

```bash
python utils/repair_latex_json.py . --apply
```

Target selected UUIDs:

```bash
python utils/repair_latex_json.py . --apply --uuids UUID1 UUID2
```

## MathJax validation

`validate_mathjax_bundle.js` uses MathJax 3's TeX parser against the strings produced after JSON parsing — the same important boundary used by the frontend.

The validator requires Node.js and `mathjax-full` in the utility's npm environment.

Install its dependency:

```bash
cd utils
npm install
```

Create a lightweight JSON-only bundle:

```bash
python utils/create_math_validation_bundle.py . -o math-validation-bundle.zip
```

Extract it, then run:

```bash
node utils/validate_mathjax_bundle.js ./math-validation-bundle mathjax_errors.csv
```
