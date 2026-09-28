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


# Tomato QB

Tomato QB is a small Python/Flask application for managing and working with the question bank.

## Production

The app is currently deployed on Google Cloud Run:

https://tomato-qb-13736577417.asia-south1.run.app/public.html#home

## Repository

GitHub:

https://github.com/yathish1618/tomato_qb

The `main` branch is connected to Google Cloud Build for continuous deployment.

## Deployment architecture

```text
Local development
      │
      │ git commit + git push
      ▼
GitHub (main)
      │
      ▼
Google Cloud Build
      │
      │ Buildpack
      ▼
Artifact Registry
      │
      ▼
Google Cloud Run
      │
      ▼
Public HTTPS URL
```

After the initial setup, a normal:

```bash
git add .
git commit -m "Describe the change"
git push
```

triggers a new Cloud Build and, if the build succeeds, Cloud Run deploys a new revision automatically.

There is normally no need to manually click **Redeploy** in Cloud Run after a GitHub push.

## Python / build configuration

The project uses Google Cloud Buildpacks rather than a custom Dockerfile.

Files added for deployment:

### `requirements.txt`

```text
Flask==3.1.3
gunicorn==23.0.0
```

### `Procfile`

```text
web: gunicorn --bind :$PORT app:app
```

### `.python-version`

```text
3.13
```

The Python version is pinned because the current Google Cloud buildpack used by the deployment supports Python 3.13/3.14; Python 3.12 was rejected by the buildpack during the first deployment attempt.

## Cloud Run configuration

Current service:

- Service: `tomato-qb`
- Region: `asia-south1` (Mumbai)
- Authentication: Public access
- Billing: Request-based
- Minimum instances: `0`
- Maximum instances: `1`
- Memory: `512 MiB`
- CPU: `1`
- Container port: `8080`
- Request timeout: `300 seconds`
- Maximum concurrency: `80`
- Ingress: All
- Startup CPU boost: Disabled
- GPU: Disabled
- Ephemeral disk: Disabled

The service runs the Flask application from `app.py` using Gunicorn:

```text
gunicorn --bind :$PORT app:app
```

## GitHub → Cloud Run automatic deployment

The GitHub repository is connected to Google Cloud Build using the Google Cloud Build GitHub App.

The trigger watches:

```text
yathish1618/tomato_qb
branch: main
```

When a commit is pushed to `main`:

1. Cloud Build fetches the repository.
2. Google Cloud Buildpacks detect the Python application.
3. Dependencies from `requirements.txt` are installed.
4. A container image is built and stored in Artifact Registry.
5. Cloud Run deploys a new revision.
6. The new revision receives traffic automatically.

## Cost controls

The Google Cloud project is:

```text
Project name: Tomato QB
Project ID: tomato-qb
```

It is linked to the active Google Cloud billing account.

A Cloud Run **monthly spend cap of ₹1** was configured specifically for:

```text
Project: Tomato QB
Service: Cloud Run
```

This was deliberately chosen because the current priority is keeping costs as close to ₹0 as possible, even if the application becomes unavailable after the cap is reached.

Important: the Cloud Run spend cap applies to Cloud Run itself. Cloud Build and Artifact Registry have separate pricing/free-usage rules, so the spend cap is not a universal project-wide ₹1 guarantee.

## Git ignore rules

The repository intentionally excludes:

- the root `__pycache__` directory
- `.png`, `.jpg`, and `.jpeg` files directly inside individual question directories under `data/questions`

Images inside deeper subdirectories such as:

```text
data/questions/<question>/figures/
```

are retained.

The current `.gitignore` is:

```gitignore
# Root Python cache
/__pycache__/

# Images directly inside individual question folders
/data/questions/*/*.png
/data/questions/*/*.jpg
/data/questions/*/*.jpeg
```

## Important application note

The Flask application currently writes some mutable question-bank data to the local filesystem.

Cloud Run's local filesystem should **not** be treated as permanent persistent storage. If the application is later used as a real multi-user editing system, the writable data should be moved to persistent storage such as a database, Firestore, or Cloud Storage.

For the current testing/development deployment, this limitation is intentionally being left unchanged.

## Basic deployment workflow

For normal development:

```bash
cd C:\xampp\htdocs\tomato_qb

git status
git add .
git commit -m "Describe the change"
git push
```

Then monitor the deployment from:

**Google Cloud Console → Cloud Run → `tomato-qb` → Build history**

If a build fails, inspect the Cloud Build logs before changing the Cloud Run service configuration.

## Current status

The application is successfully deployed and accessible at the production URL above.

This setup is intended primarily for lightweight testing and sharing with a small number of users.

