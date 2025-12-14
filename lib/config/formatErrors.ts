import type { Errors } from "io-ts";

export function formatErrors(errors: Errors): string {
  if (errors.length === 0) {
    return "Unknown validation error";
  }

  const messages = errors.map((error) => {
    const path = error.context
      .map((c) => c.key)
      .filter((key) => key !== "")
      .join(".");

    const lastContext = error.context[error.context.length - 1];
    const expectedType = lastContext?.type.name ?? "unknown";
    const actualValue = error.value;

    const location = path || "(root)";
    const valueStr =
      actualValue === undefined
        ? "undefined"
        : JSON.stringify(actualValue, null, 0);

    return `${location}: expected ${expectedType}, got ${valueStr}`;
  });

  return messages.join("\n");
}
