import { createClient } from "@supabase/supabase-js";

// The new correct database on Vercel
const SUPABASE_URL = "https://kynszktuilxjqeurgzkm.supabase.co";
const SERVICE_KEY = process.argv[2];

if (!SERVICE_KEY) {
  console.error("❌ Please provide your Supabase Service Role Key as an argument.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  console.log(`Connecting to ${SUPABASE_URL}...`);
  console.log("Searching for Adil Khan's RC-000090 payment...");

  // 1. Fetch using case-insensitive search to avoid "0 rows" error
  const { data: searchResults, error: fetchError } = await supabase
    .from("payments")
    .select("*")
    .ilike("client_name", "%Adil%")
    .ilike("receipt_no", "%90%");

  if (fetchError) {
    console.error("❌ Error searching for payment:", fetchError);
    return;
  }

  if (!searchResults || searchResults.length === 0) {
    console.error("❌ Could not find any payment for Adil Khan with '90' in the receipt number.");
    return;
  }

  // Just take the first match
  const original = searchResults[0];
  console.log(
    `✅ Found payment: ${original.receipt_no} | ${original.client_name} | Amount: ${original.amount}`,
  );

  // 2. Update the original payment to 432,000
  console.log(`Updating ${original.receipt_no} amount to 432000...`);
  const { error: updateError } = await supabase
    .from("payments")
    .update({ amount: 432000 })
    .eq("payment_id", original.payment_id);

  if (updateError) {
    console.error(`❌ Failed to update ${original.receipt_no}:`, updateError);
    return;
  }

  // 3. Create the new payment for 368,000
  console.log("Creating new payment for remaining 368000 as possession amount...");

  const newPayment = { ...original };
  delete newPayment.payment_id;
  delete newPayment.created_at;
  delete newPayment.updated_at;

  newPayment.receipt_no = original.receipt_no.trim() + "-POS";
  newPayment.amount = 368000;
  newPayment.payment_head = "Possession";
  newPayment.remarks =
    (original.remarks || "") + " | Split from " + original.receipt_no + " for possession amount";

  const { data: insertedData, error: insertError } = await supabase
    .from("payments")
    .insert([newPayment])
    .select();

  if (insertError) {
    console.error("❌ Failed to insert new possession payment:", insertError);
    return;
  }

  console.log("\n🎉 SUCCESS!");
  console.log(`- Updated original ${original.receipt_no} down to 432,000`);
  console.log(`- Created new payment ${newPayment.receipt_no} for 368,000`);
}

run();
