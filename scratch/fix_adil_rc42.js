import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://omxephqkcxynzxekywhn.supabase.co";
// We only need the publishable key for email/password auth!
const PUBLISHABLE_KEY = "sb_publishable_0IJ6uUCFu3dnguK6qJoV5A_AJs_Jyv6";

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("❌ Please provide your Admin Email and Password.");
  console.error("Usage: node scratch/fix_adil_rc42.js <EMAIL> <PASSWORD>");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY);

async function run() {
  console.log(`Logging in as ${email}...`);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (authError) {
    console.error("❌ Login failed:", authError.message);
    return;
  }
  console.log("✅ Logged in successfully!");

  console.log(`Connecting to ${SUPABASE_URL}...`);
  console.log("Searching for payment RC-000042...");

  // 1. Fetch the original payment by searching for the receipt number or amount/name
  let { data: original, error: fetchError } = await supabase
    .from("payments")
    .select("*")
    .ilike("receipt_no", "%RC-000042%")
    .maybeSingle();

  if (!original) {
    console.log(
      "⚠️ Could not find an exact match for RC-000042. Searching for Adil Khan with amount 700000...",
    );
    const { data: fallbackSearch } = await supabase
      .from("payments")
      .select("*")
      .ilike("client_name", "%Adil%")
      .eq("amount", 700000);

    if (fallbackSearch && fallbackSearch.length === 1) {
      original = fallbackSearch[0];
      console.log(`✅ Found record using fallback search: Receipt No: ${original.receipt_no}`);
    } else if (fallbackSearch && fallbackSearch.length > 1) {
      console.error(
        "❌ Found multiple records matching Adil with 700000 amount. Cannot proceed safely. Matches:",
      );
      console.table(fallbackSearch);
      return;
    } else {
      console.error(
        "❌ Could not find the record at all. Please check the receipt number or database.",
      );

      console.log("Here are the last 5 payments for Adil:");
      const { data: adilPayments } = await supabase
        .from("payments")
        .select("payment_id, receipt_no, client_name, amount")
        .ilike("client_name", "%Adil%")
        .limit(5);
      console.table(adilPayments);
      return;
    }
  }

  if (original.amount !== 700000) {
    console.log(
      `⚠️ Warning: The current amount of ${original.receipt_no} is ${original.amount}, not 700000. Double check if this is already adjusted!`,
    );
    // We will still proceed if the user wants to force it, but let's pause or warn.
    // To be safe, if it's already 332000, we shouldn't do it again.
    if (original.amount === 332000) {
      console.log(
        "✅ It looks like this record was already adjusted to 332000. Aborting so we don't duplicate the possession record.",
      );
      return;
    }
  }

  console.log(`Found payment: ${original.receipt_no} - Amount: ${original.amount}`);

  // 2. Update the original payment to 332,000 (Installment 05)
  console.log(`Updating ${original.receipt_no} amount to 332000...`);
  const { error: updateError } = await supabase
    .from("payments")
    .update({ amount: 332000 })
    .eq("payment_id", original.payment_id);

  if (updateError) {
    console.error(`❌ Failed to update ${original.receipt_no}:`, updateError);
    return;
  }

  // 3. Create the new payment for 368,000 (Possession)
  console.log("Creating new payment for remaining 368000 as possession amount...");

  // Clone and clean the original payment object
  const newPayment = { ...original };
  delete newPayment.payment_id; // Let DB generate new ID
  delete newPayment.created_at;
  delete newPayment.updated_at;

  // Generate a new unique receipt number
  newPayment.receipt_no = original.receipt_no + "-POS";
  newPayment.amount = 368000;
  newPayment.payment_head = "Possession";
  newPayment.remarks =
    (original.remarks || "") + ` | Split from ${original.receipt_no} for possession amount`;

  const { data: insertedData, error: insertError } = await supabase
    .from("payments")
    .insert([newPayment])
    .select();

  if (insertError) {
    console.error("❌ Failed to insert new possession payment:", insertError);
    return;
  }

  console.log("✅ Success!");
  console.log(`- Updated ${original.receipt_no} amount to 332,000 (Installment 05)`);
  console.log(
    `- Created new payment ${newPayment.receipt_no} for 368,000 (Payment ID: ${insertedData[0]?.payment_id})`,
  );
}

run();
