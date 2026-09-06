import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://omxephqkcxynzxekywhn.supabase.co";
const SERVICE_KEY = process.argv[2];

if (!SERVICE_KEY) {
  console.error("❌ Please provide your Supabase Service Role Key as an argument.");
  console.error("Usage: node scratch/fix_rc_90.js <SERVICE_ROLE_KEY>");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  console.log("Fetching payment RC-000090...");

  // 1. Fetch the original payment
  const { data: original, error: fetchError } = await supabase
    .from("payments")
    .select("*")
    .eq("receipt_no", "RC-000090")
    .single();

  if (fetchError || !original) {
    console.error("❌ Failed to fetch RC-000090:", fetchError);
    return;
  }

  console.log(`Found original payment. Current amount: ${original.amount}`);

  // 2. Update the original payment to 432,000
  console.log("Updating RC-000090 amount to 432000...");
  const { error: updateError } = await supabase
    .from("payments")
    .update({ amount: 432000 })
    .eq("payment_id", original.payment_id);

  if (updateError) {
    console.error("❌ Failed to update RC-000090:", updateError);
    return;
  }

  // 3. Create the new payment for 368,000
  console.log("Creating new payment for remaining 368000 as possession amount...");

  // Clone and clean the original payment object
  const newPayment = { ...original };
  delete newPayment.payment_id; // Let DB generate new ID
  delete newPayment.created_at;
  delete newPayment.updated_at;

  // Generate a new unique receipt number if needed, or leave it distinct
  // We'll append -POS to the receipt number to make it trackable
  newPayment.receipt_no = original.receipt_no + "-POS";
  newPayment.amount = 368000;
  newPayment.payment_head = "Possession"; // Set head to possession
  newPayment.remarks = (original.remarks || "") + " | Split from RC-000090 for possession amount";

  const { data: insertedData, error: insertError } = await supabase
    .from("payments")
    .insert([newPayment])
    .select();

  if (insertError) {
    console.error("❌ Failed to insert new possession payment:", insertError);
    return;
  }

  console.log("✅ Success!");
  console.log("- Updated RC-000090 amount to 432,000");
  console.log(
    `- Created new payment ${newPayment.receipt_no} for 368,000 (Payment ID: ${insertedData[0]?.payment_id})`,
  );
}

run();
