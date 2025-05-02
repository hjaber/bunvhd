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

// Pattern to extract base endpoint from dynamic endpoint
// Updated pattern to extract base endpoint from dynamic endpoint
const ENDPOINT_PATTERN =
  /^(cached-query|non-cached-query|cached-query-us-east|non-cached-query-us-east|cached-query-us-west|non-cached-query-us-west)(-\d+-\d+|-\d+)?$/;
// Create a type for the environment bindings
interface EnvBindings {
  [key: string]: any; // This allows any string key with any value
}

export const GET: RequestHandler = async ({ params, platform, url }) => {
  const dynamicEndpoint = params.endpoint;

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

    startTime = performance.now();

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
    dynamicPath: isDynamicPath,
    originalEndpoint: baseEndpoint,
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
