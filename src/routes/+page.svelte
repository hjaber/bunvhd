<script lang="ts">
  // Type for the expected API response structure (keep this)
  interface QueryResponse {
    data: any[] | null;
    timeMs: number;
    binding: string;
    error: string | null;
  }

  // State variables (keep these)
  let cachedResult: QueryResponse | null = null;
  let nonCachedResult: QueryResponse | null = null;
  let isLoading = false;
  let fetchError: string | null = null;

  // Simplified fetch function
  async function fetchData() {
    isLoading = true;
    fetchError = null;
    cachedResult = null;
    nonCachedResult = null;

    try {
      // Fetch requests without the AbortSignal
      const [cachedResponse, nonCachedResponse] = await Promise.all([
        fetch("/api/cached-query"),
        fetch("/api/non-cached-query"),
      ]);

      // Check if responses are ok before parsing JSON
      if (!cachedResponse.ok) {
        // Including status code can be helpful for debugging
        throw new Error(
          `Cached query failed: ${cachedResponse.status} ${cachedResponse.statusText}`
        );
      }
      if (!nonCachedResponse.ok) {
        throw new Error(
          `Non-cached query failed: ${nonCachedResponse.status} ${nonCachedResponse.statusText}`
        );
      }

      // Parse JSON
      const [cachedJson, nonCachedJson] = await Promise.all([
        cachedResponse.json(),
        nonCachedResponse.json(),
      ]);

      // Assign results (using type assertion as before)
      cachedResult = cachedJson as QueryResponse;
      nonCachedResult = nonCachedJson as QueryResponse;
    } catch (error: any) {
      // Error handling (AbortError check is no longer needed)
      console.error("Fetch error:", error);
      fetchError = error.message || "Failed to fetch data";
    } finally {
      // Always set loading to false when done (success or error)
      isLoading = false;
    }
  }

  // No onDestroy needed anymore
</script>

<div class="container mx-auto p-4 space-y-6">
  <h1 class="text-2xl font-bold mb-4">Hyperdrive Query Test</h1>

  <button
    on:click={fetchData}
    disabled={isLoading}
    class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {isLoading ? "Loading..." : "Query Databases"}
  </button>

  {#if fetchError}
    <div class="mt-4 p-3 bg-red-100 text-red-700 border border-red-300 rounded">
      <strong>Error:</strong>
      {fetchError}
    </div>
  {/if}

  <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
    <div class="border p-4 rounded shadow">
      <h2 class="text-xl font-semibold mb-2">
        Cached Query ({cachedResult?.binding ?? "N/A"})
      </h2>
      {#if cachedResult}
        {#if cachedResult.error}
          <p class="text-red-600">Error: {cachedResult.error}</p>
        {/if}
        <p><strong>Time:</strong> {cachedResult.timeMs.toFixed(2)} ms</p>
        <p><strong>Data (First Row):</strong></p>
        <pre class="bg-gray-100 p-2 rounded overflow-x-auto text-sm"><code
            >{JSON.stringify(
              cachedResult.data?.[0] ?? "No data",
              null,
              2
            )}</code
          ></pre>
      {:else if !isLoading && !fetchError}
        <p class="text-gray-500">No results yet.</p>
      {/if}
    </div>

    <div class="border p-4 rounded shadow">
      <h2 class="text-xl font-semibold mb-2">
        Non-Cached Query ({nonCachedResult?.binding ?? "N/A"})
      </h2>
      {#if nonCachedResult}
        {#if nonCachedResult.error}
          <p class="text-red-600">Error: {nonCachedResult.error}</p>
        {/if}
        <p><strong>Time:</strong> {nonCachedResult.timeMs.toFixed(2)} ms</p>
        <p><strong>Data (First Row):</strong></p>
        <pre class="bg-gray-100 p-2 rounded overflow-x-auto text-sm"><code
            >{JSON.stringify(
              nonCachedResult.data?.[0] ?? "No data",
              null,
              2
            )}</code
          ></pre>
      {:else if !isLoading && !fetchError}
        <p class="text-gray-500">No results yet.</p>
      {/if}
    </div>
  </div>
  {#if isLoading}
    <div class="mt-4 text-center">
      <p>Loading data...</p>
    </div>
  {/if}
</div>
