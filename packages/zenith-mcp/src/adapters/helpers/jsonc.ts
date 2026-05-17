import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  applyEdits,
  format,
  modify,
  parse,
  printParseErrorCode,
  type ParseError,
} from "jsonc-parser";

function assertRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readJsonc(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};

  const text = readFileSync(path, "utf-8");
  const errors: ParseError[] = [];
  const data = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0) {
    const formatted = errors
      .map((e) => `${printParseErrorCode(e.error)}@${e.offset}`)
      .join(", ");
    throw new Error(`Invalid JSONC in ${path}: ${formatted}`);
  }

  return assertRecord(data);
}

export function writeJsonc(
  path: string,
  data: Record<string, unknown>,
): void {
  const previous = existsSync(path) ? readFileSync(path, "utf-8") : "{}\n";
  const edits = modify(previous, [], data, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  });
  const next = applyEdits(previous, edits);
  const formatted = applyEdits(
    next,
    format(next, undefined, { insertSpaces: true, tabSize: 2, eol: "\n" }),
  );
  writeFileSync(
    path,
    formatted.endsWith("\n") ? formatted : `${formatted}\n`,
    "utf-8",
  );
}
