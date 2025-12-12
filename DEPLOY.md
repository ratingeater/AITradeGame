# Deployment Guide

## 1. Architecture Overview

AITradeGame consists of two parts:
1.  **Frontend**: React + Vite (Can be deployed to Vercel/Netlify)
2.  **Backend**: Python Flask + SQLite + Background Trading Loop (Requires a persistent server like VPS, Railway, or Render)

**Important**: Because the trading bot runs a continuous background loop (`while True`) to monitor markets and execute trades, the backend **cannot** be deployed as a standard Serverless Function (e.g., Vercel Functions) which has execution time limits.

## 2. Deploying the Frontend to Vercel

1.  Push this repository to GitHub.
2.  Import the project in Vercel.
3.  Configure the Build Settings:
    *   **Framework Preset**: Vite
    *   **Build Command**: `npm run build`
    *   **Output Directory**: `dist`
4.  **Environment Variables**:
    *   If your backend is deployed elsewhere (e.g., Railway), you need to configure the API proxy or update the frontend to point to the backend URL.
    *   Currently, the frontend uses relative paths (`/api/...`). You may need to set up a rewrite rule in `vercel.json` to proxy requests to your backend.

## 3. Deploying the Backend

Recommended platforms: **Railway**, **Render**, or a **VPS** (DigitalOcean, AWS).

### Option A: Railway / Render (Docker)
1.  The project includes a `Dockerfile` (or you can create one).
2.  Deploy the repository.
3.  Start command: `bash start_backend.sh`
4.  **Persistent Storage**: Since this app uses SQLite (`AITradeGame.db`), you **must** mount a persistent volume for the database file. Otherwise, you will lose data on every redeploy.

### Option B: VPS (Ubuntu/Debian)
1.  Clone the repo.
2.  Install Python 3.11+ and Node.js.
3.  Run `pip install -r requirements.txt`.
4.  Run `npm install && npm run build`.
5.  Start the backend: `nohup bash start_backend.sh &`.
6.  Serve the frontend using Nginx or let Flask serve the `dist` folder.

## 4. Authentication

The app is protected by a password.
*   **Default Password**: `admin`
*   **Change Password**: Set the `AUTH_PASSWORD` environment variable on your backend server.

## 5. Vercel Configuration (Frontend Only)

If you deploy the frontend to Vercel and backend to `https://my-backend.railway.app`, add a `vercel.json` to the root:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://my-backend.railway.app/api/:path*"
    }
  ]
}
```
