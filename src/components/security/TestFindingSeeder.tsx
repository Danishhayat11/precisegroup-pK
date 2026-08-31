/**
 * TestFindingSeeder — dev-only harness that lets a reviewer seed a temporary
 * synthetic security finding, ignore it with a justification, refresh the
 * page, and then simulate the next scan to confirm the finding is skipped.
 *
 * All state is browser-local (see `@/lib/security/testFindings`) and never
 * touches the real scanner or security-memory backend.
 */
import { useCallback, useState } from "react";
import { FlaskConical, Trash2, RefreshCw, Play, Eraser } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SecurityFinding } from "@/lib/security/findings";
import {
  buildTestFinding,
  clearAllTestState,
  forgetIgnored,
  getIgnoredMemory,
  listTestFindings,
  saveTestFindings,
  type IgnoredMemory,
} from "@/lib/security/testFindings";

export function TestFindingSeeder({
  onChange,
  onSimulateNextScan,
  simulating,
}: {
  /** Fires whenever the seeded/ignored state changes so the parent can re-derive the panel input. */
  onChange: () => void;
  /** Toggle the "next scan" simulation (skip ignored+justified findings). */
  onSimulateNextScan: (next: boolean) => void;
  simulating: boolean;
}) {
  const [seeded, setSeeded] = useState<SecurityFinding[]>(() => listTestFindings());
  const [memory, setMemory] = useState<IgnoredMemory>(() => getIgnoredMemory());

  const refresh = useCallback(() => {
    setSeeded(listTestFindings());
    setMemory(getIgnoredMemory());
    onChange();
  }, [onChange]);

  const seedOne = useCallback(() => {
    const next = [...listTestFindings(), buildTestFinding()];
    saveTestFindings(next);
    refresh();
  }, [refresh]);

  const removeOne = useCallback(
    (id: string) => {
      saveTestFindings(listTestFindings().filter((f) => f.id !== id));
      forgetIgnored(id);
      refresh();
    },
    [refresh],
  );

  const reloadPage = useCallback(() => {
    window.location.reload();
  }, []);

  const clearAll = useCallback(() => {
    clearAllTestState();
    refresh();
  }, [refresh]);

  const ignoredCount = Object.keys(memory).length;

  return (
    <Card
      className="border-dashed border-primary/25 bg-card/40 backdrop-blur"
      data-testid="test-finding-seeder"
    >
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 font-serif text-base">
            <FlaskConical className="h-4 w-4 text-[hsl(var(--gold))]" aria-hidden />
            Test harness — verify ignore-with-justification
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {seeded.length} seeded
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {ignoredCount} in ignore-memory
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Seed a synthetic finding, ignore it with a ≥ 20-character justification and export
          decisions, then reload — the finding should reappear pre-marked as <em>ignored</em>. Turn
          on <em>Simulate next scan</em> to confirm it also drops out of the scanner's result set
          once security-memory has the rule.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={seedOne} data-testid="seeder-add">
            <FlaskConical className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Seed test finding
          </Button>
          <Button
            size="sm"
            variant={simulating ? "default" : "outline"}
            onClick={() => onSimulateNextScan(!simulating)}
            data-testid="seeder-simulate"
            aria-pressed={simulating}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {simulating ? "Simulating next scan" : "Simulate next scan"}
          </Button>
          <Button size="sm" variant="outline" onClick={reloadPage} data-testid="seeder-reload">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Reload page
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={clearAll}
            data-testid="seeder-clear"
            className="ml-auto"
          >
            <Eraser className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Clear all test state
          </Button>
        </div>

        {seeded.length === 0 && ignoredCount === 0 ? (
          <p className="rounded-md border border-dashed border-primary/15 bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
            No seeded findings yet. Click <em>Seed test finding</em> to add one to the review panel
            below.
          </p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {seeded.map((f) => {
              const remembered = memory[f.id];
              return (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-primary/10 bg-background/50 px-2.5 py-1.5 font-mono"
                  data-testid="seeder-row"
                >
                  <span className="truncate">{f.id}</span>
                  <span className="flex items-center gap-1.5">
                    {remembered ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-400/40 bg-emerald-400/10 text-[10px] text-emerald-200"
                      >
                        in memory
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        awaiting ignore
                      </Badge>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeOne(f.id)}
                      aria-label={`Remove ${f.id}`}
                      className="h-6 w-6 min-h-11 min-w-11"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </span>
                </li>
              );
            })}
            {/* Orphaned memory entries (finding was removed but rule still remembered) */}
            {Object.keys(memory)
              .filter((id) => !seeded.some((f) => f.id === id))
              .map((id) => (
                <li
                  key={`orphan-${id}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-primary/10 bg-background/50 px-2.5 py-1.5 font-mono text-muted-foreground"
                >
                  <span className="truncate">{id}</span>
                  <span className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      memory-only
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        forgetIgnored(id);
                        refresh();
                      }}
                      aria-label={`Forget ${id}`}
                      className="h-6 w-6 min-h-11 min-w-11"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </span>
                </li>
              ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
