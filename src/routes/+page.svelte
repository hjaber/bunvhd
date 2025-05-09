<script lang="ts">
  import { cubicOut } from "svelte/easing";
  import { Tween } from "svelte/motion";

  interface QueryResponse {
    data: any | any[] | null;
    timeMs: number;
    binding: string;
    error?: string | null;
    colo?: string;
  }

  interface BenchmarkResult {
    clientTime: number | null;
    serverTime: number | null;
    binding: string | null;
    error: string | null;
    colo?: string | null;
  }

  interface RunResult {
    runId: number;
    results: Record<string, BenchmarkResult>;
  }

  interface AverageResult {
    avgClientTime: number | null;
    avgServerTime: number | null;
  }

  const ENDPOINTS = [
    // US East Region - Hyperdrive
    {
      id: "hyperdriveCachedUSEast",
      url: "/api/cached-query-us-east?cdnCache=30",
      label: "Hyperdrive US East 🇺🇸 CDN-Cached",
      region: "us-east",
      type: "hyperdrive",
      cached: true,
      description: "Worker: Hyperdrive query. CDN cached. DB: US East.",
    },
    {
      id: "hyperdriveNonCachedUSEast",
      url: "/api/non-cached-query-us-east?_nc=true",
      label: "Hyperdrive US East 🇺🇸 Non-Cached",
      region: "us-east",
      type: "hyperdrive",
      cached: false,
      description:
        "Worker: Hyperdrive query. Dynamic URL (no CDN), fresh data. Hyperdrive pooling. DB: US East.",
    },

    // US East Region - Bun REST (via SvelteKit Proxy)
    {
      id: "bunCachedUSEast",
      url: "/api/bun-cached-us-east?cdnCache=30",
      label: "Bun REST US East 🇺🇸 CDN-Cached",
      region: "us-east",
      type: "bun-rest",
      cached: true,
      description:
        "Worker: proxies Bun API. CDN cached. Bun API & DB: US East.",
    },
    {
      id: "bunNonCachedUSEast",
      url: "/api/bun-non-cached-us-east?_nc=true",
      label: "Bun REST US East 🇺🇸 Non-Cached",
      region: "us-east",
      type: "bun-rest",
      cached: false,
      description:
        "Worker: proxies Bun API. Non-CDN cached, fresh data. Bun API & DB: US East.",
    },

    // US West Region - Hyperdrive
    {
      id: "hyperdriveCachedUSWest",
      url: "/api/cached-query-us-west?cdnCache=30",
      label: "Hyperdrive US West 🇺🇸 CDN-Cached",
      region: "us-west",
      type: "hyperdrive",
      cached: true,
      description: "Worker: Hyperdrive query. CDN cached. DB: US West.",
    },
    {
      id: "hyperdriveNonCachedUSWest",
      url: "/api/non-cached-query-us-west?_nc=true",
      label: "Hyperdrive US West 🇺🇸 Non-Cached",
      region: "us-west",
      type: "hyperdrive",
      cached: false,
      description:
        "Worker: Hyperdrive query. Dynamic URL (no CDN), fresh data. Hyperdrive pooling. DB: US West.",
    },

    // US West Region - Bun REST (via SvelteKit Proxy)
    {
      id: "bunCachedUSWest",
      url: "/api/bun-cached-us-west?cdnCache=30",
      label: "Bun REST US West 🇺🇸 CDN-Cached",
      region: "us-west",
      type: "bun-rest",
      cached: true,
      description:
        "Worker: proxies Bun API. CDN cached. Bun API & DB: US West.",
    },
    {
      id: "bunNonCachedUSWest",
      url: "/api/bun-non-cached-us-west?_nc=true",
      label: "Bun REST US West 🇺🇸 Non-Cached",
      region: "us-west",
      type: "bun-rest",
      cached: false,
      description:
        "Worker: proxies Bun API. Non-CDN cached, fresh data. Bun API & DB: US West.",
    },

    // Helsinki Region - Hyperdrive
    {
      id: "hyperdriveCachedLocal",
      url: "/api/cached-query?cdnCache=30",
      label: "Hyperdrive Helsinki 🇫🇮 CDN-Cached",
      region: "helsinki",
      type: "hyperdrive",
      cached: true,
      description: "Worker: Hyperdrive query. CDN cached. DB: Helsinki.",
    },
    {
      id: "hyperdriveNonCachedLocal",
      url: "/api/non-cached-query?_nc=true",
      label: "Hyperdrive Helsinki 🇫🇮 Non-Cached",
      region: "helsinki",
      type: "hyperdrive",
      cached: false,
      description:
        "Worker: Hyperdrive query. Dynamic URL (no CDN), fresh data. Hyperdrive pooling. DB: Helsinki.",
    },

    // Helsinki Region - Bun REST (via SvelteKit Proxy)
    {
      id: "bunCachedHEL",
      url: "/api/bun-cached-hel?cdnCache=30",
      label: "Bun REST Helsinki 🇫🇮 CDN-Cached",
      region: "helsinki",
      type: "bun-rest",
      cached: true,
      description:
        "Worker: proxies Bun API. CDN cached. Bun API & DB: Helsinki.",
    },
    {
      id: "bunNonCachedHEL",
      url: "/api/bun-non-cached-hel?_nc=true",
      label: "Bun REST Helsinki 🇫🇮 Non-Cached",
      region: "helsinki",
      type: "bun-rest",
      cached: false,
      description:
        "Worker: proxies Bun API. Non-CDN cached, fresh data. Bun API & DB: Helsinki.",
    },
  ] as const;

  type EndpointId = (typeof ENDPOINTS)[number]["id"];

  const RUN_COUNT = 3;
  const DELAY_BETWEEN_RUNS_MS = 3000;

  let benchmarkRuns = $state<RunResult[]>([]);
  let isLoading = $state(false);
  let overallError = $state<string | null>(null);
  let benchmarkStatus = $state<string | null>(null);

  const initialAverageResults = Object.fromEntries(
    ENDPOINTS.map((ep) => [ep.id, { avgClientTime: null, avgServerTime: null }])
  ) as Record<EndpointId, AverageResult>;
  let averageResults = $state<Record<EndpointId, AverageResult>>(
    initialAverageResults
  );

  let bestAvgClientTime = $state<number | null>(null);
  let worstAvgClientTime = $state<number | null>(null);
  let bestAvgServerTime = $state<number | null>(null);
  let worstAvgServerTime = $state<number | null>(null);

  const progress = new Tween(0, { duration: 300, easing: cubicOut });

  function shuffleArray<T>(array: T[]): T[] {
    let currentIndex = array.length;
    while (currentIndex !== 0) {
      const randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex--;
      [array[currentIndex], array[randomIndex]] = [
        array[randomIndex],
        array[currentIndex],
      ];
    }
    return array;
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatTime(timeMs: number | null): string {
    if (timeMs === null || timeMs === undefined) return "N/A";
    if (timeMs < 1) return `<1 ms`;
    if (timeMs < 10) return `${timeMs.toFixed(1)} ms`;
    return `${Math.round(timeMs)} ms`;
  }

  // Modify the measureFetch function to generate unique paths for non-cached endpoints
  async function measureFetch(url: string): Promise<BenchmarkResult> {
    // If this is a non-cached endpoint, generate a unique path instead of using query parameters
    let fetchUrl = url;
    if (url.includes("_nc")) {
      // For API endpoints using the SvelteKit [endpoint] dynamic route
      if (url.startsWith("/api/")) {
        // Extract the base endpoint name
        const urlObj = new URL(url, window.location.origin);
        const pathParts = urlObj.pathname.split("/");
        const baseEndpoint = pathParts[2]; // The [endpoint] part in /api/[endpoint]

        // Create a new unique endpoint with timestamp
        const timestamp = Date.now();
        const randomSuffix = Math.floor(Math.random() * 1000);
        const uniqueEndpoint = `${baseEndpoint}-${timestamp}-${randomSuffix}`;

        // Replace the endpoint in the path
        pathParts[2] = uniqueEndpoint;
        urlObj.pathname = pathParts.join("/");

        // Keep any existing query parameters except _r which is no longer needed
        const params = new URLSearchParams(urlObj.search);
        params.delete("_r"); // Remove the _r parameter since we're using path-based differentiation
        urlObj.search = params.toString();

        fetchUrl = urlObj.toString();
      }
    }

    const startTime = performance.now();
    try {
      const response = await fetch(fetchUrl, {
        cache: "no-cache",
        headers: { Accept: "application/json" },
      });

      const clientTime = performance.now() - startTime;

      if (!response.ok) {
        const errorText = await response
          .text()
          .catch(() => "Could not read error body");
        throw new Error(
          `HTTP ${response.status} ${response.statusText}: ${errorText.substring(0, 200)}`
        );
      }

      let jsonResult: Partial<QueryResponse>;
      try {
        jsonResult = await response.json();
      } catch (parseError: any) {
        console.error(`Error parsing JSON from ${fetchUrl}:`, parseError);
        throw new Error(`Invalid JSON response received.`);
      }

      if (
        !jsonResult.error &&
        (typeof jsonResult?.timeMs !== "number" ||
          typeof jsonResult?.binding !== "string")
      ) {
        console.warn(
          `Received unexpected structure from ${fetchUrl}:`,
          jsonResult
        );
        throw new Error(
          "Invalid response structure (missing timeMs or binding)."
        );
      }

      return {
        clientTime: clientTime,
        serverTime: jsonResult.timeMs ?? null,
        binding: jsonResult.binding ?? "Unknown",
        error: jsonResult.error ?? null,
      };
    } catch (error: any) {
      const clientTimeSoFar = performance.now() - startTime;
      console.error(`Error fetching ${fetchUrl}:`, error);
      return {
        clientTime: clientTimeSoFar,
        serverTime: null,
        binding: "Fetch Error",
        error: error.message || "Unknown fetch error",
      };
    }
  }

  async function runBenchmark() {
    isLoading = true;
    overallError = null;
    benchmarkStatus = "Initializing benchmark...";
    benchmarkRuns = [];
    averageResults = { ...initialAverageResults };
    bestAvgClientTime = null;
    worstAvgClientTime = null;
    bestAvgServerTime = null;
    worstAvgServerTime = null;
    progress.set(0, { duration: 0 });

    const totalQueries = RUN_COUNT * ENDPOINTS.length;
    let queriesCompleted = 0;

    try {
      for (let i = 0; i < RUN_COUNT; i++) {
        const currentRunId = i + 1;
        benchmarkStatus = `Starting Run ${currentRunId}/${RUN_COUNT}...`;

        if (i > 0) {
          benchmarkStatus = `Pausing for ${DELAY_BETWEEN_RUNS_MS / 1000}s before Run ${currentRunId}...`;
          await delay(DELAY_BETWEEN_RUNS_MS);
          benchmarkStatus = `Starting Run ${currentRunId}/${RUN_COUNT}...`;
        }

        const shuffledEndpoints = shuffleArray([...ENDPOINTS]);
        console.log(
          ` Run ${currentRunId} order:`,
          shuffledEndpoints.map((e) => e.label)
        );

        const initialRunResults: Record<string, BenchmarkResult> = {};
        ENDPOINTS.forEach((ep) => {
          initialRunResults[ep.id] = {
            clientTime: null,
            serverTime: null,
            binding: "Pending...",
            error: null,
          };
        });
        if (!benchmarkRuns.find((run) => run.runId === currentRunId)) {
          benchmarkRuns = [
            ...benchmarkRuns,
            { runId: currentRunId, results: initialRunResults },
          ];
        }

        const currentRunResults: Record<string, BenchmarkResult> = {};

        for (let j = 0; j < shuffledEndpoints.length; j++) {
          const endpoint = shuffledEndpoints[j];
          const queryNumberInRun = j + 1;

          benchmarkStatus = `Run ${currentRunId}/${RUN_COUNT}: Query ${queryNumberInRun}/${shuffledEndpoints.length} - Fetching ${endpoint.label}...`;

          const result = await measureFetch(endpoint.url);
          currentRunResults[endpoint.id] = result;

          benchmarkRuns = benchmarkRuns.map((run) =>
            run.runId === currentRunId
              ? { ...run, results: { ...run.results, [endpoint.id]: result } }
              : run
          );

          queriesCompleted++;
          await progress.set((queriesCompleted / totalQueries) * 100);
        }

        benchmarkRuns = benchmarkRuns.map((run) =>
          run.runId === currentRunId
            ? { ...run, results: currentRunResults }
            : run
        );

        benchmarkStatus = `Run ${currentRunId}/${RUN_COUNT} completed.`;
      }

      benchmarkStatus = "Benchmark finished. Calculating averages...";
      calculateAverages();
      benchmarkStatus = "Benchmark complete!";
      await progress.set(100);
    } catch (error: any) {
      console.error("Benchmark sequence failed:", error);
      overallError =
        error.message || "An unexpected error stopped the benchmark.";
      benchmarkStatus = `Error: ${overallError}`;
    } finally {
      isLoading = false;
      if (overallError) {
        benchmarkStatus = `Benchmark failed: ${overallError}`;
      } else if (benchmarkStatus === "Benchmark complete!") {
        await delay(2000);
        if (!isLoading) benchmarkStatus = null;
      } else {
        benchmarkStatus = null;
      }
    }
  }

  function calculateAverages() {
    if (benchmarkRuns.length < RUN_COUNT) return;

    const relevantRuns = benchmarkRuns.slice(1, RUN_COUNT);
    if (relevantRuns.length === 0) return;

    const newAverages = {} as Record<EndpointId, AverageResult>;
    let minClient: number | null = null;
    let maxClient: number | null = null;
    let minServer: number | null = null;
    let maxServer: number | null = null;

    for (const endpoint of ENDPOINTS) {
      let totalClientTime = 0;
      let validClientCount = 0;
      let totalServerTime = 0;
      let validServerCount = 0;

      for (const run of relevantRuns) {
        const result = run.results?.[endpoint.id];
        if (result && result.error === null) {
          if (typeof result.clientTime === "number") {
            totalClientTime += result.clientTime;
            validClientCount++;
          }
          if (typeof result.serverTime === "number") {
            totalServerTime += result.serverTime;
            validServerCount++;
          }
        }
      }

      const avgClient =
        validClientCount > 0 ? totalClientTime / validClientCount : null;
      const avgServer =
        validServerCount > 0 ? totalServerTime / validServerCount : null;

      newAverages[endpoint.id] = {
        avgClientTime: avgClient,
        avgServerTime: avgServer,
      };

      if (avgClient !== null) {
        if (minClient === null || avgClient < minClient) minClient = avgClient;
        if (maxClient === null || avgClient > maxClient) maxClient = avgClient;
      }
      if (avgServer !== null) {
        if (minServer === null || avgServer < minServer) minServer = avgServer;
        if (maxServer === null || avgServer > maxServer) maxServer = avgServer;
      }
    }
    averageResults = newAverages;
    bestAvgClientTime = minClient;
    worstAvgClientTime = maxClient;
    bestAvgServerTime = minServer;
    worstAvgServerTime = maxServer;

    console.log(`Averages (Runs 2-${RUN_COUNT}):`, averageResults);
    console.log(
      `Best/Worst Client: ${bestAvgClientTime}/${worstAvgClientTime}, Server: ${bestAvgServerTime}/${worstAvgServerTime}`
    );
  }

  function getResult(
    runId: number,
    endpointId: EndpointId
  ): BenchmarkResult | undefined {
    const run = benchmarkRuns.find((r) => r.runId === runId);
    return run?.results?.[endpointId];
  }

  // Group endpoints by region and type for better display
  const regions = ["us-east", "us-west", "helsinki"];
  const types = ["hyperdrive", "bun-rest"];
  const cacheTypes = [true, false];

  function getRegionLabel(region: string) {
    if (region === "us-east") return "US East 🇺🇸";
    if (region === "us-west") return "US West 🇺🇸";
    return "Helsinki 🇫🇮";
  }

  function getTypeLabel(type: string) {
    return type === "hyperdrive" ? "Hyperdrive" : "Bun REST API";
  }

  function getCacheLabel(cached: boolean) {
    return cached ? "CDN-Cached" : "Non-Cached";
  }

  function getEndpointByProperties(
    region: string,
    type: string,
    cached: boolean
  ) {
    return ENDPOINTS.find(
      (e) => e.region === region && e.type === type && e.cached === cached
    );
  }

  function isWarmupRun(runId: number) {
    return runId === 1;
  }
</script>

<div class="container mx-auto p-4 sm:p-6 lg:p-8 space-y-6 font-sans">
  <header class="space-y-2">
    <h1 class="text-2xl sm:text-3xl font-bold text-gray-800">
      Database Performance Benchmark
    </h1>
    <p class="text-gray-600">
      Compare database query speeds: Cloudflare Hyperdrive vs. a standard Bun.js
      REST API. Tests run from your browser to servers in Helsinki 🇫🇮, US East
      🇺🇸, and US West 🇺🇸, all via Cloudflare Workers.
    </p>
  </header>

  <section class="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
    <h2 class="text-lg font-semibold text-gray-700 mb-2">How it Works</h2>
    <div class="text-sm text-gray-700 space-y-2">
      <p>
        This tool measures how quickly your browser gets data using two main
        methods, with all requests handled by a SvelteKit application on
        Cloudflare Workers:
      </p>
      <ul class="list-disc list-inside pl-4 space-y-1">
        <li>
          <strong>Hyperdrive:</strong> The Worker queries a regional database directly,
          accelerated by Hyperdrive's connection pooling.
        </li>
        <li>
          <strong>Bun REST API:</strong> The Worker fetches data from a regional
          Bun.js API, which then queries the database.
        </li>
      </ul>
      <p>
        The benchmark runs {RUN_COUNT} rounds, testing {ENDPOINTS.length} configurations
        (different regions, methods, caching) in a random order per round. A {DELAY_BETWEEN_RUNS_MS /
          1000}-second pause occurs between rounds (after the first). Averages
        are calculated from runs 2 to {RUN_COUNT} (run 1 is a warm-up).
      </p>
      <p><strong>Metrics Explained:</strong></p>
      <ul class="list-disc list-inside pl-4 space-y-1">
        <li>
          <strong>Client Time:</strong> Total time your browser waits for data, including
          all network and processing.
        </li>
        <li>
          <strong>Server Time:</strong> Database query execution time. For Hyperdrive,
          this is direct. For Bun REST, it's the time reported by the Bun API (excluding
          Worker-to-Bun API latency).
        </li>
      </ul>
      <p><strong>Caching Approaches:</strong></p>
      <ul class="list-disc list-inside pl-4 space-y-1 text-sm text-gray-700">
        <li>
          <strong>Browser Cache:</strong> Disabled for all benchmark tests.
        </li>
        <li>
          <strong>CDN-Cached:</strong> Responses from the Worker (whether via Hyperdrive
          or Bun API) are cached by Cloudflare's CDN for 30 seconds.
        </li>
        <li>
          <strong>Non-Cached:</strong> Unique URLs are used for each request to bypass
          CDN and aim for fresh data from the database. Hyperdrive still benefits
          from its internal connection pooling and statement caching.
        </li>
      </ul>
    </div>
  </section>

  <section class="flex flex-col sm:flex-row gap-4 items-center">
    <button
      onclick={runBenchmark}
      disabled={isLoading}
      class="px-5 py-2.5 bg-blue-600 text-white rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-200 w-full sm:w-auto flex items-center justify-center"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        class="w-5 h-5 mr-2 -ml-1 {isLoading ? 'animate-spin' : 'hidden'}"
      >
        <path
          fill-rule="evenodd"
          d="M15.312 11.424a5.5 5.5 0 01-9.201-4.752L3.05 3.05a7 7 0 1010.818 10.818l-2.556-2.448zM10 18a8 8 0 100-16 8 8 0 000 16z"
          clip-rule="evenodd"
        />
      </svg>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        class="w-5 h-5 mr-1 -ml-1 {isLoading ? 'hidden' : 'inline-block'}"
      >
        <path
          d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"
        />
      </svg>
      {isLoading
        ? `Running... (${Math.round(progress.current)}%)`
        : `Run Benchmark (${RUN_COUNT} Rounds)`}
    </button>
  </section>

  {#if isLoading || progress.current > 0}
    <div class="space-y-2">
      <div
        class="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700 overflow-hidden"
        role="progressbar"
        aria-valuenow={progress.current}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="Benchmark Progress"
      >
        <div
          class="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out"
          style:width="{progress.current}%"
        ></div>
      </div>
      {#if benchmarkStatus}
        <p class="text-sm text-center text-gray-600 h-4">
          {benchmarkStatus}
        </p>
      {/if}
    </div>
  {/if}

  {#if overallError && !isLoading}
    <div
      class="mt-4 p-4 bg-red-100 text-red-800 border border-red-300 rounded-md shadow-sm"
      role="alert"
    >
      <strong class="font-semibold">Benchmark Error:</strong>
      {overallError}
    </div>
  {/if}

  {#if benchmarkRuns.length > 0}
    <section class="mt-6 space-y-6">
      <h2 class="text-xl font-semibold text-gray-800">Results</h2>

      <div class="overflow-x-auto shadow-md rounded-lg border border-gray-300">
        <table class="w-full text-sm border-collapse benchmark-table">
          <caption
            class="text-base font-semibold p-2 text-left text-gray-700 bg-gray-50 border-b border-gray-300"
          >
            Benchmark Results (Lower is better)
          </caption>

          <thead class="bg-gray-100 text-xs">
            <tr>
              <th
                rowspan="2"
                class="p-2 border-b-2 border-r border-gray-300 font-semibold text-left sticky left-0 bg-gray-100 z-10"
              >
                Region
              </th>
              <th
                rowspan="2"
                class="p-2 border-b-2 border-r border-gray-300 font-semibold text-left sticky left-12 bg-gray-100 z-10"
              >
                Type
              </th>
              <th
                rowspan="2"
                class="p-2 border-b-2 border-r border-gray-300 font-semibold text-left sticky left-24 bg-gray-100 z-10"
              >
                Caching
              </th>

              {#each { length: RUN_COUNT } as _, i}
                {@const runId = i + 1}
                <th
                  colspan="3"
                  class="p-1.5 border-b border-r border-gray-300 font-semibold text-center {isWarmupRun(
                    runId
                  )
                    ? 'bg-amber-50'
                    : ''}"
                >
                  Run {runId}
                  {#if isWarmupRun(runId)}
                    <span class="text-amber-600 font-normal">(Warm-up)</span>
                  {/if}
                </th>
              {/each}

              <th
                colspan="2"
                class="p-1.5 border-b border-gray-300 font-semibold text-center bg-blue-50"
              >
                Avg (Runs 2-{RUN_COUNT})
              </th>
            </tr>

            <tr>
              {#each { length: RUN_COUNT } as _, i}
                {@const runId = i + 1}
                <th
                  class="px-2 py-1 border-b-2 border-r border-gray-300 font-semibold text-center {isWarmupRun(
                    runId
                  )
                    ? 'bg-amber-50'
                    : ''}">Client</th
                >
                <th
                  class="px-2 py-1 border-b-2 border-r border-gray-300 font-semibold text-center {isWarmupRun(
                    runId
                  )
                    ? 'bg-amber-50'
                    : ''}">Server</th
                >
                <th
                  class="px-2 py-1 border-b-2 border-r border-gray-300 font-semibold text-center {isWarmupRun(
                    runId
                  )
                    ? 'bg-amber-50'
                    : ''}">Colo</th
                >
              {/each}

              <th
                class="px-2 py-1 border-b-2 border-r border-gray-300 font-semibold text-center bg-blue-50 text-blue-800"
                >Client</th
              >
              <th
                class="px-2 py-1 border-b-2 border-gray-300 font-semibold text-center bg-blue-50 text-blue-800"
                >Server</th
              >
            </tr>
          </thead>

          <tbody>
            {#each regions as region}
              {#each types as type}
                {#each cacheTypes as cached}
                  {@const endpoint = getEndpointByProperties(
                    region,
                    type,
                    cached
                  )}
                  {#if endpoint}
                    {@const avg = averageResults[endpoint.id]}
                    <tr
                      class="border-b border-gray-200 last:border-b-0 hover:bg-blue-50"
                    >
                      <th
                        class="p-2 font-medium text-gray-900 text-left sticky left-0 bg-white border-r border-gray-200 z-5"
                      >
                        {getRegionLabel(region)}
                      </th>
                      <th
                        class="p-2 font-medium text-gray-900 text-left sticky left-12 bg-white border-r border-gray-200 z-5"
                      >
                        {getTypeLabel(type)}
                      </th>
                      <th
                        class="p-2 font-medium text-gray-900 text-left sticky left-24 bg-white border-r border-gray-200 z-5"
                      >
                        {getCacheLabel(cached)}
                      </th>

                      {#each { length: RUN_COUNT } as _, i}
                        {@const runId = i + 1}
                        {@const result = getResult(runId, endpoint.id)}

                        {#if result?.error}
                          <td
                            colspan="3"
                            class="p-1.5 text-red-600 text-xs border-r {isWarmupRun(
                              runId
                            )
                              ? 'bg-amber-50/30'
                              : ''}"
                          >
                            <p class="font-semibold">
                              {result.binding || "Error"}
                              {#if result.colo && result.colo !== "Error"}
                                ({result.colo})
                              {/if}
                            </p>
                            <p
                              class="text-[10px] mt-0.5 break-words max-w-[80px]"
                            >
                              {result.error}
                            </p>
                          </td>
                        {:else if !result || result.binding === "Pending..."}
                          <td
                            class="p-1.5 text-center text-gray-400 italic text-xs {isWarmupRun(
                              runId
                            )
                              ? 'bg-amber-50/30'
                              : ''}">...</td
                          >
                          <td
                            class="p-1.5 text-center text-gray-400 italic text-xs {isWarmupRun(
                              runId
                            )
                              ? 'bg-amber-50/30'
                              : ''}">...</td
                          >
                          <td
                            class="p-1.5 text-center text-gray-400 italic text-xs border-r {isWarmupRun(
                              runId
                            )
                              ? 'bg-amber-50/30'
                              : ''}">...</td
                          >
                        {:else}
                          <td
                            class="p-1.5 text-right whitespace-nowrap text-xs {isWarmupRun(
                              runId
                            )
                              ? 'bg-amber-50/30'
                              : ''}"
                          >
                            {formatTime(result.clientTime)}
                          </td>
                          <td
                            class="p-1.5 text-right whitespace-nowrap text-xs {isWarmupRun(
                              runId
                            )
                              ? 'bg-amber-50/30'
                              : ''}"
                          >
                            {formatTime(result.serverTime)}
                          </td>
                          <td
                            class="p-1.5 text-center whitespace-nowrap text-xs border-r {isWarmupRun(
                              runId
                            )
                              ? 'bg-amber-50/30'
                              : ''}"
                          >
                            {result.colo || "N/A"}
                          </td>
                        {/if}
                      {/each}

                      <td
                        class="p-1.5 text-right whitespace-nowrap text-xs font-medium bg-blue-50/50 border-r"
                        class:best={avg?.avgClientTime !== null &&
                          avg.avgClientTime === bestAvgClientTime}
                        class:worst={avg?.avgClientTime !== null &&
                          avg.avgClientTime === worstAvgClientTime}
                      >
                        {formatTime(avg?.avgClientTime)}
                      </td>
                      <td
                        class="p-1.5 text-right whitespace-nowrap text-xs font-medium bg-blue-50/50"
                        class:best={avg?.avgServerTime !== null &&
                          avg.avgServerTime === bestAvgServerTime}
                        class:worst={avg?.avgServerTime !== null &&
                          avg.avgServerTime === worstAvgServerTime}
                      >
                        {formatTime(avg?.avgServerTime)}
                      </td>
                    </tr>
                  {/if}
                {/each}
              {/each}
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {:else if !isLoading && !overallError}
    <p class="text-gray-500 mt-6 italic text-center">
      Click the button to start the benchmark.
    </p>
  {/if}
