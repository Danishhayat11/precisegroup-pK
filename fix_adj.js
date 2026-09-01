const fs = require("fs");
const file = "src/pages/Dashboard.tsx";
let content = fs.readFileSync(file, "utf8");
content = content.replace(
  "  const totalReceived = __totals.totalReceived;",
  "  const totalReceived = __totals.totalReceived;\n  const adjApproved = __totals.adjApproved;"
);
content = content.replace(
  /  \/\/ Adjustment Allowed[\s\S]*?  \);\n/g,
  ""
);
fs.writeFileSync(file, content);
