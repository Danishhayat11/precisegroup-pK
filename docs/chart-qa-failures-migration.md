# Migration TL;DR — detecting the `environment` field

**Applies to:** `chart-qa-failures.json` and the QA PDF failure JSON block,
starting **2026-07-04**.

## What changed

The `environment` key is now **completely absent** from the payload when the
reporter disables **Include environment block**. Not `null`, not `undefined`,
not `{}` — the key does not exist. A boolean `environmentIncluded` is always
present and mirrors the toggle.

## How to detect it safely

Use key-existence, not truthiness. Either of these is correct:

```ts
if ("environment" in payload) {
  /* safe to read payload.environment */
}

if (payload.environmentIncluded) {
  /* schema guarantees payload.environment */
}
```

### Don't

```ts
if (payload.environment) { ... }          // conflates "absent" with "null"
if (payload.environment?.userAgent) { ... } // hides missing-vs-partial
```

## Cheatsheet

| Language   | Check                                  |
| ---------- | -------------------------------------- |
| TypeScript | `"environment" in payload`             |
| Python     | `"environment" in payload`             |
| Go         | `_, ok := payload["environment"]`      |
| Rust       | `payload.get("environment").is_some()` |
| jq         | `has("environment")`                   |

### Python example

```python
import json

with open("chart-qa-failures.json", encoding="utf-8") as f:
    payload = json.load(f)

# Key-existence check — works whether `environment` is absent, null, or {}.
if "environment" in payload and payload["environment"] is not None:
    env = payload["environment"]
    print("userAgent:", env.get("userAgent", "<unknown>"))
    print("devicePixelRatio:", env.get("devicePixelRatio", "<unknown>"))
else:
    # Reporter disabled "Include environment block".
    # payload["environmentIncluded"] is False (always present).
    print("No environment block in this export "
          f"(environmentIncluded={payload.get('environmentIncluded')})")
```

Run it against any sidecar file without a `KeyError`, whether the reporter
had the toggle on or off.

### jq example

`jq`'s `has("environment")` returns `true`/`false` without ever failing on
an absent key, so it's the right primitive for presence detection. Combine
it with `//` (alternative operator) for safe reads.

```bash
# Boolean: does the key exist? (Does NOT crash if it's absent.)
jq 'has("environment")' chart-qa-failures.json
# → true  or  false

# Branch on presence; read a nested field only when it exists.
jq -r '
  if has("environment")
  then "env: \(.environment.userAgent // "<unknown>")"
  else "env: <omitted, environmentIncluded=\(.environmentIncluded)>"
  end
' chart-qa-failures.json

# Safe scalar read regardless of presence — never throws, returns "" if absent.
jq -r '.environment.userAgent // ""' chart-qa-failures.json
```

Notes:

- `.environment.userAgent` on a payload where `environment` is **absent**
  evaluates to `null`, not an error — jq is null-safe by default. The `//`
  operator swaps `null` for a fallback.
- Prefer `has("environment")` over `.environment != null` when you need to
  distinguish "key absent" from "key present but null" — the former is the
  current exporter's shape, the latter is a legacy/tampered payload.
- In shell scripts, use `jq -e` when you want a non-zero exit on `false` or
  `null` (e.g. `jq -e 'has("environment")' file.json >/dev/null`).

### jq / bash CI snippet — fail fast on unexpected presence or absence

Set `EXPECT_ENV=1` when the job expects the block (e.g. bug triage) and
`EXPECT_ENV=0` when it must be omitted (e.g. redacted uploads). The script
exits non-zero the moment the payload disagrees, with a clear log line for
the CI annotation.

```bash
#!/usr/bin/env bash
set -euo pipefail

FILE="${1:-chart-qa-failures.json}"
EXPECT_ENV="${EXPECT_ENV:-1}"   # 1 = require environment, 0 = require it absent

# Contract: `environmentIncluded` must always be present and must agree with
# whether the `environment` key exists. Any drift is a hard failure.
read -r has_env included < <(
  jq -r '"\(has("environment")) \(.environmentIncluded)"' "$FILE"
)

if [[ "$has_env" != "$included" ]]; then
  echo "::error file=$FILE::payload is inconsistent: has(environment)=$has_env but environmentIncluded=$included" >&2
  exit 2
fi

case "$EXPECT_ENV:$has_env" in
  1:true)
    echo "OK: $FILE contains the environment block as expected"
    ;;
  0:false)
    echo "OK: $FILE omits the environment block as expected"
    ;;
  1:false)
    echo "::error file=$FILE::environment block missing — re-export with 'Include environment block' enabled" >&2
    exit 1
    ;;
  0:true)
    echo "::error file=$FILE::environment block present but this job requires it to be omitted" >&2
    exit 1
    ;;
esac
```

