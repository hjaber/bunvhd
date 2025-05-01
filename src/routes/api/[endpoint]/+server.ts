// src/routes/api/[endpoint]/+server.ts
import { json, error as svelteError } from "@sveltejs/kit";
import postgres from "postgres";
import type { RequestHandler } from "./$types";

// Define the configuration interface
interface EndpointConfig {
  bindingKey: string;
  displayName: string;
  cached: boolean;
  region: string;
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

// Updated bindings to EXACTLY match your actual environment variable names
const ENDPOINT_CONFIG: Record<string, EndpointConfig> = {
  // Helsinki region endpoints
  "cached-query": {
    bindingKey: "CACHED-DB-BUNVHD", // Exact binding name with hyphens
    displayName: "CACHED_DB_HELSINKI",
    cached: true,
    region: "helsinki",
  },
  "non-cached-query": {
    bindingKey: "NO-CACHED-DB-BUNVHD", // Note: Uses "NO-" not "NON-"
    displayName: "NON_CACHED_DB_HELSINKI",
    cached: false,
    region: "helsinki",
  },

  // US East region endpoints
  "cached-query-us-east": {
    bindingKey: "CACHED-DB-BUNVHD-US-EAST", // Exact binding name with hyphens
    displayName: "CACHED_DB_US_EAST",
    cached: true,
    region: "us-east",
  },
  "non-cached-query-us-east": {
    bindingKey: "NO-CACHED-DB-BUNVHD-US-EAST", // Note: Uses "NO-" not "NON-"
    displayName: "NON_CACHED_DB_US_EAST",
    cached: false,
    region: "us-east",
  },

  // US West region endpoints
  "cached-query-us-west": {
    bindingKey: "CACHED-DB-BUNVHD-US-WEST", // Exact binding name with hyphens
    displayName: "CACHED_DB_US_WEST",
    cached: true,
    region: "us-west",
  },
  "non-cached-query-us-west": {
    bindingKey: "NO-CACHED-DB-BUNVHD-US-WEST", // Note: Uses "NO-" not "NON-"
    displayName: "NON_CACHED_DB_US_WEST",
    cached: false,
    region: "us-west",
  },
};

// Create a type for the environment bindings
interface EnvBindings {
  [key: string]: any; // This allows any string key with any value
}

export const GET: RequestHandler = async ({ params, platform, url }) => {
  const endpoint = params.endpoint;
  // Check if CDN caching is requested via query parameter
  const cdnCache = url.searchParams.get("cdnCache");
  const cacheTtl = cdnCache ? parseInt(cdnCache, 10) || 30 : 0; // Default to 30 seconds if unspecified

  // Check if the requested endpoint exists in our configuration
  if (!endpoint || !(endpoint in ENDPOINT_CONFIG)) {
    throw svelteError(404, `Unknown endpoint: ${endpoint}`);
  }

  const config = ENDPOINT_CONFIG[endpoint];

  // Ensure platform and env exist
  if (!platform?.env) {
    throw svelteError(500, "Server environment not available");
  }

  // Type-safe access to environment variables
  const env = platform.env as EnvBindings;

  // Check if the specific binding exists
  if (!env[config.bindingKey]) {
    console.error(`API Error: ${config.bindingKey} binding not found`);
    throw svelteError(
      500,
      `Configuration Error: ${config.displayName} binding not found.`
    );
  }

  const binding = env[config.bindingKey];
  let startTime = 0;
  let endTime = 0;
  let results: City[] = [];
  let errorMsg: string | null = null;
  let sql: postgres.Sql | null = null;

  try {
    // Get the connection string
    const connectionString =
      typeof binding === "object" &&
      binding !== null &&
      "connectionString" in binding
        ? (binding as { connectionString: string }).connectionString
        : typeof binding === "string"
        ? binding
        : null;

    if (!connectionString) {
      throw new Error("Invalid or missing connection string in binding.");
    }

    // Create a new database connection for this request
    // No connection pooling between requests (Workers limitation)
    sql = postgres(connectionString, {
      max: 1, // Single connection
      idle_timeout: 5, // Short timeout
      connect_timeout: 10, // 10 second connection timeout
    });

    startTime = performance.now();

    // Execute the query to get a random city
    results = await sql<City[]>`
      SELECT * FROM public.cities ORDER BY RANDOM() LIMIT 1;
    `;

    endTime = performance.now();
  } catch (e: any) {
    endTime = performance.now();
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

  const duration = endTime - startTime;

  // Create response with the benchmark results
  const responseData = {
    data: results.length > 0 ? results : null,
    timeMs: duration,
    binding: config.displayName,
    error: errorMsg,
  };

  // Add these lines after creating the response object in your backend API
  // Create the response object
  const response = json(responseData);

  // Add CDN cache headers if requested, with improved cache key handling
  if (cacheTtl > 0) {
    // Basic cache control
    response.headers.set(
      "Cache-Control",
      `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}`
    );

    // Add Cloudflare-specific cache control
    response.headers.set("CDN-Cache-Control", `max-age=${cacheTtl}`);
    response.headers.set("Cloudflare-CDN-Cache-Control", `max-age=${cacheTtl}`);

    // Add Vary headers to create different cache keys
    response.headers.set(
      "Vary",
      "Origin, Accept-Encoding, X-Region, X-Cache-Type"
    );

    // Add custom headers that will force different cache keys
    response.headers.set("X-Region", config.region);
    response.headers.set("X-Cache-Type", "cdn-cached");
    response.headers.set(
      "X-Endpoint-Type",
      config.cached ? "cached" : "non-cached"
    );
    response.headers.set("X-Query-Type", endpoint);
  } else {
    // Explicitly prevent caching for non-cached responses
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("X-Cache-Type", "non-cached");
  }

  // Add CF-Cache-Tag for easier cache management (if using Cloudflare Enterprise)
  const cacheTag = `bunvhd-${config.region}-${
    config.cached ? "cached" : "non-cached"
  }`;
  response.headers.set("CF-Cache-Tag", cacheTag);

  return response;

  return response;
};
