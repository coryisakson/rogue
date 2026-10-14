# ADR 0001: Stack

Context: owner reads TS/C#/Python but does not write code; AI coding agents are most proficient in TypeScript; app is I/O bound (DB, model calls).
Decision: strict TypeScript across Astro SSR app and shared core; Postgres + pgvector as the only datastore; Python isolated workers only if PDF/OCR needs it; Rust only for a profiled hot spot.
Consequences: one language for web, MCP, bot and agents; type-safe shared library; no Rust expertise required.
