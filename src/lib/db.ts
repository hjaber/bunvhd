// src/lib/db.ts - Workers-compatible version
import postgres from "postgres";

// Define interface for binding objects to handle different binding formats
interface DbBinding {
  connectionString: string;
}

/**
 * Create a new database connection for each request
 * (Cloudflare Workers doesn't support connection pooling between requests)
 * @param binding The binding from platform.env or a connection string
 * @param cached Whether this is a cached connection (for configuration only)
 * @param region Optional region identifier for logging
 * @returns Postgres SQL connection
 */
export function getDbConnection(
  binding: string | DbBinding,
  cached: boolean = true,
  region: string = "default"
) {
  // Extract connection string from binding
  const connectionString =
    typeof binding === "object" && binding !== null
      ? binding.connectionString
      : binding;

  // Create a new connection for this request
  // No pooling between requests (Workers limitation)
  const sql = postgres(connectionString, {
    max: 1, // Single connection
    idle_timeout: 5, // Short timeout
    connect_timeout: 10, // 10 second connection timeout
  });

  console.log(
    `Created new database connection: ${region}_${
      cached ? "cached" : "non-cached"
    }`
  );

  return sql;
}

/**
 * Common type definition for city data
 */
export type City = {
  city_id: number;
  city_name: string;
  local_name: string | null;
  country: string;
  continent: string;
  population: number | null;
  language_spoken: string | null;
};