Exit codes: `0` OK · `1` presence mismatch · `2` payload self-inconsistent
(schema regression — investigate the exporter, not the reporter).

## Bulk code-mod — old `payload.environment` checks

### Checklist

1. **Find every reference.** Run `rg` first so you know the blast radius:
   ```bash
   rg -n --pcre2 '\bpayload\.environment\b' -g '!node_modules' -g '!dist'
   rg -n --pcre2 '\bpayload\["environment"\]|\bpayload\.get\("environment"\)' \
     -g '!node_modules' -g '!dist'
   ```
2. **Classify each hit** into one of:
   - **Gate** — `if (payload.environment)` deciding whether to render/report.
     → Rewrite to `if ("environment" in payload)` or
     `if (payload.environmentIncluded)`.
   - **Read** — `payload.environment.userAgent` etc.
     → Keep as-is, but move it _inside_ a Gate. Optional-chain
     (`payload.environment?.userAgent`) only for defensive reads, not gating.
   - **Serialize / forward** — writing the field to storage or a downstream
     API. → Preserve absence; do not coerce missing to `null` or `{}`.
3. **Codemod the Gates** in bulk with the `sed` recipes below.
4. **Manually review** every remaining Read hit — the gate change may have
   made an outer `?.` redundant, or exposed a missing null-check.
5. **Add a schema validation step** (Ajv / `check-jsonschema`) so future
   regressions fail CI instead of leaking through.
6. **Re-run** the initial `rg` commands; the only remaining hits should be
   Reads inside a Gate, or comments/docs.

### `sed` recipes (GNU sed; BSD/macOS: use `sed -i ''`)

Preview every change with `git diff` before committing — regex codemods on
source files always warrant a manual pass.

