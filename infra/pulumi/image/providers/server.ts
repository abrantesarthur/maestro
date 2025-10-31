import { DigitalOcean } from "./digitalOcean";

/**
 * Get the upstream server's Public IPv4 address
 *
 * @returns the IPv4 address
 */
export const getIPv4 = (): string => {
  const provider = "digital_ocean";

  /**
   * this server.ts package is provider agnostic. Should we support more VPS providers
   * in the future, supporting the should be as easy as adding a new provider implementation
   * and perhaps reading from an env var which one to pick.
   */
  switch (provider) {
    case "digital_ocean": {
      const digitalOcean = DigitalOcean.getInstance();
      const droplets = digitalOcean.getDroplets(["PublicIPv4", "Tags"]);
      const dropletIps = droplets.map((d) => d.PublicIPv4);
      if (dropletIps.length === 0) {
        throw new Error("DigitalOcean returned zero server IPs.");
      }
      return dropletIps[0];
    }
  }
};
