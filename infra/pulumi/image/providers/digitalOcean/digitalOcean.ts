import { spawnSync } from "node:child_process";
import { DropletField, DropletFilter } from "./types";

export class DigitalOcean {
  private static instance: DigitalOcean | null = null;
  private readonly apiKey: string;

  /**
   * callers can only obtain the DigitalOcean instance through getInstance
   * preventing new DigitalOcean() and conforming to a singleton design
   */
  private constructor() {
    const key = process.env.DIGITAL_OCEAN_API_KEY;
    if (!key) {
      throw new Error("Missing DIGITAL_OCEAN_API_KEY environment variable.");
    }
    this.apiKey = key;
  }

  static getInstance(): DigitalOcean {
    if (!DigitalOcean.instance) {
      DigitalOcean.instance = new DigitalOcean();
    }
    return DigitalOcean.instance;
  }

  private run(args: string[]): string {
    const result = spawnSync("doctl", args, {
      env: {
        ...process.env,
        DIGITALOCEAN_ACCESS_TOKEN: this.apiKey,
      },
      encoding: "utf8",
    });

    if (result.error) {
      throw new Error(`Failed to execute doctl: ${result.error.message}`);
    }

    if (result.status !== 0) {
      const stderrOutput = (result.stderr ?? "").toString().trim();
      throw new Error(
        `doctl command failed (args: ${args.join(" ")}): ${stderrOutput || `exit code ${result.status}`}`,
      );
    }

    return result.stdout ?? "";
  }

  /**
   * Fetches droplets using doctl and returns the requested fields keyed by header.
   * @param options - the options
   * @param options.headers - Droplet fields to fetch from DigitalOcean.
   * @param options.filter - Key/value pairs that every droplet must satisfy.
   * @returns List of droplets keyed by the requested headers.
   */
  getDroplets({
    headers = [DropletField.Tags, DropletField.VPCUUID],
    filter,
  }: {
    headers?: DropletField[];
    filter?: DropletFilter;
  } = {}): Record<DropletField, string>[] {
    // in order to filter a droplet by some field, this field must have been fetched!
    if (filter) {
      const keys = Object.keys(filter) as DropletField[];
      const diff = keys.filter((k) => !headers.includes(k));
      if (diff.length > 0) {
        throw new Error(
          `Invalid 'filter' argument: all fields must be included in the 'headers' argument. Missing: ${diff.join(", ")}.`,
        );
      }
    }

    let dropletOutput: string;
    try {
      dropletOutput = this.run([
        "compute",
        "droplet",
        "list",
        "--format",
        headers.join(","),
        "--no-header",
      ]);
    } catch (error) {
      throw new Error(
        `Failed to list droplet IPs: ${(error as Error).message}`,
      );
    }

    const droplets: Record<DropletField, string>[] = [];
    const filterEntries = filter
      ? (Object.entries(filter) as [DropletField, string[]][])
      : null;

    dropletOutput
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .forEach((line) => {
        // split the line by whitespace characters and trim the values
        const values = line.split(/\s{2,}/);
        const droplet: Record<string, string> = {};
        headers.forEach((header, index) => {
          droplet[header] = values[index] ?? "";
        });
        // exlude from result the droplets that disrespect some filter
        if (
          filterEntries &&
          filterEntries.some(([field, expected]) =>
            expected.every((e) => droplet[field] !== e),
          )
        ) {
          return;
        }
        droplets.push(droplet);
      });

    return droplets;
  }
}
