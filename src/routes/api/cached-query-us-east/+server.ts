// src/routes/api/cached-query-us-east/+server.ts
import { json, error as svelteError } from "@sveltejs/kit"; // Import error helper
import postgres from "postgres";
import type { RequestHandler } from "./$types";

// Define the expected shape of the city data
type City = {
  city_id: number;
  city_name: string;
  local_name: string | null;
  country: string;
  continent: string;
  population: number | null;
  language_spoken: string | null;
};

export const GET: RequestHandler = async ({ platform }) => {
  // Check if the platform context and the specific binding exist
  if (!platform?.env?.["CACHED-DB-BUNVHD-US-EAST"]) {
    console.error(
      "API Error: CACHED-DB-BUNVHD-US-EAST binding not found in platform.env"
    );
    // Use SvelteKit's error helper for proper error responses
    throw svelteError(
      500,
      "Configuration Error: US East Cached DB binding not found."
    );
  }

  let sql: postgres.Sql | null = null; // Declare sql instance variable
  let startTime = 0;
  let endTime = 0;
  let results: City[] = [];
  let errorMsg: string | null = null;
  const bindingName = "CACHED_DB_BUNVHD_US_EAST"; // For consistent reporting

  try {
    // Retrieve connection string from the environment binding
    // The structure might be { connectionString: '...' } or just the string itself
    const binding = platform.env["CACHED-DB-BUNVHD-US-EAST"];
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

    // Establish connection using postgres.js
    sql = postgres(connectionString, {
      // Add any specific postgres options if needed, e.g., idle_timeout
      // Consider prepare: false if not using prepared statements extensively
      // connect_timeout: 10 // Example: 10 seconds connection timeout
    });

    startTime = performance.now();

    // Execute the SQL query to get a random city
    results = await sql<City[]>`
          SELECT * FROM public.cities ORDER BY RANDOM() LIMIT 1;
        `;

    endTime = performance.now();
  } catch (e: any) {
    endTime = performance.now(); // Record time even if error occurred
    console.error(`Error querying ${bindingName}:`, e);
    errorMsg = e.message || "An unknown database error occurred";
    // Ensure results array is empty on error
    results = [];
  } finally {
    // IMPORTANT: Ensure the database connection is closed gracefully.
    // Use platform.ctx.waitUntil for Cloudflare Workers environment
    // to allow async operations to complete after the response is sent.
    if (sql) {
      const closePromise = sql
        .end({ timeout: 5 }) // 5-second timeout for closing
        .catch((err) =>
          console.error(`Error closing SQL connection for ${bindingName}:`, err)
        );

      if (platform?.ctx?.waitUntil) {
        platform.ctx.waitUntil(closePromise);
      } else {
        // For environments without waitUntil, await briefly but don't block response
        await Promise.race([
          closePromise,
          new Promise((resolve) => setTimeout(resolve, 100)),
        ]);
      }
    }
  }

  const duration = endTime - startTime;

  // Return the benchmark results as JSON
  // Include the error message in the response if one occurred
  return json({
    data: results.length > 0 ? results : null, // Return null for data if error or no results
    timeMs: duration,
    binding: bindingName,
    error: errorMsg, // Include null or the error string
  });
};