```bash
# 1. `if (payload.environment) {`  →  `if ("environment" in payload) {`
rg -l --pcre2 '\bif\s*\(\s*payload\.environment\s*\)' -g '!node_modules' \
  | xargs sed -i -E 's/\bif\s*\(\s*payload\.environment\s*\)/if ("environment" in payload)/g'

# 2. `payload.environment &&`  →  `"environment" in payload &&`
rg -l --pcre2 '\bpayload\.environment\s*&&' -g '!node_modules' \
  | xargs sed -i -E 's/\bpayload\.environment\s*&&/"environment" in payload \&\&/g'

# 3. Python: `if payload.get("environment"):`  →  `if "environment" in payload:`
rg -l --pcre2 '\bif\s+payload\.get\(\s*["\x27]environment["\x27]\s*\)\s*:' \
  | xargs sed -i -E 's/\bif\s+payload\.get\(\s*"environment"\s*\)\s*:/if "environment" in payload:/g; s/\bif\s+payload\.get\(\s*\x27environment\x27\s*\)\s*:/if "environment" in payload:/g'

# 4. Ternary read gates:
#    `payload.environment ? f(payload.environment) : g()`  →  keep read, fix gate
rg -l --pcre2 '\bpayload\.environment\s*\?' -g '!node_modules' \
  | xargs sed -i -E 's/\bpayload\.environment\s*\?(\s)/("environment" in payload) ?\1/g'
```

### What NOT to sed-rewrite

Leave these alone — they need human judgement:

- `payload.environment?.userAgent` and other **optional-chain reads** — these
  are correct defensive reads. Only the outer gate needs updating.
- `const { environment } = payload` — destructuring is fine; check the
  usage site instead and gate on `environmentIncluded` before dereferencing.
- Any code that **stores** the field (DB writes, forwarded API calls) —
  preserve absence semantics; do not coerce.
- Test fixtures that intentionally exercise legacy `{ environment: null }`
  shapes — keep them, add a new fixture with the key absent.

### Verification

After the codemod, run the project's unit + schema tests plus the initial
grep to confirm every remaining reference is intentional:

```bash
bunx vitest run src/lib/__tests__/chartQaFailuresPayload.test.ts \
                src/lib/__tests__/chartQaFailuresPayload.schema.test.ts
rg -n --pcre2 '\bif\s*\(\s*payload\.environment\s*\)' -g '!node_modules'
# expected: no matches
```

## Edge cases and gotchas

The current exporter only ever emits `environment` in one of two shapes:
**absent** or a **non-empty object**. But real consumers see hand-edited
files, legacy exports, corrupted uploads, and hostile input — code
defensively against all of these.

### Shape matrix

| Shape in payload                                           | Meaning                             | How to treat it                              |
| ---------------------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| key absent, `environmentIncluded: false`                   | ✅ Toggle off, current exporter     | Skip environment reads. No warning needed.   |
| key present, non-empty object, `environmentIncluded: true` | ✅ Toggle on, current exporter      | Safe to read fields with `.get()` / `?.`.    |
| `environment: {}`                                          | ⚠️ Legacy / hand-edited             | Treat as "no useful data" — do NOT read.     |
| `environment: null`                                        | ⚠️ Legacy / storage normalization   | Treat as absent. Warn on ingest.             |
| `environment: "string" \| number \| [] \| bool`            | ❌ Corrupt / wrong type             | Reject the whole payload; do not coerce.     |
| `environmentIncluded` missing                              | ❌ Pre-2026-07-04 export or forgery | Reject the whole payload; require re-export. |
| `environmentIncluded` disagrees with key presence          | ❌ Exporter regression or tampering | Reject the whole payload; open a bug.        |

### Safe read pattern (TypeScript)

```ts
type Env = Record<string, unknown>;

function readEnvironment(payload: Record<string, unknown>): Env | null {
  if (typeof payload.environmentIncluded !== "boolean") return null; // reject
  if (!payload.environmentIncluded) return null; // omitted
  const env = payload.environment;
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    return null; // wrong type
  }
  if (Object.keys(env as object).length === 0) return null; // empty
  return env as Env;
}
```

### Safe read pattern (Python)

```python
from collections.abc import Mapping

def read_environment(payload: dict) -> dict | None:
    if not isinstance(payload.get("environmentIncluded"), bool):
        return None                                      # reject
    if not payload["environmentIncluded"]:
        return None                                      # omitted
    env = payload.get("environment")
    if not isinstance(env, Mapping) or not env:          # None, [], "", {} all filtered
        return None
    return dict(env)
```

### Validate with the JSON Schema _before_ reading

The schema at
[`docs/schemas/chart-qa-failures.schema.json`](./schemas/chart-qa-failures.schema.json)
already encodes every rule in the shape matrix above — wrong types, empty
object leaks, and presence/`environmentIncluded` disagreements all fail
validation. Run the validator at ingest and reject the payload on error, so
your read code only ever sees shapes it can trust.

**Node (Ajv):**

```ts
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../docs/schemas/chart-qa-failures.schema.json";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

export function parseFailures(raw: unknown) {
  if (!validate(raw)) {
    throw new Error(
      "Invalid chart-qa-failures.json: " + ajv.errorsText(validate.errors, { separator: "; " }),
    );
  }
  // From here on, `raw.environment` is either present-and-well-formed or absent.
  return raw as import("./types").FailuresPayload;
}
```

**Python (`jsonschema`):**

```python
import json
from jsonschema import Draft202012Validator

with open("docs/schemas/chart-qa-failures.schema.json") as f:
    validator = Draft202012Validator(json.load(f))

def parse_failures(raw: dict) -> dict:
    errors = sorted(validator.iter_errors(raw), key=lambda e: e.path)
    if errors:
        details = "; ".join(f"{list(e.path)}: {e.message}" for e in errors)
        raise ValueError(f"Invalid chart-qa-failures.json: {details}")
    return raw
```

**CI one-liner (`check-jsonschema`):**

```bash
pipx run check-jsonschema \
  --schemafile docs/schemas/chart-qa-failures.schema.json \
  path/to/chart-qa-failures.json
```

### Rules of thumb

- **Validate at the boundary, trust inside.** Once the schema passes, use the
  simple `"environment" in payload` / `payload.environmentIncluded` gates —
  no need to re-check types on every read.
- **Never coerce.** Do not rewrite `environment: null` to `{}` (or vice versa)
  in storage layers — you'll launder a regression into a "valid" payload.
- **Fail loud on schema mismatch.** A payload that violates the schema is a
  bug in the exporter or a tampered upload; silent fallback masks both.
