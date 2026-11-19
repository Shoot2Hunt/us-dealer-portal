import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Load DATABASE_URL from .env.local when running drizzle-kit on your computer.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
