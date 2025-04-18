// bun-restful-api.ts
import { env, file, serve } from "bun";
import fs from "fs";
import postgres from "postgres";

console.log("Bun Server Starting...");

// --- Configuration ---
const PORT = 443;
const TLS_KEY_PATH = "./key.pem";
const TLS_CERT_PATH = "./cert.pem";
const DATABASE_URL = env.DATABASE_URL;

// --- CORS Configuration ---
// Define the allowed origins. Be specific for production.
const ALLOWED_ORIGINS: Set<string> = new Set([
  "https://bunvhd.tripcafe.org", // Your primary frontend origin
  // Add other specific origins if needed, e.g., a staging domain
]);

// Function to check if an origin is allowed (handles localhost dynamically)
function isOriginAllowed(origin: string | null): boolean {
  if (!origin) {
    return false; // No origin header means not a CORS request we need to handle
  }
  if (ALLOWED_ORIGINS.has(origin)) {
    return true;
  }
  // Allow any localhost origin for development flexibility
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) {
    console.log(`Allowing development origin: ${origin}`);
    return true;
  }
  return false;
}

// --- Type Definition ---
type City = {
  city_id: number;
  city_name: string;
  local_name: string | null;
  country: string;
  continent: string;
  population: number | null;
  language_spoken: string | null;
};

// --- Database Connection Setup ---
if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL environment variable not set.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);
console.log("Database connection pool initialized.");

// Graceful shutdown handler
process.on("SIGINT", async () => {
  console.log("\nGracefully shutting down...");
  try {
    await sql.end({ timeout: 5 });
    console.log("Database connection pool closed.");
  } catch (err) {
    console.error("Error closing database connection pool:", err);
  }
  process.exit(0);
});

// --- Database Query Function ---
// (Keep your existing getRandomCity function as is)
async function getRandomCity(): Promise<{
  data: City | null; // Returns a single city or null
  timeMs: number;
  error: string | null;
}> {
  console.log("Executing Database Query for a random city...");
  let startTime = 0;
  let endTime = 0;
  let result: City | null = null;
  let errorMsg: string | null = null;

  try {
    startTime = performance.now();
    const results = await sql<City[]>`
      SELECT * FROM public.cities ORDER BY RANDOM() LIMIT 1;
    `;
    endTime = performance.now();

    if (results.length > 0) {
      result = results[0];
      console.log(`Query successful, found city: ${result.city_name}`);
    } else {
      console.log("Query successful, but no cities found in the table.");
    }
  } catch (e: any) {
    endTime = performance.now();
    console.error("Database Query Error:", e);
    errorMsg = e.message || "An unknown database error occurred";
  }

  const duration = endTime - startTime;
  return {
    data: result,
    timeMs: duration,
    error: errorMsg,
  };
}

// --- Response Helper ---
// Modified to simplify header merging later
function createJsonResponse(
  body: object,
  status: number,
  headers: HeadersInit = {} // Default to empty object
): Response {
  const baseHeaders = {
    "Content-Type": "application/json",
    ...headers, // Merge incoming headers
  };
  return new Response(JSON.stringify(body), {
    status: status,
    headers: baseHeaders,
  });
}

// --- Cache Header Generation Function ---
// (Keep your existing generateCacheHeaders function as is)
function generateCacheHeaders(
  searchParams: URLSearchParams
): Record<string, string> {
  const cacheTtlParam = searchParams.get("cacheTtl");

  if (cacheTtlParam && /^\d+$/.test(cacheTtlParam)) {
    const ttlSeconds = parseInt(cacheTtlParam, 10);
    if (ttlSeconds >= 0) {
      console.log(`Applying Cache-Control: public, max-age=${ttlSeconds}`);
      return { "Cache-Control": `public, max-age=${ttlSeconds}` };
    }
  }
  console.log("Applying Cache-Control: no-store");
  return { "Cache-Control": "no-store" };
}

