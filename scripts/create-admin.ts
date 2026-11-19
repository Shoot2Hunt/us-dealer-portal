/**
 * Create the first super admin and print a link to set their password.
 *   npm run create-admin -- you@example.com "Your Name"
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { users } from "../src/lib/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const [email, name = "Admin"] = process.argv.slice(2);
if (!email || !process.env.DATABASE_URL) {
  console.error('Usage: DATABASE_URL=... npm run create-admin -- you@example.com "Your Name"');
  process.exit(1);
}

const db = drizzle(neon(process.env.DATABASE_URL));
const token = randomBytes(32).toString("base64url");
await db
  .insert(users)
  .values({
    email: email.toLowerCase(),
    name,
    role: "super_admin",
    setupTokenHash: createHash("sha256").update(token).digest("hex"),
    setupTokenExpires: new Date(Date.now() + 7 * 864e5),
  })
  .onConflictDoUpdate({
    target: users.email,
    set: { role: "super_admin", setupTokenHash: createHash("sha256").update(token).digest("hex"), setupTokenExpires: new Date(Date.now() + 7 * 864e5) },
  });

const base = process.env.APP_URL ?? "http://localhost:3000";
console.log(`Super admin ready. Set the password here:\n${base}/set-password?token=${token}`);
