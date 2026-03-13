# Stage 1: Build frontend
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Runtime with Python backend
FROM python:3.12-slim

WORKDIR /app

# Copy built frontend
COPY --from=build /app/dist ./dist

# Copy backend
COPY requirements.txt ./
COPY scripts ./scripts

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 80

CMD ["gunicorn", "--bind", "0.0.0.0:80", "--chdir", "/app/scripts", "server:app"]
