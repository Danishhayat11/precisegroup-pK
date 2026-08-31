import { createServerFn } from "@tanstack/react-start";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// -----------------------------------------------------------------------------
// Public types (shared with the client)
// -----------------------------------------------------------------------------
export const SUPPORTED_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
  "csharp",
  "cpp",
  "php",
  "ruby",
  "sql",
  "bash",
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Category = "syntax" | "logic" | "performance";

export interface Diagnostic {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  line: number;
  explanation: string;
  faultySnippet: string;
  fixedSnippet: string;
}

export interface AnalysisReport {
  summary: string;
  diagnostics: Diagnostic[];
  fixedCode: string;
}

// -----------------------------------------------------------------------------
// Analyze code — structured output via Gemini through Lovable AI Gateway.
// -----------------------------------------------------------------------------
const AnalyzeInput = z.object({
  code: z.string().min(1).max(20_000),
  language: z.enum(SUPPORTED_LANGUAGES),
});

const DiagnosticSchema = z.object({
  id: z.string(),
  category: z.enum(["syntax", "logic", "performance"]),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  title: z.string(),
  line: z.number(),
  explanation: z.string(),
  faultySnippet: z.string(),
  fixedSnippet: z.string(),
});

const ReportSchema = z.object({
  summary: z.string(),
  diagnostics: z.array(DiagnosticSchema),
  fixedCode: z.string(),
});

const SYSTEM_PROMPT = `You are a senior staff engineer reviewing code as a static analyzer.
Return a structured report with:
- summary: 1–2 sentences on the overall health of the snippet.
- diagnostics: individual issues. Categorize STRICTLY as:
    * "syntax"      — parser / compiler errors, typos, missing tokens.
    * "logic"       — the code parses but the behavior is wrong.
    * "performance" — correct but slow / wasteful / non-scalable.
  Choose severity honestly: critical (breaks build / data loss), high, medium, low, info.
  faultySnippet is the exact original lines. fixedSnippet is the corrected replacement.
  Keep explanations tight (1–3 sentences), technical, and actionable.
- fixedCode: a complete refactored version of the entire input with EVERY diagnostic addressed.
  Preserve the author's intent, naming, and formatting where possible.
If the code is clean, return an empty diagnostics array and echo the input as fixedCode.`;

export const analyzeCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AnalyzeInput.parse(input))
  .handler(async ({ data }): Promise<AnalysisReport> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured on this workspace.");

    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const prompt = `Language: ${data.language}\n\n\`\`\`${data.language}\n${data.code}\n\`\`\``;

    try {
      const { output } = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt,
        output: Output.object({ schema: ReportSchema }),
      });

      // Assign stable ids if the model returned duplicates/empties.
      const diagnostics = output.diagnostics.map((d, i) => ({
        ...d,
        id: d.id?.trim() || `diag-${i + 1}`,
      }));
      return { ...output, diagnostics };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        // Model produced non-conforming JSON — degrade gracefully.
        return {
          summary:
            "The analyzer returned an unstructured response. Try again or shorten the snippet.",
          diagnostics: [],
          fixedCode: data.code,
        };
      }
      throw error;
    }
  });
