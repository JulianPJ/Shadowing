<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project context

Before making product, architecture, roadmap, media-provider, or deployment changes, read `PROJECT_CONTEXT.md`.

It is the persistent source of truth for the product purpose, current implementation, Cloudflare deployment context, development priorities, and post-MVP roadmap.

**Current P0:** the production YouTube → lesson path is now verified through the caption relay. The relay host still runs on the verification Windows computer, so move it to supervised, always-on hosting and re-verify production before starting post-MVP feature work.
