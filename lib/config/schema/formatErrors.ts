import type { ErrorObject } from "ajv";

/**
 * Format AJV validation errors into a readable message
 */
export function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "Unknown validation error";
  }

  const messages = errors.map((err) => {
    const path = err.instancePath || "(root)";
    const keyword = err.keyword;
    const params = err.params as Record<string, unknown>;

    switch (keyword) {
      case "required":
        return `${path}: missing required property '${params["missingProperty"]}'`;
      case "enum":
        return `${path}: must be one of ${JSON.stringify(
          params["allowedValues"],
        )}`;
      case "type":
        return `${path}: must be ${params["type"]}`;
      case "additionalProperties":
        return `${path}: unknown property '${params["additionalProperty"]}'`;
      case "minItems":
        return `${path}: must have at least ${params["limit"]} item(s)`;
      case "propertyNames":
        return `${path}: invalid property name '${params["propertyName"]}'.`;
      default:
        return `${path}: ${err.message}`;
    }
  });

  return messages.join("\n");
}
