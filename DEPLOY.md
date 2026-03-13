# Deployment

## Docker (recommended)

Build and run the full stack (frontend + backend) in a single container:

```bash
docker build -t 360-viewer .
docker run -p 8080:80 360-viewer
```

Open http://localhost:8080

No Python venv or Node setup required on the host.

## Local development

For development with hot reload:

1. **Backend:** `cd scripts && python server.py` (runs on port 5001)
2. **Frontend:** `npm run dev` (Vite dev server with proxy to backend)
