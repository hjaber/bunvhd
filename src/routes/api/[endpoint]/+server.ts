// src/routes/api/[endpoint]/+server.ts
import { json, error as svelteError } from "@sveltejs/kit";
import postgres from "postgres";
import type { RequestHandler } from "./$types";

// Define the configuration interface with a new type field
interface EndpointConfig {
  bindingKey: string;
  displayName: string;
  cached: boolean;
  region: string;
  type: "hyperdrive" | "bun-rest-proxy"; // Added type to distinguish between direct DB and REST proxy
  restUrl?: string; // URL for the REST API (only needed for bun-rest-proxy type)
}

// Define common city type
interface City {
  city_id: number;
  city_name: string;
  local_name: string | null;
  country: string;
  continent: string;
  population: number | null;
  language_spoken: string | null;
}

// Updated bindings to include both Hyperdrive and Bun REST API proxy endpoints
const ENDPOINT_CONFIG: Record<string, EndpointConfig> = {
  // Helsinki region - Hyperdrive
  "cached-query": {
    bindingKey: "CACHED-DB-BUNVHD",
    displayName: "CACHED_DB_HELSINKI",
    cached: true,
    region: "helsinki",
    type: "hyperdrive",
  },
  "non-cached-query": {
    bindingKey: "NO-CACHED-DB-BUNVHD",
    displayName: "NON_CACHED_DB_HELSINKI",
    cached: false,
    region: "helsinki",
    type: "hyperdrive",
  },

  // Helsinki region - Bun REST API Proxy
  "bun-cached-hel": {
    bindingKey: "CACHED-DB-BUNVHD", // Still need a binding for auth context, even if not used directly
    displayName: "BUN_REST_CACHED_HELSINKI",
    cached: true,
    region: "helsinki",
    type: "bun-rest-proxy",
    restUrl: "https://bunvhd-db-eu-east.tripcafe.org",
  },
  "bun-non-cached-hel": {
    bindingKey: "NO-CACHED-DB-BUNVHD",
    displayName: "BUN_REST_NON_CACHED_HELSINKI",
    cached: false,
    region: "helsinki",
    type: "bun-rest-proxy",
    restUrl: "https://bunvhd-db-eu-east.tripcafe.org",
  },

  // US East Region - Hyperdrive
  "cached-query-us-east": {
    bindingKey: "CACHED-DB-BUNVHD-US-EAST",
    displayName: "CACHED_DB_US_EAST",
    cached: true,
    region: "us-east",
    type: "hyperdrive",
  },
  "non-cached-query-us-east": {
    bindingKey: "NO-CACHED-DB-BUNVHD-US-EAST",
    displayName: "NON_CACHED_DB_US_EAST",
    cached: false,
    region: "us-east",
    type: "hyperdrive",
  },

  // US East Region - Bun REST API Proxy
  "bun-cached-us-east": {
    bindingKey: "CACHED-DB-BUNVHD-US-EAST",
    displayName: "BUN_REST_CACHED_US_EAST",
    cached: true,
    region: "us-east",
    type: "bun-rest-proxy",
    restUrl: "https://bunvhd-db-us-east.tripcafe.org",
  },
  "bun-non-cached-us-east": {
    bindingKey: "NO-CACHED-DB-BUNVHD-US-EAST",
    displayName: "BUN_REST_NON_CACHED_US_EAST",
    cached: false,
    region: "us-east",
    type: "bun-rest-proxy",
    restUrl: "https://bunvhd-db-us-east.tripcafe.org",
  },

  // US West Region - Hyperdrive
  "cached-query-us-west": {
    bindingKey: "CACHED-DB-BUNVHD-US-WEST",
    displayName: "CACHED_DB_US_WEST",
    cached: true,
    region: "us-west",
    type: "hyperdrive",
  },
  "non-cached-query-us-west": {
    bindingKey: "NO-CACHED-DB-BUNVHD-US-WEST",
    displayName: "NON_CACHED_DB_US_WEST",
    cached: false,
    region: "us-west",
    type: "hyperdrive",
  },

  // US West Region - Bun REST API Proxy
  "bun-cached-us-west": {
    bindingKey: "CACHED-DB-BUNVHD-US-WEST",
    displayName: "BUN_REST_CACHED_US_WEST",
    cached: true,
    region: "us-west",
    type: "bun-rest-proxy",
    restUrl: "https://bunvhd-db-us-west.tripcafe.org",
  },
  "bun-non-cached-us-west": {
    bindingKey: "NO-CACHED-DB-BUNVHD-US-WEST",
    displayName: "BUN_REST_NON_CACHED_US_WEST",
    cached: false,
    region: "us-west",
    type: "bun-rest-proxy",
    restUrl: "https://bunvhd-db-us-west.tripcafe.org",
  },
};

