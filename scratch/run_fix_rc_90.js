import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://kynszktuilxjqeurgzkm.supabase.co"; // Using the ref from the JWT
const SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5bnN6a3R1aWx4anFldXJnemttIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTQzMzE4MCwiZXhwIjoyMTAxMDA5MTgwfQ.9hodfEQxd0zucT20Do8odCPc2SrBtC4Q0bytiHJ2wI8";

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
