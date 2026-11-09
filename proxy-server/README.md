# SUF Obedník Proxy Server

A Node.js reverse proxy for the SUF school lunch system at `http://194.160.223.198`. It injects mobile-friendly CSS and a custom script (`suf-inject.js`) that adds meal images and allergen info to every lunch page.

## Prerequisites

- Node.js 18+
- npm

## Setup

```bash
cd proxy-server
npm install
```

## Running

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

The server listens on port **3000** (or `$PORT` env var).

## Accessing from your phone

1. Make sure your phone is on the **same WiFi** as your computer.
2. Find your computer's local IP (e.g. `192.168.1.42`):
   - Windows: `ipconfig` → look for IPv4 Address
   - macOS/Linux: `ifconfig` or `ip addr`
3. Open `http://192.168.1.42:3000` in your phone's browser.

## API

### `GET /api/image-search`

Searches for meal images server-side (no CORS issues).

| Param | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Meal name |
| `tiers` | | Comma-separated search terms to try in order |
| `force` | | `1` or `true` to bypass cache |
| `customQuery` | | Override search term |

**Response:**
```json
{
  "images": [{ "url": "...", "title": "...", "source": "dobruchut" }],
  "isFallback": false
}
```

## Deployment

Easy free-tier options:

- **[Fly.io](https://fly.io)**: `fly launch` then `fly deploy`
- **[Railway](https://railway.app)**: Connect GitHub repo, deploy automatically
- **[Render](https://render.com)**: New Web Service → connect repo → `npm start`

All support `PORT` env var automatically.
