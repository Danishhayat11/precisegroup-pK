/**
 * aiToolSchemas — runtime validation for the tool schemas passed to the AI
 * gateway.
 *
 * The gateway is very unforgiving: a stray comma in a large array literal
 * leaves a `undefined` hole, and a missing `function.name` on any entry
 * fails the entire request with an opaque 400. We validate the whole list
 * at module load so those mistakes surface as loud, actionable errors long
 * before a user chat request reaches the gateway.
 *
 * Rules enforced:
 *   1. The list itself must be a real array with no `null` / `undefined`
 *      / array holes.
 *   2. Each entry must be a plain object with `type === "function"`.
 *   3. Each entry must have `function.name` as a non-empty snake_case
 *      identifier (matches the executeTool switch statement).
 *   4. Each entry must have `function.description` as a non-empty string.
 *   5. Each entry must have `function.parameters` as an object with
 *      `type: "object"` and (optionally) `properties` / `required` fields
 *      shaped correctly.
 *   6. Tool names must be unique — duplicates would silently mask each
 *      other in gateway routing.
 */

export interface ToolFunctionSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties?: Record<string, unknown>;
      required?: string[];
    };
  };
}

export class ToolSchemaValidationError extends Error {
  constructor(public issues: string[]) {
    super(
      `TOOL_SCHEMAS validation failed with ${issues.length} issue(s):\n` +
        issues.map((i) => `  • ${i}`).join("\n"),
    );
    this.name = "ToolSchemaValidationError";
  }
}

const NAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Validate a list of tool schemas. Returns the same list (narrowed) on
 * success. Throws {@link ToolSchemaValidationError} with every issue found
 * on failure — we surface all problems at once so the fix isn't a
 * whack-a-mole loop.
 */
export function validateToolSchemas(list: unknown): ToolFunctionSchema[] {
  const issues: string[] = [];

  if (!Array.isArray(list)) {
    throw new ToolSchemaValidationError([
      `Expected an array of tool schemas, received ${typeof list}`,
    ]);
  }

  // `Array.prototype.forEach` skips holes, so use a plain for-loop to
  // catch stray-comma holes (`[a, , b]`) that would otherwise be invisible.
  const names = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const at = `entry[${i}]`;

    if (entry === undefined || entry === null) {
      issues.push(`${at}: is ${entry === null ? "null" : "undefined / array hole (stray comma?)"}`);
      continue;
    }
    if (typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(
        `${at}: must be a plain object, got ${Array.isArray(entry) ? "array" : typeof entry}`,
      );
      continue;
    }

    const e = entry as Record<string, unknown>;
    if (e.type !== "function") {
      issues.push(`${at}.type: must be the literal "function", got ${JSON.stringify(e.type)}`);
    }

    const fn = e.function as Record<string, unknown> | undefined;
    if (!fn || typeof fn !== "object" || Array.isArray(fn)) {
      issues.push(`${at}.function: must be a plain object`);
      continue;
    }

    const name = fn.name;
    if (typeof name !== "string" || name.trim() === "") {
      issues.push(`${at}.function.name: must be a non-empty string`);
    } else if (!NAME_RE.test(name)) {
      issues.push(`${at}.function.name: "${name}" must be snake_case matching ${NAME_RE.source}`);
    } else if (names.has(name)) {
      issues.push(`${at}.function.name: duplicate tool name "${name}"`);
    } else {
      names.add(name);
    }

    if (typeof fn.description !== "string" || fn.description.trim() === "") {
      issues.push(
        `${at}.function.description: must be a non-empty string (tool "${String(name ?? "?")}")`,
      );
    }

    const params = fn.parameters as Record<string, unknown> | undefined;
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      issues.push(`${at}.function.parameters: must be a plain object`);
    } else {
      if (params.type !== "object") {
        issues.push(
          `${at}.function.parameters.type: must be "object", got ${JSON.stringify(params.type)}`,
        );
      }
      if (params.properties !== undefined) {
        if (
          typeof params.properties !== "object" ||
          params.properties === null ||
          Array.isArray(params.properties)
        ) {
          issues.push(`${at}.function.parameters.properties: must be a plain object when present`);
        }
      }
      if (params.required !== undefined) {
        if (
          !Array.isArray(params.required) ||
          params.required.some((k) => typeof k !== "string" || k === "")
        ) {
          issues.push(`${at}.function.parameters.required: must be a string[] of non-empty keys`);
        } else {
          const props = params.properties as Record<string, unknown> | undefined;
          if (props) {
            for (const key of params.required as string[]) {
              if (!(key in props)) {
                issues.push(
                  `${at}.function.parameters.required: "${key}" is not declared in properties`,
                );
              }
            }
          }
        }
      }
    }
  }

  if (issues.length > 0) throw new ToolSchemaValidationError(issues);
  return list as ToolFunctionSchema[];
}

/**
 * Convenience wrapper for module-load use: validates and returns the list,
 * so callers can write `export const TOOL_SCHEMAS = assertToolSchemas([...])`.
 */
export function assertToolSchemas(list: unknown): ToolFunctionSchema[] {
  return validateToolSchemas(list);
}
