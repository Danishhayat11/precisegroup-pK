import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://kynszktuilxjqeurgzkm.supabase.co";
const SERVICE_KEY = process.argv[2];

if (!SERVICE_KEY) {
  console.error("❌ Please provide your Supabase Service Role Key as an argument.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  console.log(`Connecting to ${SUPABASE_URL}...`);
  console.log("Searching for ALL payments containing 'Adil'...");

  const { data: searchResults, error: fetchError } = await supabase
    .from("payments")
    .select("payment_id, receipt_no, client_name, amount, payment_head")
    .ilike("client_name", "%Adil%");

  if (fetchError) {
    console.error("❌ Error searching for payment:", fetchError);
    return;
  }

  if (!searchResults || searchResults.length === 0) {
    console.error(
      "❌ Could not find ANY payments for a client named 'Adil'. The database might be empty or the name is spelled differently.",
    );

    console.log("\nChecking total number of payments in the database just to be sure...");
    const { count } = await supabase.from("payments").select("*", { count: "exact", head: true });
    console.log(`Total payments in database: ${count}`);
    return;
  }

  console.log(`✅ Found ${searchResults.length} payments for Adil! Here they are:`);
  console.table(searchResults);
}

run();
