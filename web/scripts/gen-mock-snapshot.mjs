// Copies the real pre-change CRM export and the scraped locations into web/lib/mock/snapshot.json, so mock mode
// (DATA_SOURCE=mock) and the executor tests run on real records with zero CRM or database writes.
// Usage: npm run gen:mock   (re-run whenever data/ changes)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const read = (p) => JSON.parse(readFileSync(resolve(repo, p), "utf-8"));

const accounts = read("data/crm-snapshot-before/accounts.json");
const contacts = read("data/crm-snapshot-before/contacts.json");
const scrape = read("data/scrapes/2026-11-21.json");

const out = resolve(here, "..", "lib", "mock", "snapshot.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ scraped_at: scrape.scraped_at, accounts, contacts, locations: scrape.locations }) + "\n");
console.log(`wrote ${out}: ${accounts.length} accounts, ${contacts.length} contacts, ${scrape.locations.length} locations`);
