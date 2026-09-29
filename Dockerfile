# ============================================================
# Stage 1: Build the Vite frontend
# ============================================================
FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./

RUN npm ci

COPY frontend/ ./

RUN npm run build


# ============================================================
# Stage 2: Python / Flask runtime
# ============================================================
FROM python:3.13-slim

WORKDIR /app

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY app.py ./
COPY content_model.py ./

# Copy database and other application data
COPY data/ ./data/

# Copy any other backend/project files that the application may need
COPY schema/ ./schema/
COPY utils/ ./utils/

# Copy the Vite production build from Stage 1
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Cloud Run provides PORT; gunicorn listens on it.
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 app:app