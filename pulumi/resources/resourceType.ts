import * as pulumi from "@pulumi/pulumi";

/**
 * Builds the Pulumi ComponentResource type string, namespaced under the client's
 * project. Maestro is an agnostic orchestration tool, so the prefix must not be
 * hard-coded to "maestro": it follows the `pulumi.projectName` from maestro.yaml,
 * which lib/runPulumi.ts passes as the Automation API project name and which
 * surfaces here via `pulumi.getProject()`.
 *
 * @param suffix the resource category, e.g. "VirtualServer" or "cloudflare:Tunnel"
 */
export function resourceType(suffix: string): string {
  return `${pulumi.getProject()}:${suffix}`;
}
