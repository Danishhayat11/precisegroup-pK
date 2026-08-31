export type Severity = "error" | "warning" | "info";
export type Category = "syntax" | "logic" | "performance" | "style";
export type Language =
  | "javascript"
  | "typescript"
  | "python"
  | "java"
  | "csharp"
  | "go"
  | "rust"
  | "ruby"
  | "php"
  | "sql";

export interface Issue {
  id: string;
  line: number;
  endLine?: number;
  severity: Severity;
  category: Category;
  title: string;
  rootCause: string;
  match: string;
  replacement: string;
  fixLabel?: string;
}

export interface ResolvedIssue {
  issueId: string;
  title: string;
  severity: Severity;
  resolvedAt: number;
}