// Pattern to extract base endpoint from dynamic endpoint
const ENDPOINT_PATTERN =
  /^(cached-query|non-cached-query|cached-query-us-east|non-cached-query-us-east|cached-query-us-west|non-cached-query-us-west|bun-cached-hel|bun-non-cached-hel|bun-cached-us-east|bun-non-cached-us-east|bun-cached-us-west|bun-non-cached-us-west)(-\d+-\d+|-\d+)?$/;

// Interface for environment bindings (removed Cache API)
interface EnvBindings {
  [key: string]: any;
}

// Interface for the response from Bun REST API
interface RestApiResponse {
  data: City | null;
  timeMs: number;
  binding: string;
  error: string | null;
}

export const GET: RequestHandler = async ({
  fetch,
  params,
  platform,
  url,
  request,
}) => {
  const dynamicEndpoint = params.endpoint;
  const colo = request.cf?.colo || "";

  // Parse the dynamic endpoint to get the base endpoint
  const match = dynamicEndpoint.match(ENDPOINT_PATTERN);
  if (!match) {
    throw svelteError(404, `Unknown endpoint format: ${dynamicEndpoint}`);
  }

  // Extract the base endpoint from the dynamic endpoint
  const baseEndpoint = match[1];

  // Check if this is a dynamic endpoint (has timestamp suffix)
  const isDynamicPath = !!match[2];

  // Check if CDN caching is requested via query parameter
  const cdnCache = url.searchParams.get("cdnCache");
  const cacheTtl = cdnCache ? parseInt(cdnCache, 10) || 30 : 0; // Default to 30 seconds if unspecified

  // Check if the requested endpoint exists in our configuration
  if (!baseEndpoint || !(baseEndpoint in ENDPOINT_CONFIG)) {
    throw svelteError(404, `Unknown endpoint: ${baseEndpoint}`);
  }

  const config = ENDPOINT_CONFIG[baseEndpoint];

  // Ensure platform and env exist
  if (!platform?.env) {
    throw svelteError(500, "Server environment not available");
  }

  // Type-safe access to environment variables
  const env = platform.env as EnvBindings;

  // Now handle the request based on endpoint type
  let results: City[] | null = null;
  let errorMsg: string | null = null;
  let serverTimeMs: number = 0;
  let binding = config.displayName;

  if (config.type === "hyperdrive") {
    // Original Hyperdrive flow
    if (!env[config.bindingKey]) {
      console.error(`API Error: ${config.bindingKey} binding not found`);
      throw svelteError(
        500,
        `Configuration Error: ${config.displayName} binding not found.`
      );
    }

    const dbBinding = env[config.bindingKey];
    let sql: postgres.Sql | null = null;

    try {
      // Get the connection string
      const connectionString =
        typeof dbBinding === "object" &&
        dbBinding !== null &&
        "connectionString" in dbBinding
          ? (dbBinding as { connectionString: string }).connectionString
          : typeof dbBinding === "string"
          ? dbBinding
          : null;

      if (!connectionString) {
        throw new Error("Invalid or missing connection string in binding.");
      }

      // Create a new database connection for this request
      sql = postgres(connectionString, {
        max: 1, // Single connection
        idle_timeout: 5, // Short timeout
        connect_timeout: 10, // 10 second connection timeout
        // For dynamic paths, set additional parameters to prevent connection pooling
        ...(isDynamicPath
          ? {
              connection: {
                application_name: `benchmark_${dynamicEndpoint}`,
              },
            }
          : {}),
      });

      const startTime = performance.now();

      // Execute the query to get a random city
      if (isDynamicPath) {
        // For dynamic paths, add a unique comment to force a new query plan
        const uniqueComment = `/* ${dynamicEndpoint} */`;
        results = await sql<City[]>`
          ${sql.unsafe(uniqueComment)}
          SELECT * FROM public.cities ORDER BY RANDOM() LIMIT 1;
        `;
      } else {
        results = await sql<City[]>`
          SELECT * FROM public.cities ORDER BY RANDOM() LIMIT 1;
        `;
      }

      serverTimeMs = performance.now() - startTime;
    } catch (e: any) {
      console.error(`Error querying ${config.displayName}:`, e);
      errorMsg = e.message || "An unknown database error occurred";
    } finally {
      // Always properly close the connection
      if (sql) {
        const closePromise = sql
          .end({ timeout: 5 })
          .catch((err) =>
            console.error(
              `Error closing SQL connection for ${config.displayName}:`,
              err
            )
          );

        // Use waitUntil to allow the connection to close after the response is sent
        if (platform?.ctx?.waitUntil) {
          platform.ctx.waitUntil(closePromise);
        } else {
          // For environments without waitUntil, don't block the response
          try {
            // Wait briefly but don't block the response too long
            await Promise.race([
              closePromise,
              new Promise((resolve) => setTimeout(resolve, 100)),
            ]);
          } catch (err) {
            console.error(
              `Timeout closing SQL connection for ${config.displayName}`
            );
          }
        }
      }
    }
  } else if (config.type === "bun-rest-proxy") {
    // Handle Bun REST API proxy
    if (!config.restUrl) {
      throw svelteError(
        500,
        `REST API URL not configured for ${config.displayName}`
      );
    }

    try {
      // Build the REST API URL with appropriate caching parameters
      const restParams = new URLSearchParams();
      if (config.cached && cacheTtl > 0) {
        restParams.set("cdnCache", cacheTtl.toString());
      }
      if (!config.cached || isDynamicPath) {
        // For non-cached endpoints or dynamic paths, add a cache-busting parameter
        restParams.set("_nc", "true");
        if (isDynamicPath) {
          // Add the dynamic identifier to ensure uniqueness
          restParams.set("dynamicId", match[2].substring(1));
        }
      }

      const restUrl = `${config.restUrl}/?${restParams.toString()}`;

      // Time just the REST API call itself
      const startTime = performance.now();
      const response = await fetch(restUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "SvelteKit-Benchmark-Proxy",
          "X-Forwarded-For":
            request.headers.get("x-forwarded-for") ||
            request.headers.get("cf-connecting-ip") ||
            "unknown",
        },
      });
      const clientTimeMs = performance.now() - startTime;

      if (!response.ok) {
        throw new Error(
          `REST API returned ${response.status}: ${await response.text()}`
        );
      }

      const data: RestApiResponse = await response.json();

      // Use the server-side timing from the REST API
      serverTimeMs = data.timeMs;

      // Get the result data
      if (data.data) {
        results = [data.data];
      }

      // If there was an error in the REST API, capture it
      if (data.error) {
        errorMsg = data.error;
      }

      console.log(
        `REST proxy to ${restUrl} completed in ${clientTimeMs.toFixed(
          2
        )}ms (server: ${serverTimeMs.toFixed(2)}ms)`
      );
    } catch (e: any) {
      console.error(`Error in REST proxy for ${config.displayName}:`, e);
      errorMsg =
        e.message || "An unknown error occurred while calling the REST API";
    }
  }

  // Create response with the benchmark results
  const responseData = {
    data: results && results.length > 0 ? results : null,
    timeMs: serverTimeMs,
    binding: binding,
    error: errorMsg,
    dynamicPath: isDynamicPath,
    originalEndpoint: baseEndpoint,
    colo: colo,
  };

  const response = json(responseData);

  // Add CDN cache headers if requested AND this is not a dynamic path
  if (cacheTtl > 0 && !isDynamicPath) {
    // Basic cache control
    response.headers.set(
      "Cache-Control",
      `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}`
    );

    // Add a single Vary header for basic differentiation
    response.headers.set("Vary", "Origin");

    // Add Cloudflare-specific headers
    response.headers.set("CDN-Cache-Control", `max-age=${cacheTtl}`);
  } else {
    // Strong no-cache headers for non-cached responses
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    response.headers.set("Surrogate-Control", "no-store");
  }

  return response;
};
