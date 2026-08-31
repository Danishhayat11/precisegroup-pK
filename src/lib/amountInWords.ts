// Pakistani numbering: Lac (100,000) and Crore (10,000,000)
const ones = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under1000(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ones[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return tens[t] + (o ? "-" + ones[o] : "");
  }
  const h = Math.floor(n / 100);
  const r = n % 100;
  return ones[h] + " Hundred" + (r ? " " + under1000(r) : "");
}

export function amountInWordsPK(amount: number): string {
  const n = Math.floor(Math.abs(amount));
  if (n === 0) return "Rupees Zero Only";
  const crore = Math.floor(n / 10000000);
  const lac = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (crore) parts.push(under1000(crore) + " Crore");
  if (lac) parts.push(under1000(lac) + " Lac");
  if (thousand) parts.push(under1000(thousand) + " Thousand");
  if (rest) parts.push(under1000(rest));
  return "Rupees " + parts.join(" ") + " Only";
}
