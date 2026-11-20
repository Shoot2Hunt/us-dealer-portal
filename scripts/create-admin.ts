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

async function main() {
  // PowerShell can split a quoted name into several arguments, so join the rest.
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim() || "Admin";
  if (!email || !process.env.DATABASE_URL) {
    console.error('Usage: npm run create-admin -- you@example.com "Your Name"   (needs DATABASE_URL in .env.local)');
    process.exit(1);
  }

  const db = drizzle(neon(process.env.DATABASE_URL));
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 7 * 864e5);

  await db
    .insert(users)
    .values({ email: email.toLowerCase(), name, role: "super_admin", setupTokenHash: tokenHash, setupTokenExpires: expires })
    .onConflictDoUpdate({ target: users.email, set: { role: "super_admin", setupTokenHash: tokenHash, setupTokenExpires: expires } });

  const base = process.env.APP_URL ?? "http://localhost:3000";
  console.log(`Super admin ${email} is ready. Set the password here (valid 7 days):\n${base}/set-password?token=${token}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});