</div>

<style>
  /* Static sticky headers */
  .benchmark-table thead th {
    position: sticky;
    top: 0;
    z-index: 10;
  }

  /* Make sure sticky left columns work with hover */
  .benchmark-table tbody tr:hover th.sticky {
    background-color: #eff6ff !important;
  }

  /* Ensure sticky columns stay visible during scroll */
  .benchmark-table tbody th.sticky {
    z-index: 5;
  }

  /* Result highlighting */
  .benchmark-table td.best {
    background-color: #dcfce7 !important;
    font-weight: 600;
  }

  .benchmark-table td.worst {
    background-color: #fee2e2 !important;
  }

  /* Hover effects */
  .benchmark-table tbody tr:hover td.best {
    background-color: #bbf7d0 !important;
  }

  .benchmark-table tbody tr:hover td.worst {
    background-color: #fecaca !important;
  }

  .benchmark-table tbody tr:hover th {
    background-color: #eff6ff !important;
  }

  /* Mobile optimization - ensure no horizontal overflow */
  @media (max-width: 640px) {
    .benchmark-table th,
    .benchmark-table td {
      padding: 0.5rem 0.25rem;
      font-size: 0.7rem;
    }

    /* Only show core columns on very small screens */
    .benchmark-table th:nth-child(3),
    .benchmark-table td:nth-child(3) {
      display: none;
    }
  }
</style>
