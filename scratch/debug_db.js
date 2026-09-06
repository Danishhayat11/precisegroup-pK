import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://kynszktuilxjqeurgzkm.supabase.co";
const SERVICE_KEY = process.argv[2];

if (!SERVICE_KEY) {
  console.error("❌ Please provide your Supabase Service Role Key as an argument.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  console.log(`Checking payments in ${SUPABASE_URL}...`);

  const { data, error } = await supabase
    .from("payments")
    .select("receipt_no, amount, client_name")
    .ilike("receipt_no", "%90%")
    .limit(10);

  if (error) {
    console.error("Error fetching payments:", error);
    return;
  }

  if (data.length === 0) {
    console.log("⚠️ No payments found matching '90'. Checking total payments...");
    const { count, error: countError } = await supabase
      .from("payments")
      .select("*", { count: "exact", head: true });

    if (countError) {
      console.error("Error fetching count:", countError);
    } else {
      console.log(`Total payments in this database: ${count}`);
    }
  } else {
    console.log("Found these matching payments:");
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
