const fs = require("fs");

const files = [
  "src/pages/__tests__/export-formula-reference.test.ts",
  "src/pages/__tests__/export-formula-reference-all-kpis.test.ts",
  "src/pages/__tests__/total-received-tooltip.test.ts",
  "src/lib/ledger/summary.ts",
  "src/lib/__tests__/pdfFooter-geometry.test.ts",
  "src/lib/__tests__/pdfFooter-custom-size-fit.test.ts",
  "src/lib/__tests__/pdfFooter-minus-sign.test.ts",
  "src/lib/__tests__/pdfFooter.test.ts",
  "src/lib/__tests__/totals.test.ts",
];

files.forEach((f) => {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, "utf8");

    // Total Received identity (Cash − Adjustment Approved − Commission)
    content = content.replace(/Adjustment Approved/g, "Asset Realized");

    // Dashboard.tsx had some short/spoken that we changed to Cash/Bank
    content = content.replace(
      /Cash \+ Asset Realized − Commission Paid/g,
      "Cash/Bank + Asset Realized − Commission Paid",
    );
    content = content.replace(
      /Cash plus Asset Realized minus Commission Paid/g,
      "Cash/Bank plus Asset Realized minus Commission Paid",
    );

    fs.writeFileSync(f, content);
    console.log("Updated", f);
  }
});
