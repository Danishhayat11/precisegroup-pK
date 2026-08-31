/**
 * Print Debug Bundle
 * ------------------
 * One-click diagnostic dump for A4 print issues. Captures viewport metrics,
 * computed styles of the print sheet, font/image readiness, the print-flow
 * ring buffer (window.__ppPrintDebug) and a rolling capture of console logs.
 *
 * Usage:
 *   import { downloadPrintDebugBundle, installConsoleCapture } from
 *     "@/lib/printDebugBundle";
 *   installConsoleCapture();       // once, at app startup
 *   downloadPrintDebugBundle();    // on button click
 */

const CONSOLE_BUFFER_MAX = 300;
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;
type ConsoleLevel = (typeof CONSOLE_METHODS)[number];

type ConsoleEntry = {
  ts: string;
  level: ConsoleLevel;
  args: string[];
};

const CONSOLE_BUFFER: ConsoleEntry[] = [];
let consoleInstalled = false;

function safeStringify(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? "\n" + v.stack : ""}`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, (_k, val) => {
      if (val instanceof Node) return `[Node ${(val as Element).nodeName ?? ""}]`;
      if (val instanceof Window) return "[Window]";
      return val;
    });
  } catch {
    try {
      return String(v);
    } catch {
      return "[unserializable]";
    }
  }
}

export function installConsoleCapture(): void {
  if (consoleInstalled || typeof window === "undefined" || typeof console === "undefined") return;
  consoleInstalled = true;
  for (const level of CONSOLE_METHODS) {
    const orig = console[level]?.bind(console);
    if (!orig) continue;
    console[level] = (...args: unknown[]) => {
      try {
        CONSOLE_BUFFER.push({
          ts: new Date().toISOString(),
          level,
          args: args.map(safeStringify),
        });
        if (CONSOLE_BUFFER.length > CONSOLE_BUFFER_MAX) {
          CONSOLE_BUFFER.splice(0, CONSOLE_BUFFER.length - CONSOLE_BUFFER_MAX);
        }
      } catch {
        /* ignore capture errors */
      }
      orig(...args);
    };
  }
}

export function getCapturedConsole(): ConsoleEntry[] {
  return CONSOLE_BUFFER.slice();
}

const KEY_COMPUTED_PROPS = [
  "boxSizing",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "border",
  "overflow",
  "overflowX",
  "overflowY",
  "display",
  "position",
  "transform",
  "transformOrigin",
  "zoom",
  "pageBreakBefore",
  "pageBreakAfter",
  "pageBreakInside",
  "breakBefore",
  "breakAfter",
  "breakInside",
  "fontFamily",
  "fontSize",
  "lineHeight",
  "color",
  "backgroundColor",
];

function collectComputed(el: Element): Record<string, string> {
  const cs = window.getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const p of KEY_COMPUTED_PROPS) {
    // @ts-expect-error index access on CSSStyleDeclaration
    const v = cs[p];
    if (typeof v === "string" && v.length) out[p] = v;
  }
  return out;
}

function describeElement(el: Element): Record<string, unknown> {
  const rect = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    id: (el as HTMLElement).id || undefined,
    className: (el as HTMLElement).className || undefined,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    },
    scroll: {
      w: (el as HTMLElement).scrollWidth,
      h: (el as HTMLElement).scrollHeight,
    },
    computed: collectComputed(el),
  };
}

function collectImages(root: ParentNode): Array<Record<string, unknown>> {
  return Array.from(root.querySelectorAll("img")).map((img) => ({
    src: img.currentSrc || img.src,
    complete: img.complete,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    loading: img.loading,
    fetchpriority: img.getAttribute("fetchpriority"),
    decoded: img.complete && img.naturalWidth > 0,
    alt: img.alt || undefined,
  }));
}

function collectFonts(): Record<string, unknown> {
  const anyDoc = document as Document & {
    fonts?: FontFaceSet & {
      status?: string;
      forEach?: (cb: (f: FontFace) => void) => void;
    };
  };
  const fonts = anyDoc.fonts;
  if (!fonts) return { available: false };
  const faces: Array<{ family: string; status: string; weight: string; style: string }> = [];
  try {
    fonts.forEach?.((f) =>
      faces.push({
        family: f.family,
        status: f.status,
        weight: f.weight,
        style: f.style,
      }),
    );
  } catch {
    /* ignore */
  }
  return {
    available: true,
    status: fonts.status,
    ready: (fonts as unknown as { ready?: Promise<unknown> }).ready ? "pending-or-resolved" : "n/a",
    faces,
  };
}

export type PrintDebugBundle = {
  schema: "pp.print-debug-bundle/v1";
  capturedAt: string;
  page: {
    url: string;
    title: string;
    userAgent: string;
    language: string;
    platform: string;
    devicePixelRatio: number;
    prefersColorScheme: string;
  };
  viewport: {
    innerWidth: number;
    innerHeight: number;
    outerWidth: number;
    outerHeight: number;
    documentClientWidth: number;
    documentClientHeight: number;
    scrollX: number;
    scrollY: number;
    orientation?: string;
  };
  print: {
    matchesPrintMedia: boolean;
    hostPresent: boolean;
    styleTagPresent: boolean;
    debugEntries: unknown[];
  };
  sheets: Array<{
    index: number;
    describe: Record<string, unknown>;
    images: Array<Record<string, unknown>>;
    imageReadyCount: number;
    imageTotal: number;
  }>;
  fonts: Record<string, unknown>;
  consoleLogs: ConsoleEntry[];
  errors: string[];
};

export function buildPrintDebugBundle(): PrintDebugBundle {
  const errors: string[] = [];
  const capture = <T>(fn: () => T, fallback: T, label: string): T => {
    try {
      return fn();
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    }
  };

  const w = window as unknown as {
    __ppPrintDebug?: { entries: () => unknown[] };
  };
  const sheets = Array.from(document.querySelectorAll<HTMLElement>(".doc-sheet"));

  return {
    schema: "pp.print-debug-bundle/v1",
    capturedAt: new Date().toISOString(),
    page: capture(
      () => ({
        url: location.href,
        title: document.title,
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        devicePixelRatio: window.devicePixelRatio,
        prefersColorScheme: window.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
      }),
      {} as PrintDebugBundle["page"],
      "page",
    ),
    viewport: capture(
      () => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        documentClientWidth: document.documentElement.clientWidth,
        documentClientHeight: document.documentElement.clientHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        orientation: (screen.orientation && screen.orientation.type) || undefined,
      }),
      {} as PrintDebugBundle["viewport"],
      "viewport",
    ),
    print: capture(
      () => ({
        matchesPrintMedia: window.matchMedia?.("print").matches ?? false,
        hostPresent: !!document.getElementById("pp-print-host"),
        styleTagPresent: !!document.getElementById("pp-print-runtime"),
        debugEntries: w.__ppPrintDebug?.entries?.() ?? [],
      }),
      {
        matchesPrintMedia: false,
        hostPresent: false,
        styleTagPresent: false,
        debugEntries: [],
      },
      "print",
    ),
    sheets: sheets.map((el, index) =>
      capture(
        () => {
          const imgs = collectImages(el);
          return {
            index,
            describe: describeElement(el),
            images: imgs,
            imageReadyCount: imgs.filter((i) => i.decoded).length,
            imageTotal: imgs.length,
          };
        },
        {
          index,
          describe: {},
          images: [],
          imageReadyCount: 0,
          imageTotal: 0,
        },
        `sheet[${index}]`,
      ),
    ),
    fonts: capture(collectFonts, { available: false }, "fonts"),
    consoleLogs: getCapturedConsole(),
    errors,
  };
}

export function downloadPrintDebugBundle(filenameHint = "print-debug"): PrintDebugBundle {
  const bundle = buildPrintDebugBundle();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${filenameHint}-${stamp}.json`;
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return bundle;
}
