import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { remindInactiveTickets } from "../ticket-auto-close";

const [namespace, ticketId] = process.argv.slice(2);
if (!/^ticket_inactivity_test_[a-f0-9]+$/.test(namespace) || !ticketId) throw new Error("Invalid isolated fixture");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${namespace},public` });
const database = drizzle(pool, { schema });
await remindInactiveTickets(async () => {
  process.send?.({ sending: true });
  // Parent deliberately terminates the process with the provider outcome unknown.
  await new Promise<void>(() => {});
}, ticketId, database);
