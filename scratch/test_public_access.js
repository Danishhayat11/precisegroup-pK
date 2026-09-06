import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mxephqkcxynzxekywhn.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_0IJ6uUCFu3dnguK6qJoV5A_AJs_Jyv6";

const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY);

async function test() {
  console.log("Testing public read access to old database...");
  const tables = ["payments", "bookings", "clients", "properties"];

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("*").limit(1);
    if (error) {
      console.log(`❌ ${table}: ${error.message}`);
    } else {
      console.log(`✅ ${table}: Access allowed! Got ${data.length} rows.`);
    }
  }
}

test();
