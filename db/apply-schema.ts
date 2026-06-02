import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  try {
    const schemaPath = path.join(__dirname, "schema.sql");
    const schema = await fs.readFile(schemaPath, "utf-8");

    console.log("=== Supabase Schema Setup ===\n");
    console.log("To apply the schema to your Supabase database:\n");
    console.log("1. Go to: https://supabase.com/dashboard");
    console.log("2. Select your project");
    console.log("3. Go to SQL Editor");
    console.log("4. Click 'New query'");
    console.log("5. Copy and paste the SQL below, then run it:\n");
    console.log("-------------------------------------------");
    console.log(schema);
    console.log("-------------------------------------------\n");
    console.log(
      "After running the SQL, you can run: npm run ingest:embed"
    );
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

main();
