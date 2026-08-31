# chart-qa-failures.json — schema

Sidecar JSON emitted by the **Chart QA → Download QA report PDF** action on
`/chart-preview` whenever **Include failure JSON** is enabled. The same payload
is embedded verbatim inside the PDF's "Failure JSON" section.

**Machine-readable JSON Schema:**
[`docs/schemas/chart-qa-failures.schema.json`](./schemas/chart-qa-failures.schema.json)
(Draft 2020-12) — use this for automated validation in downstream tooling.

**Migrating an existing consumer?** See
[`chart-qa-failures-migration.md`](./chart-qa-failures-migration.md) for the
recommended `"environment" in payload` detection pattern and language cheatsheet.

The payload is produced by the pure builder
[`buildFailuresPayload`](../src/lib/chartQaFailuresPayload.ts) and is covered
by [`chartQaFailuresPayload.test.ts`](../src/lib/__tests__/chartQaFailuresPayload.test.ts)
and [`chartQaFailuresPayload.schema.test.ts`](../src/lib/__tests__/chartQaFailuresPayload.schema.test.ts).

## Fields (always present)

| Field                 | Type                | Notes                                                               |
| --------------------- | ------------------- | ------------------------------------------------------------------- |
| `generatedAt`         | ISO-8601 string     | Client clock at export time.                                        |
| `viewport`            | string              | e.g. `"1280px"` or `"full width"`.                                  |
| `enabledChartTypes`   | string[]            | Chart type IDs included in the sweep.                               |
| `appTheme`            | `"light" \| "dark"` | Theme active when the export ran.                                   |
| `environmentIncluded` | boolean             | Mirrors the **Include environment block** toggle. Always present.   |
| `expectedSeriesOrder` | string[]            | Human-readable series labels in the order the UI expects to render. |
| `fullSweep`           | object              | Per-step PASS/FAIL for both themes, run duration, overall counts.   |
| `failures`            | object[]            | Interaction-tester failures (may be empty).                         |

## Conditional field

### `environment`

**Contract: the `environment` key is hard-omitted from the JSON whenever
`environmentIncluded === false`.**

- When **Include environment block** is ON → the object includes an
  `environment` field with `userAgent`, `devicePixelRatio`, `viewport`,
  `buildMode`, and `libraryVersions`.
- When **Include environment block** is OFF → the `environment` key is
  **not present at all**. It is not `null`, not `undefined`, not `{}`.
  `"environment" in payload` is `false` and `JSON.stringify(payload)` will
  not contain the substring `"environment":`.

The toggle only takes effect when **Include failure JSON** is enabled; if
failure JSON export is off, no sidecar is emitted at all.

## Consumer guidance

- **Do not** feature-detect the environment block with truthiness checks such
  as `payload.environment?.userAgent` alone — the key is absent, so use
  `"environment" in payload` (or check `environmentIncluded`) when the
  distinction matters for your tooling.
- Bug-triage automation that requires the environment block MUST reject
  payloads with `environmentIncluded === false` and ask the reporter to
  re-export with the toggle enabled.

## Example — environment omitted

```json
{
  "generatedAt": "2026-07-04T00:00:00.000Z",
  "viewport": "1280px",
  "enabledChartTypes": ["bar", "line"],
  "appTheme": "light",
  "environmentIncluded": false,
  "expectedSeriesOrder": ["Revenue", "Cost"],
  "fullSweep": { "steps": [] },
  "failures": []
}
```

## Example — environment included

```json
{
  "generatedAt": "2026-07-04T00:00:00.000Z",
  "viewport": "1280px",
  "enabledChartTypes": ["bar", "line"],
  "appTheme": "light",
  "environmentIncluded": true,
  "expectedSeriesOrder": ["Revenue", "Cost"],
  "fullSweep": { "steps": [] },
  "failures": [],
  "environment": {
    "userAgent": "Mozilla/5.0 …",
    "devicePixelRatio": 2,
    "viewport": { "width": 1280, "height": 1800 },
    "buildMode": "production",
    "libraryVersions": { "recharts": "2.x", "react": "19.x" }
  }
}
```

## Changelog

- **2026-07-04** — Introduced `environmentIncluded` flag. When the
  **Include environment block** toggle is off, the `environment` field is now
  fully absent from both the PDF failure JSON block and
  `chart-qa-failures.json` (previously it was always present).
