import { spawnSync } from "node:child_process";
import type { DropletField } from "./types";

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

  getDroplets(headers: DropletField[] = ["Tags"]): Record<DropletField, string>[] {
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
      throw new Error(`Failed to list droplet IPs: ${(error as Error).message}`);
    }

    const droplets: Record<string, string>[] = [];

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
        droplets.push(droplet);
      });

    return droplets;
  }
}
