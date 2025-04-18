// index.ts
import { Bun } from "bun";
import fs from "fs";
import postgres from "postgres";

// Define the expected data structure
type City = {
  city_id: number;
  city_name: string;
  local_name: string | null;
  country: string;
  continent: string;
  population: number | null;
  language_spoken: string | null;
};

// --- Configuration ---
const PORT = 443;
const TLS_KEY_PATH = "./key.pem";
const TLS_CERT_PATH = "./cert.pem";

// --- Helper Function for Database Query ---
async function executeDbQuery(connectionString: string, bindingName: string) {
  console.log(`${bindingName} Handler Invoked`);

  const sql = postgres(connectionString, {
    // Add any specific postgres client options here if needed
    // e.g., ssl: 'require' if your database needs it and it's not in the string
  });

  let startTime = 0;
  let endTime = 0;
  let results: City[] = [];
  let errorMsg: string | null = null;
  let duration = 0;

  try {
    startTime = performance.now();
    results = await sql<City[]>`SELECT * FROM public.cities LIMIT 1;`;
    endTime = performance.now();
  } catch (e: any) {
    endTime = performance.now();
    console.error(`${bindingName} DB Query Error:`, e);
    errorMsg = e.message || "An unknown error occurred";
  } finally {
    // Calculate duration regardless of success or failure
    duration = endTime - startTime;
    // Ensure connection is closed before returning the response
    // Use a short timeout for closing
    try {
      await sql.end({ timeout: 5 });
      console.log(`${bindingName} DB Connection Closed`);
    } catch (closeErr) {
      console.error(`${bindingName} Error closing SQL connection:`, closeErr);
      // Optionally append this error to the main errorMsg or log it separately
      if (!errorMsg) {
        errorMsg = `Error closing DB connection: ${
          closeErr instanceof Error ? closeErr.message : String(closeErr)
        }`;
      }
    }
  }

  return {
    data: results,
    timeMs: duration,
    binding: bindingName,
    error: errorMsg,
  };
}

// --- Bun Server ---
console.log(`Starting Bun server on port ${PORT} with TLS...`);

// Check if TLS files exist before starting the server
if (!fs.existsSync(TLS_KEY_PATH) || !fs.existsSync(TLS_CERT_PATH)) {
  console.error(
    `Error: TLS key file (${TLS_KEY_PATH}) or cert file (${TLS_CERT_PATH}) not found.`
  );
  console.error(
    "Please generate them (e.g., using openssl) and place them in the project root."
  );
  process.exit(1); // Exit if certs are missing
}

const server = Bun.serve({
  port: PORT,

  // --- Request Handling ---
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // --- Environment Variable Check ---
    const connectionString = Bun.env.DATABASE_URL;
    if (!connectionString) {
      console.error("DATABASE_URL environment variable not set.");
      return new Response(
        JSON.stringify({
          error: "Server configuration error: DATABASE_URL not set.",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    let responsePayload: any;
    let status = 200;

    // --- Routing ---
    if (path === "/api/cached-query") {
      responsePayload = await executeDbQuery(
        connectionString,
        "CACHED_DB_QUERY"
      );
      if (responsePayload.error) {
        // Keep status 200 to show results structure, or set 500 for actual server errors
        // status = 500; // Uncomment if you prefer 500 for DB errors
      }
    } else if (path === "/api/non-cached-query") {
      // For this example, the "non-cached" route executes the exact same logic.
      // In a real scenario, it might use a different query, connection options,
      // or bypass an external cache layer.
      responsePayload = await executeDbQuery(
        connectionString,
        "NON_CACHED_DB_QUERY"
      );
      if (responsePayload.error) {
        // status = 500; // Uncomment if you prefer 500 for DB errors
      }
    } else {
      // --- Not Found Handler ---
      responsePayload = { error: "Not Found" };
      status = 404;
    }

    // --- Send Response ---
    return new Response(JSON.stringify(responsePayload), {
      status: status,
      headers: { "Content-Type": "application/json" },
    });
  },

  // --- Error Handling ---
  error(error) {
    console.error("Bun Server Error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: error.message,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  },

  // --- TLS Configuration ---
  tls: {
    key: Bun.file(TLS_KEY_PATH),
    cert: Bun.file(TLS_CERT_PATH),
    // You can add other TLS options here if needed, like `ca`, `passphrase`, etc.
  },
});

console.log(`Server listening on https://localhost:${server.port}`);
