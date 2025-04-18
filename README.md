# Database Performance Benchmark: Hyperdrive vs. Bun REST API

This is a SvelteKit application designed to benchmark and compare the performance of database queries accessed through different methods:

1.  **Cloudflare Hyperdrive:** Queries executed via the SvelteKit backend API routes (`/api/...`), leveraging Hyperdrive's connection pooling (tested with both cached and non-cached connections configured in Cloudflare). The SvelteKit backend itself is assumed to be running relatively close to the Hyperdrive instance (e.g., deployed on Cloudflare Pages/Workers).
2.  **Direct Bun REST API:** Queries made directly from the browser frontend to a separate REST API built with Bun (`bun-restful-api.ts`) and hosted remotely (in this case, Helsinki). Tested with and without server/CDN caching hints (`Cache-Control`).

The application runs multiple benchmark rounds, measures both client-side round-trip time and server-side processing time, and displays the results, including averages calculated excluding the initial warm-up run.

## Key Features

- Compares database query performance across different access patterns.
- Tests Cloudflare Hyperdrive (Cached & Non-Cached connections via SvelteKit backend).
- Tests a direct remote Bun REST API (with & without cache hints).
- Measures both **Client Time** (browser-measured round-trip including network latency) and **Server Time** (server-reported processing time excluding network latency).
- Runs multiple configurable rounds (`RUN_COUNT`).
- Randomizes endpoint testing order in each round.
- Calculates average results, excluding the first run as a warm-up.
- Displays detailed results per run and overall averages in a responsive table.
- Built with SvelteKit (using Svelte 5 Runes for reactivity) and Tailwind CSS.

## Technology Stack

- **Frontend:** SvelteKit, Svelte 5 (Runes), Tailwind CSS, TypeScript
- **Backend (SvelteKit API Routes):** Node.js (via SvelteKit adapter), Cloudflare Hyperdrive (configured via Cloudflare dashboard/`wrangler.jsonc`)
- **Backend (Remote API):** Bun, TypeScript (`bun-restful-api.ts`)
- **Build Tool:** Vite
- **Package Manager:** Bun
- **Deployment (Likely):** Cloudflare Pages/Workers (inferred from `wrangler.jsonc` for the SvelteKit app)

## Project Structure

```
.
├── bun-restful-api.ts # <-- The standalone REST API powered by Bun.js
├── bun.lock           # Bun lockfile
├── node_modules       # Project dependencies
├── package.json       # Project manifest and scripts
├── README.md          # This file
├── src                # SvelteKit application source code
│   └── routes         # Contains the main benchmark page (+)page.svelte and API routes (/api)
├── static             # Static assets
├── svelte.config.js   # SvelteKit configuration
├── tsconfig.json      # TypeScript configuration
├── vite.config.ts     # Vite configuration
├── wrangler.jsonc     # Cloudflare Wrangler configuration (for Hyperdrive bindings, deployment)
```

## Understanding the Results

- **Client Time:** Measured in _your browser_. This is the total time from sending the request to receiving the response headers. It **includes network latency** (the time for data to travel between your browser and the server) _plus_ the server's processing time. This will be significantly higher for the remote Bun API due to the physical distance.
- **Server Time:** Measured _on the server_ and reported in the API response. This is the time the server spent processing the request (e.g., querying the database). It **does not include network latency**.
- **Binding:** Indicates the data source or status reported by the server (e.g., Hyperdrive connection ID, cache status, database name).
- **Caching:**
  - The browser `Workspace` uses `cache: "no-cache"` to prevent the _browser's_ local cache from being used.
  - The "Hyperdrive Cached" endpoint relies on Hyperdrive's _connection pool caching_.
  - The "Bun REST Cached" endpoint uses a `Cache-Control` header, which _may_ be respected by intermediate CDNs (like Cloudflare's) even if the browser cache is bypassed, potentially leading to very low Client Times if a CDN cache hit occurs.
- **Averages:** Calculated using results from Run 2 and Run 3 (or `RUN_COUNT - 1` runs if `RUN_COUNT` changes) to exclude the potential "warm-up" effects of the first run.