// --- Check for TLS Files ---
if (!fs.existsSync(TLS_KEY_PATH) || !fs.existsSync(TLS_CERT_PATH)) {
  console.error(`Error: TLS files not found!`);
  console.error(`Ensure '${TLS_KEY_PATH}' and '${TLS_CERT_PATH}' exist.`);
  console.error("Example using mkcert: mkcert localhost 127.0.0.1 ::1");
  process.exit(1);
}

// --- Bun Server Definition ---
console.log(`Attempting to start server on port ${PORT} with TLS...`);

const server = serve({
  port: PORT,
  hostname: "0.0.0.0",
  tls: {
    key: file(TLS_KEY_PATH),
    cert: file(TLS_CERT_PATH),
  },

  // --- Main Fetch Handler ---
  async fetch(req) {
    const url = new URL(req.url);
    const requestOrigin = req.headers.get("Origin");
    const allowed = isOriginAllowed(requestOrigin);

    console.log(
      `Incoming request: ${req.method} ${url.pathname} from Origin: ${requestOrigin}, Allowed: ${allowed}`
    );

    // --- Handle OPTIONS Preflight Requests ---
    if (req.method === "OPTIONS") {
      if (allowed && requestOrigin) {
        console.log(`Handling OPTIONS preflight for origin: ${requestOrigin}`);
        // Send necessary CORS headers for preflight
        return new Response(null, {
          status: 204, // No Content
          headers: {
            "Access-Control-Allow-Origin": requestOrigin, // Reflect the allowed origin
            "Access-Control-Allow-Methods": "GET, OPTIONS", // Methods allowed for actual requests
            "Access-Control-Allow-Headers": "Content-Type, Accept", // Headers allowed in actual requests
            "Access-Control-Max-Age": "86400", // Cache preflight response for 1 day (optional)
            Vary: "Origin", // Important for caching
          },
        });
      } else {
        // Origin not allowed or not a CORS request
        console.log(
          "OPTIONS request from disallowed/null origin, sending minimal response."
        );
        return new Response(null, { status: 204 }); // Respond minimally
      }
    }

    // --- Handle GET Requests ---
    if (url.pathname === "/" && req.method === "GET") {
      console.log(`Handling GET / with query: ${url.search}`);

      const searchParams = url.searchParams;
      const cacheHeaders = generateCacheHeaders(searchParams);

      // Prepare base response headers
      const responseHeaders: Record<string, string> = {
        ...cacheHeaders, // Include cache headers first
      };

      // Add CORS headers if origin is allowed
      if (allowed && requestOrigin) {
        console.log(`Adding CORS headers for allowed origin: ${requestOrigin}`);
        responseHeaders["Access-Control-Allow-Origin"] = requestOrigin;
        responseHeaders["Vary"] = "Origin"; // Tell caches the response varies based on origin
      }

      // Execute DB query
      const { data, timeMs, error } = await getRandomCity();

      if (error) {
        // Ensure error responses are not cached and add CORS if needed
        responseHeaders["Cache-Control"] = "no-store";
        return createJsonResponse(
          { error: error, data: null, timeMs },
          500,
          responseHeaders // Pass potentially updated headers
        );
      }

      // Success response - add CORS headers if needed
      return createJsonResponse(
        { data, timeMs, binding: "DATABASE_URL", error: null },
        200,
        responseHeaders // Pass potentially updated headers
      );
    }

    // --- Handle Not Found ---
    console.log(`Path ${url.pathname} or method ${req.method} not handled.`);
    // Generally, you don't *need* CORS headers on a 404, but you could add them
    // if 'allowed && requestOrigin' similar to above if desired for consistency.
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" }, // Keep 404s non-cached
    });
  },

  // --- Error Handler ---
  error(error: Error) {
    console.error("Server Error:", error);
    // Don't add CORS headers here, as the error state is internal
    return new Response("Internal Server Error", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  },
});

console.log(
  `🚀 Bun server running on https://${server.hostname}:${server.port}`
);
