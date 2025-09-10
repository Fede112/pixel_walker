# Pixel Walker

## Folder Structure

- `game/server/` — Node.js + socket.io server (TypeScript)
  - `src/index.ts` — Main server entry point
- `game/client/` — PixiJS browser client (TypeScript, Vite)
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

### Build

```
pnpm build
```

This will run on both client and server

---
Keep it simple. Edit code in `src/` folders and shared types in `shared/types.ts`.
