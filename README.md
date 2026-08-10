# King's Café — Customer Web App

Customer-facing, mobile-first web application for King's Café.

## Stack

- Next.js App Router
- React
- TypeScript (strict)
- Tailwind CSS
- ESLint

## Commands

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
```

## Architecture

- `src/app` — routes, layouts, and global styling
- `src/core` — application-wide configuration, errors, and base types
- `src/features` — business features isolated by domain
- `src/shared` — reusable UI and framework-agnostic helpers

Feature folders remain empty until their screen or business behavior is discussed and approved.
