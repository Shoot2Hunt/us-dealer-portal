import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,"")]}));
const [r] = await neon(env.DATABASE_URL)`select store, product_id from inventory where coalesce(description,'')='' and coalesce(short_description,'')='' limit 1`;
process.stdout.write(`${r.store}/${r.product_id}`);
