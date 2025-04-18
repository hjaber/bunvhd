import { json } from "@sveltejs/kit";
import postgres from "postgres";
import type { RequestHandler } from "./$types";

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
  if (!platform?.env?.["NO-CACHED-DB-BUNVHD"]) {
    return json({ error: "Non-Cached DB binding not found." }, { status: 500 });
  }

  const connectionString = platform.env["NO-CACHED-DB-BUNVHD"].connectionString;

  const sql = postgres(connectionString, {});

  let startTime = 0;
  let endTime = 0;
  let results: City[] = [];
  let errorMsg: string | null = null;

  try {
    startTime = performance.now();

    results = await sql<City[]>`SELECT * FROM public.cities LIMIT 1;`;

    endTime = performance.now();
  } catch (e: any) {
    endTime = performance.now();
    console.error("Non-Cached DB Query Error:", e);
    errorMsg = e.message || "An unknown error occurred";
  } finally {
    if (platform.ctx) {
      platform.ctx.waitUntil(sql.end({ timeout: 5 }));
    } else {
      sql
        .end({ timeout: 5 })
        .catch((err) => console.error("Error closing SQL connection:", err));
    }
  }

  const duration = endTime - startTime;

  return json({
    data: results,
    timeMs: duration,
    binding: "NO_CACHED_DB_BUNVHD",
    error: errorMsg,
  });
};
