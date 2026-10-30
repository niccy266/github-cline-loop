# Docker Container Update Guide

This guide explains how to update the Docker container to the latest version.

## Prerequisites

- Docker installed and running
- Access to the repository (or the built image)
- Git installed (optional, for pulling source code)

---

## Method 1: Update via Docker Compose (Recommended)

If you're using Docker Compose, follow these steps:

### 1. Pull the latest code (optional)
```bash
git pull origin master
```

### 2. Pull the latest image and recreate the container
```bash
docker-compose pull
docker-compose up -d --remove-orphans
```

### 3. Verify the update
```bash
docker-compose ps
docker-compose logs --tail=20 app
```

---

## Method 2: Update via Plain Docker

If you're using plain Docker commands:

### 1. Stop and remove the old container
```bash
docker stop cline-agent-loop
docker rm cline-agent-loop
```

### 2. Pull the latest image (if using a pre-built image)
```bash
docker pull your-registry/cline-agent-loop:latest
```

### 3. Start a new container with the same configuration
```bash
docker run -d --name cline-agent-loop \
  --restart unless-stopped \
  -v cline-data:/app/data \
  -p 3000:3000 \
  your-registry/cline-agent-loop:latest
```

---

## Method 3: Build from Source

If you want to build the image from source:

### 1. Clone or pull the repository
```bash
git clone <repo-url>
cd cline-agent-loop
# or if already cloned:
git pull origin master
```

### 2. Build the Docker image
```bash
docker build -t cline-agent-loop:latest .
```

### 3. Recreate the container
```bash
docker stop cline-agent-loop
docker rm cline-agent-loop
docker run -d --name cline-agent-loop \
  --restart unless-stopped \
  -v cline-data:/app/data \
  -p 3000:3000 \
  cline-agent-loop:latest
```

---

## Verify the Update

After updating, verify the container is running correctly:

```bash
# Check container status
docker ps | grep cline-agent-loop

# Check container logs
docker logs cline-agent-loop --tail=20

# Check the version (if available)
docker exec cline-agent-loop cline-agent-loop --version
```

---

## Rollback (If Needed)

If the update causes issues:

```bash
# Stop the current container
docker stop cline-agent-loop

# Recreate with the previous image
docker run -d --name cline-agent-loop \
  --restart unless-stopped \
  -v cline-data:/app/data \
  -p 3000:3000 \
  cline-agent-loop:previous-tag
```

---

## What to Back Up

Before updating, consider backing up:

| Data | Location | Why |
|------|----------|-----|
| GitHub claims state | Container volume | Session claims may be stale |
| Workspace directories | Container volume | ClineCore session data |
| Configuration | Host or container | Custom settings |

Use a named Docker volume for persistence:
```bash
docker volume create cline-data
```

---

## Troubleshooting

### Container fails to start
```bash
docker logs cline-agent-loop
```

### Image pull fails
- Check your network connection
- Verify the image name and registry
- Ensure you have permission to access the image

### Data loss after update
- Ensure you're using a named Docker volume (`-v cline-data:/app/data`)
- Do not rely on container-internal storage for persistence

---

## Summary of Commands

```bash
# Quick update with Docker Compose
docker-compose pull && docker-compose up -d --remove-orphans

# Quick update with plain Docker
docker stop cline-agent-loop && docker rm cline-agent-loop
docker run -d --name cline-agent-loop --restart unless-stopped -v cline-data:/app/data -p 3000:3000 cline-agent-loop:latest
```
