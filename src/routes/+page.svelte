<script lang="ts">
  import { cubicOut } from "svelte/easing";
  // Use Tween from svelte/motion (already runes-compatible)
  import { Tween } from "svelte/motion";
  // Import $state for reactive state management

  // --- Interfaces ---
  interface QueryResponse {
    data: any | any[] | null;
    timeMs: number; // Server-reported processing time
    binding: string;
    error?: string | null;
  }

  interface BenchmarkResult {
    clientTime: number | null; // Full round-trip time (measured by client)
    serverTime: number | null; // Processing time (reported by server)
    binding: string | null; // Source identifier (e.g., DB name, cache status)
    error: string | null;
  }

  interface RunResult {
    runId: number;
    results: Record<string, BenchmarkResult>; // Use string index for endpoint IDs
  }

  interface AverageResult {
    avgClientTime: number | null;
    avgServerTime: number | null;
  }

  // --- Constants ---
  const ENDPOINTS = [
    {
      id: "hyperdriveCached",
      url: "/api/cached-query",
      label: "Hyperdrive Cached",
      description:
        "Query via SvelteKit backend API using Cloudflare Hyperdrive (Cached Connection Pool). Server is local.",
    },
    {
      id: "hyperdriveNonCached",
      url: "/api/non-cached-query",
      label: "Hyperdrive Non-Cached",
      description:
        "Query via SvelteKit backend API using Cloudflare Hyperdrive (Non-Cached Connection Pool). Server is local.",
    },
    {
      id: "bunNonCached",
      url: "https://bunvhd-db-eu-east.tripcafe.org/", // Remote API
      label: "Bun REST Non-Cached",
      description:
        "Direct query to Bun REST API (Helsinki) with no server-side caching requested.",
    },
    {
      id: "bunCached",
      url: "https://bunvhd-db-eu-east.tripcafe.org/?cacheTtl=10", // Remote API with cache hint
      label: "Bun REST Cached (10s)",
      description:
        "Direct query to Bun REST API (Helsinki) requesting server/CDN caching for 10 seconds via Cache-Control header.",
    },
  ] as const;

  type EndpointId = (typeof ENDPOINTS)[number]["id"];

  const RUN_COUNT = 3;
  const DELAY_BETWEEN_RUNS_MS = 1000; // Delay to allow caches to potentially expire/settle

  // --- Reactive State using $state ---
  let benchmarkRuns = $state<RunResult[]>([]);
  let isLoading = $state(false);
  let overallError = $state<string | null>(null);

  // Initialize averageResults directly using $state
  const initialAverageResults = Object.fromEntries(
    ENDPOINTS.map((ep) => [ep.id, { avgClientTime: null, avgServerTime: null }])
  ) as Record<EndpointId, AverageResult>;
  let averageResults = $state<Record<EndpointId, AverageResult>>(
    initialAverageResults
  );

  // --- Motion ---
  // Tween remains the same, access its value with .current in the template
  const progress = new Tween(0, { duration: 300, easing: cubicOut });

  // --- Helper Functions ---
  /** Shuffles an array in place. */
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

  /** Creates a promise that resolves after a specified delay. */
  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Formats time in milliseconds for display. */
  function formatTime(timeMs: number | null): string {
    if (timeMs === null || timeMs === undefined) return "N/A";
    // Show more precision for very small numbers
    if (timeMs < 10) return `${timeMs.toFixed(2)} ms`;
    return `${timeMs.toFixed(1)} ms`;
  }

  // --- Core Logic Functions ---

  /**
   * Measures the time taken for a fetch request and parses the result.
   * Calculates 'clientTime' (network round-trip + server processing) and
   * extracts 'serverTime' (server-reported processing) from the response.
   */
  async function measureFetch(url: string): Promise<BenchmarkResult> {
    const startTime = performance.now();
    try {
      // Fetch the data
      // 'cache: "no-cache"' tells the BROWSER not to use its local cache.
      // It DOES NOT prevent intermediate caches (like CDNs) from serving
      // cached content if the server response has appropriate Cache-Control headers.
      const response = await fetch(url, {
        cache: "no-cache",
        headers: { Accept: "application/json" },
      });

      // Calculate client-side time immediately after response headers are received.
      // This includes network latency (request+response) and server processing time.
      const clientTime = performance.now() - startTime;

      // Handle HTTP errors
      if (!response.ok) {
        const errorText = await response
          .text()
          .catch(() => "Could not read error body");
        // Provide informative error including status and truncated text
        throw new Error(
          `HTTP ${response.status} ${response.statusText}: ${errorText.substring(0, 200)}`
        );
      }

      // Parse the JSON response
      let jsonResult: Partial<QueryResponse>;
      try {
        jsonResult = await response.json();
      } catch (parseError: any) {
        console.error(`Error parsing JSON from ${url}:`, parseError);
        throw new Error(`Invalid JSON response received.`);
      }

      // Validate the structure of the JSON response
      // 'timeMs' is the server-reported processing time.
      if (
        typeof jsonResult?.timeMs !== "number" ||
        typeof jsonResult?.binding !== "string"
      ) {
        console.warn(`Received unexpected structure from ${url}:`, jsonResult);
        throw new Error(
          "Invalid response structure (missing timeMs or binding)."
        );
      }

      // Return successful benchmark result
      return {
        clientTime: clientTime, // Full round-trip + server process time
        serverTime: jsonResult.timeMs, // Server-reported process time ONLY
        binding: jsonResult.binding,
        error: jsonResult.error ?? null, // Use null if error is missing or undefined
      };
    } catch (error: any) {
      // Handle fetch or processing errors
      const clientTimeSoFar = performance.now() - startTime;
      console.error(`Error fetching ${url}:`, error);
      // Return error result, including time spent before failure
      return {
        clientTime: clientTimeSoFar,
        serverTime: null,
        binding: "Error",
        error: error.message || "Unknown fetch error",
      };
    }
  }

  /** Runs the full benchmark sequence across all endpoints. */
  async function runBenchmark() {
    // --- Reset State ---
    isLoading = true;
    overallError = null;
    benchmarkRuns = [];
    averageResults = { ...initialAverageResults }; // Reset averages
    progress.set(0, { duration: 0 }); // Reset progress tween immediately

    try {
      // --- Loop Through Runs ---
      for (let i = 0; i < RUN_COUNT; i++) {
        // Add delay between runs (except before the first)
        if (i > 0) {
          await delay(DELAY_BETWEEN_RUNS_MS);
        }

        const currentRunId = i + 1;
        console.log(`Starting Run ${currentRunId}...`);

        // Shuffle endpoint order for each run to mitigate order effects
        const shuffledEndpoints = shuffleArray([...ENDPOINTS]);
        console.log(
          ` Run ${currentRunId} order:`,
          shuffledEndpoints.map((e) => e.label)
        );

        // --- Initialize Current Run Results Placeholder ---
        const currentRunResults: Record<string, BenchmarkResult> = {};
        ENDPOINTS.forEach((ep) => {
          currentRunResults[ep.id] = {
            clientTime: null,
            serverTime: null,
            binding: "Pending...",
            error: null,
          };
        });
        // Add the placeholder run to the state array (create new array for reactivity)
        benchmarkRuns = [
          ...benchmarkRuns,
          { runId: currentRunId, results: currentRunResults },
        ];

        // --- Execute Fetches in Parallel ---
        const fetchPromises = shuffledEndpoints.map((endpoint) =>
          measureFetch(endpoint.url).then((result) => ({
            id: endpoint.id, // Include ID to map results back
            result,
          }))
        );

        // Wait for all fetches in the current run to complete (or fail)
        const settledResults = await Promise.allSettled(fetchPromises);

        // --- Process Settled Results ---
        const finalRunResults: Record<string, BenchmarkResult> = {};
        settledResults.forEach((settledResult, index) => {
          const endpointId = shuffledEndpoints[index].id; // Get ID from shuffled order
          if (settledResult.status === "fulfilled") {
            // If measureFetch resolved (even if it returned an error structure)
            const { id, result } = settledResult.value;
            finalRunResults[id] = result;
          } else {
            // If the measureFetch promise itself rejected unexpectedly
            console.error(
              `Unexpected promise rejection for ${endpointId}:`,
              settledResult.reason
            );
            finalRunResults[endpointId] = {
              clientTime: null, // Or potentially capture time if possible
              serverTime: null,
              binding: "Fatal Error",
              error:
                settledResult.reason?.message ?? "Unknown settled rejection",
            };
          }
        });

        // --- Update Benchmark Runs State ---
        // Find the run by ID and update its results. Create a new array.
        benchmarkRuns = benchmarkRuns.map((run) =>
          run.runId === currentRunId
            ? { ...run, results: finalRunResults }
            : run
        );

        // Update progress tween smoothly
        await progress.set(((i + 1) / RUN_COUNT) * 100);
      }
    } catch (error: any) {
      // Handle errors during the benchmark sequence itself
      console.error("Benchmark sequence failed:", error);
      overallError =
        error.message || "An unexpected error stopped the benchmark.";
    } finally {
      // --- Final State Updates ---
      isLoading = false; // Update loading state
      if (!overallError) {
        // Ensure progress bar reaches 100% on success
        progress.set(100);
        // Calculate averages only if the benchmark completed without fatal error
        calculateAverages();
      }
    }
  }

  /** Calculates average times from runs 2 and 3. */
  function calculateAverages() {
    // Ensure enough runs completed successfully
    if (benchmarkRuns.length < RUN_COUNT) return;

    // Filter for the runs to include in the average (Runs 2 and 3)
    // Exclude Run 1 as a potential "warm-up"
    const relevantRuns = benchmarkRuns.filter((run) => run.runId >= 2);
    if (relevantRuns.length === 0) return; // No relevant runs found

    const newAverages = {} as Record<EndpointId, AverageResult>;

    for (const endpoint of ENDPOINTS) {
      let totalClientTime = 0;
      let validClientCount = 0;
      let totalServerTime = 0;
      let validServerCount = 0;

      // Iterate through the relevant runs
      for (const run of relevantRuns) {
        const result = run.results[endpoint.id];
        // Only include successful results (no errors) in averages
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

      // Calculate averages, handle division by zero
      newAverages[endpoint.id] = {
        avgClientTime:
          validClientCount > 0 ? totalClientTime / validClientCount : null,
        avgServerTime:
          validServerCount > 0 ? totalServerTime / validServerCount : null,
      };
    }
    // Update the averageResults state variable
    averageResults = newAverages;
    console.log("Averages (Runs 2 & 3):", averageResults);
  }
</script>

<div class="container mx-auto p-4 sm:p-6 lg:p-8 space-y-8 font-sans">
  <header class="space-y-2">
    <h1 class="text-2xl sm:text-3xl font-bold text-gray-800">
      Database Performance Benchmark
    </h1>
    <p class="text-gray-600">
      Comparing Cloudflare Hyperdrive vs. direct Bun REST API access.
    </p>
  </header>

  <section class="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
    <h2 class="text-lg font-semibold text-gray-700 mb-2">How it Works</h2>
    <div class="text-sm text-gray-700 space-y-2">
      <p>
        This benchmark runs {RUN_COUNT} rounds of tests against different API endpoints.
        Each round fetches data from all endpoints in a random order. The first round
        is often considered a "warm-up" and is excluded from the final average calculation.
      </p>
      <p>
        <strong>Client Time:</strong> Measured in
        <em class="font-semibold">your browser</em>
        (here in {Intl.DateTimeFormat().resolvedOptions().timeZone ??
          "your timezone"}). It's the total time from sending the request until
        receiving the response headers.
        <strong class="text-red-600">Includes network latency</strong>
        (round trip time) + server processing time. Higher latency to distant servers
        (like Helsinki) will significantly increase this time.
      </p>
      <p>
        <strong>Server Time:</strong> Measured
        <em class="font-semibold">on the server</em>
        (Helsinki). It's the time the server reports it spent processing the request
        (e.g., running the database query).
        <strong class="text-blue-600">Does not include network latency.</strong>
      </p>
      <p><strong>Caching Notes:</strong></p>
      <ul class="list-disc list-inside pl-4 space-y-1 text-sm text-gray-700">
        <li>
          The <code class="text-xs bg-gray-200 px-1 rounded">fetch</code> uses
          <code class="text-xs bg-gray-200 px-1 rounded">cache: "no-cache"</code
          >
          to bypass the browser's local cache.
        </li>
        <li>
          The "Bun REST Cached" endpoint returns a
          <code class="text-xs bg-gray-200 px-1 rounded">Cache-Control</code>
          header. Intermediate caches (like CDNs) might serve cached responses, leading
          to much lower <strong class="font-semibold">Client Time</strong>
          even with
          <code class="text-xs bg-gray-200 px-1 rounded">cache: "no-cache"</code
          >.
        </li>
        <li>
          Hyperdrive's caching mechanism is different and managed via connection
          Hyperdrive's caching mechanism is different and managed via connection
          strings/pools.
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
    <div
      class="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700 my-4 overflow-hidden"
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

      <div class="block md:hidden space-y-5">
        {#each benchmarkRuns as run (run.runId)}
          <div
            class="border border-gray-300 rounded-lg shadow-md overflow-hidden bg-white"
          >
            <h3
              class="text-lg font-semibold px-4 py-3 bg-gray-100 border-b border-gray-300"
            >
              Run {run.runId}
            </h3>
            <div class="divide-y divide-gray-200">
              {#each ENDPOINTS as endpoint (endpoint.id)}
                {@const result = run.results[endpoint.id]}
                <div class="p-4">
                  <h4
                    class="font-medium text-gray-800 mb-2"
                    title={endpoint.description}
                  >
                    {endpoint.label}
                  </h4>
                  {#if result.error}
                    <div class="text-red-600">
                      <p class="font-semibold">{result.binding || "Error"}</p>
                      <p class="text-sm mt-1 break-words">{result.error}</p>
                      {#if result.clientTime !== null}
                        <p class="text-xs text-gray-500 mt-1">
                          Failed after: {formatTime(result.clientTime)}
                        </p>
                      {/if}
                    </div>
                  {:else if result.binding === "Pending..."}
                    <div class="text-gray-400 italic text-center py-2">
                      {result.binding}
                    </div>
                  {:else}
                    <dl class="space-y-1 text-sm">
                      <div
                        class="flex justify-between items-baseline gap-2"
                        title="Total time (Network Latency + Server Processing) measured by browser."
                      >
                        <dt class="text-gray-600">Client:</dt>
                        <dd class="text-gray-900 font-medium text-right">
                          {formatTime(result.clientTime)}
                        </dd>
                      </div>
                      <div
                        class="flex justify-between items-baseline gap-2"
                        title="Processing time reported by the server (excludes network latency)."
                      >
                        <dt class="text-gray-600">Server:</dt>
                        <dd class="text-gray-900 font-medium text-right">
                          {formatTime(result.serverTime)}
                        </dd>
                      </div>
                      <div
                        class="flex justify-between items-baseline gap-2 mt-1 pt-1 border-t border-gray-100"
                      >
                        <dt class="text-xs text-gray-500">Source:</dt>
                        <dd
                          class="text-xs text-gray-500 font-mono text-right truncate"
                          title={result.binding ?? ""}
                        >
                          {result.binding ?? "N/A"}
                        </dd>
                      </div>
                    </dl>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}

        {#if Object.keys(averageResults).length > 0 && !isLoading && benchmarkRuns.length >= RUN_COUNT}
          <div
            class="border border-blue-300 bg-blue-50 rounded-lg shadow-md overflow-hidden mt-6"
          >
            <h3
              class="text-lg font-semibold px-4 py-3 bg-blue-100 border-b border-blue-300 text-blue-800"
            >
              Average (Runs 2 & 3)
            </h3>
            <div class="divide-y divide-blue-200">
              {#each ENDPOINTS as endpoint (endpoint.id)}
                {@const avg = averageResults[endpoint.id]}
                <div class="p-4">
                  <h4
                    class="font-medium text-gray-800 mb-2"
                    title={endpoint.description}
                  >
                    {endpoint.label}
                  </h4>
                  {#if avg}
                    <dl class="space-y-1 text-sm">
                      <div
                        class="flex justify-between items-baseline gap-2"
                        title="Average total time (Network Latency + Server Processing) measured by browser."
                      >
                        <dt class="text-gray-600">Avg Client:</dt>
                        <dd class="text-blue-900 font-semibold text-right">
                          {formatTime(avg.avgClientTime)}
                        </dd>
                      </div>
                      <div
                        class="flex justify-between items-baseline gap-2"
                        title="Average processing time reported by the server (excludes network latency)."
                      >
                        <dt class="text-gray-600">Avg Server:</dt>
                        <dd class="text-blue-900 font-semibold text-right">
                          {formatTime(avg.avgServerTime)}
                        </dd>
                      </div>
                    </dl>
                  {:else}
                    <p class="text-sm text-gray-500 italic">
                      No data for average.
                    </p>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div
        class="hidden md:block overflow-x-auto shadow-md rounded-lg border border-gray-300"
      >
        <table
          class="min-w-full text-sm text-left text-gray-700 bg-white border-collapse"
        >
          <thead
            class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10"
          >
            <tr>
              <th
                scope="col"
                class="px-4 py-3 border-b border-r border-gray-300 font-semibold text-center w-20 sticky left-0 bg-gray-100 z-20"
              >
                Run #
              </th>
              {#each ENDPOINTS as endpoint (endpoint.id)}
                <th
                  scope="col"
                  class="px-4 py-3 border-b border-r border-gray-300 font-semibold min-w-[200px] last:border-r-0"
                  title={endpoint.description}
                >
                  {endpoint.label}
                  <div class="font-normal normal-case text-gray-500 mt-1">
                    <span
                      class="inline-block cursor-help"
                      title="Client Time: Total round-trip time measured by browser (includes network latency + server processing)."
                      >Client</span
                    >
                    /
                    <span
                      class="inline-block cursor-help"
                      title="Server Time: Processing time reported by server (excludes network latency)."
                      >Server</span
                    >
                  </div>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            {#each benchmarkRuns as run (run.runId)}
              <tr class="hover:bg-gray-50 align-top">
                <td
                  class="px-4 py-3 border-r border-gray-300 font-medium text-gray-900 whitespace-nowrap text-center sticky left-0 bg-white hover:bg-gray-50 z-10"
                >
                  {run.runId}
                </td>
                {#each ENDPOINTS as endpoint (endpoint.id)}
                  {@const result = run.results[endpoint.id]}
                  <td
                    class="px-4 py-3 border-r border-gray-300 last:border-r-0"
                  >
                    {#if result.error}
                      <div class="text-red-600">
                        <p class="font-semibold">{result.binding || "Error"}</p>
                        <p class="text-xs mt-1 break-words max-w-[200px]">
                          {result.error}
                        </p>
                        {#if result.clientTime !== null}
                          <p class="text-xs text-gray-500 mt-1">
                            Failed after: {formatTime(result.clientTime)}
                          </p>
                        {/if}
                      </div>
                    {:else if result.binding === "Pending..."}
                      <div class="text-gray-400 italic text-center py-4">
                        {result.binding}
                      </div>
                    {:else}
                      <dl>
                        <div
                          class="flex justify-between items-baseline gap-2"
                          title="Client Time: Total round-trip time measured by browser (includes network latency + server processing)."
                        >
                          <dt class="font-medium text-gray-900">Client:</dt>
                          <dd class="text-gray-700 text-right">
                            {formatTime(result.clientTime)}
                          </dd>
                        </div>
                        <div
                          class="flex justify-between items-baseline gap-2 mt-1"
                          title="Server Time: Processing time reported by server (excludes network latency)."
                        >
                          <dt class="font-medium text-gray-900">Server:</dt>
                          <dd class="text-gray-700 text-right">
                            {formatTime(result.serverTime)}
                          </dd>
                        </div>
                        <div
                          class="flex justify-between items-baseline gap-2 mt-1 pt-1 border-t border-gray-200"
                        >
                          <dt class="text-xs text-gray-500">Source:</dt>
                          <dd
                            class="text-xs text-gray-500 font-mono text-right truncate"
                            title={result.binding ?? ""}
                          >
                            {result.binding ?? "N/A"}
                          </dd>
                        </div>
                      </dl>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
          {#if Object.keys(averageResults).length > 0 && !isLoading && benchmarkRuns.length >= RUN_COUNT}
            <tfoot
              class="bg-blue-50 border-t-2 border-blue-300 sticky bottom-0"
            >
              <tr class="align-top">
                <td
                  class="px-4 py-3 border-r border-gray-300 font-semibold text-blue-800 whitespace-nowrap text-center sticky left-0 bg-blue-50 z-10"
                >
                  Avg<br /><span class="text-xs font-normal">(Runs 2&3)</span>
                </td>
                {#each ENDPOINTS as endpoint (endpoint.id)}
                  {@const avg = averageResults[endpoint.id]}
                  <td
                    class="px-4 py-3 border-r border-gray-300 last:border-r-0"
                  >
                    {#if avg}
                      <dl>
                        <div
                          class="flex justify-between items-baseline gap-2"
                          title="Average Client Time (includes network latency)."
                        >
                          <dt class="font-semibold text-blue-800">
                            Avg Client:
                          </dt>
                          <dd class="text-blue-900 font-semibold text-right">
                            {formatTime(avg.avgClientTime)}
                          </dd>
                        </div>
                        <div
                          class="flex justify-between items-baseline gap-2 mt-1"
                          title="Average Server Time (excludes network latency)."
                        >
                          <dt class="font-semibold text-blue-800">
                            Avg Server:
                          </dt>
                          <dd class="text-blue-900 font-semibold text-right">
                            {formatTime(avg.avgServerTime)}
                          </dd>
                        </div>
                      </dl>
                    {:else}
                      <p class="text-sm text-gray-500 italic text-center py-2">
                        No data
                      </p>
                    {/if}
                  </td>
                {/each}
              </tr>
            </tfoot>
          {/if}
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
  /* Ensure definition list items flow well */
  dl dt {
    flex-shrink: 0; /* Prevent labels from shrinking */
  }
  dl dd {
    flex-grow: 1; /* Allow values to take remaining space */
    min-width: 50px; /* Ensure some minimum space for values */
  }

  /* Improve sticky header/column/footer appearance */
  thead th {
    position: sticky;
    top: 0;
    z-index: 10; /* Header above body rows */
  }
  tbody td:first-child,
  tfoot td:first-child,
  thead th:first-child {
    position: sticky;
    left: 0;
    z-index: 5; /* First column above other cells but below header/footer */
  }
  thead th:first-child {
    z-index: 15; /* Corner header above everything */
  }
  tfoot {
    position: sticky;
    bottom: 0;
    z-index: 10; /* Footer above body rows */
  }
  tfoot td:first-child {
    z-index: 15; /* Footer first cell above footer row */
  }

  /* Add slight background transition for hover states */
  tbody tr:hover td {
    background-color: #f9fafb; /* Equivalent to hover:bg-gray-50 */
  }
  /* Ensure sticky column gets hover color */
  tbody tr:hover td:first-child {
    background-color: #f9fafb;
  }

  /* Ensure sticky footer/header cells have correct background */
  thead th,
  tfoot td {
    background-color: inherit; /* Inherit from thead/tfoot rule */
  }
  thead th:first-child {
    background-color: #f3f4f6; /* bg-gray-100 */
  }
  tfoot td:first-child {
    background-color: #eff6ff; /* bg-blue-50 */
  }

  /* Basic tooltip styling via title attribute */
  [title] {
    cursor: help;
    /* text-decoration: underline dotted; Optional: adds visual cue */
  }
</style>
