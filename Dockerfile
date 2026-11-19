# Build the web app
FROM node:24-alpine AS web
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/index.html web/tsconfig.json web/vite.config.ts web/capacitor.config.ts ./
COPY web/public ./public
COPY web/src ./src
RUN npm run build

# The server
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY --from=web /build/dist ./static
ENV SLEEP_DB=/data/sleep.db
# Runs as a normal user; make sure it can read the code however the files' permissions arrived.
RUN chmod -R a+rX /app && useradd -u 1000 -m app && mkdir /data && chown app /data
USER app
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/api/status')" || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
