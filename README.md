# Pixel Walker

## Folder Structure

- `game/server/` — Node.js + socket.io server (TypeScript)
  - `src/index.ts` — Main server entry point
- `game/client/` — Canvas browser client (TypeScript, Vite)
  - `src/index.ts` — Main client entry point
  - `src/index.html` — Main HTML file
- `game/shared/` — Shared TypeScript types
  - `types.ts` — Shared interfaces for client/server

## Getting Started

### Install dependencies

```
pnpm install
```

### Development

Start both server and client together from the root:

```
pnpm dev
```

This will run both:
- Server at http://localhost:3000
- Client at http://localhost:5173 (Vite default)

## Local Pixel Art Generation (LLM)

An HTTP endpoint is available on the server to generate small ASCII pixel art using either a local LLM (via Ollama) or a fast deterministic mock fallback.

- Endpoint: `POST http://localhost:3000/api/pixelart`
- Body: `{ "prompt": "steel", "size": 16, "seed": 42 }`
- Response: `{ width, height, palette, grid, source }`

### Backends

- `PIXELGEN_BACKEND=ollama`: Use a local Ollama model (e.g., `phi3:mini` or `qwen2.5:3b`).
- `PIXELGEN_BACKEND=mock` (default): Use the deterministic mock generator.

Env vars (server):

- `PIXELGEN_BACKEND`: `ollama` or `mock`
- `OLLAMA_HOST`: default `http://localhost:11434`
- `OLLAMA_MODEL`: default `phi3:mini`

### Ollama Setup

1) Install Ollama and start the server:
   - `ollama serve`
2) Pull a small instruct/tiny model (examples):
   - `ollama pull phi3:mini`
   - or `ollama pull qwen2.5:3b`
3) Start the game server with backend enabled:
   - `PIXELGEN_BACKEND=ollama OLLAMA_MODEL=phi3:mini pnpm --filter ./game/server dev`

### Test with curl

```
curl -s -X POST http://localhost:3000/api/pixelart \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"steel","size":16,"seed":123}' | jq .
```

### Build

```
pnpm build
```

This will run on both client and server

---
Keep it simple. Edit code in `src/` folders and shared types in `shared/types.ts`.

## Controls

- Arrow keys: move
- E: grab/place
- 1/2: switch active slot
- C: craft (combine two items)
