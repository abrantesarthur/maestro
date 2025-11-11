import { DigitalOcean } from "./digitalOcean";
import { DropletField } from "./digitalOcean/types";

/**
 * Get the upstream server's Public IPv4 address
 *
 * @returns the IPv4 address
 */
export const getIPv4 = (): string => {
  const provider = "digital_ocean";

  /**
   * this server.ts package is provider agnostic. Should we support more VPS providers
   * in the future, configuring them should be as easy as adding a new provider implementation
   * and perhaps reading from an env var which one to pick.
   */
  switch (provider) {
    case "digital_ocean": {
      const digitalOcean = DigitalOcean.getInstance();
      const droplets = digitalOcean.getDroplets({
        headers: [DropletField.PublicIPv4, DropletField.Tags],
      });
      const dropletIps = droplets.map((d) => d[DropletField.PublicIPv4]);
      if (dropletIps.length === 0) {
        throw new Error("DigitalOcean returned zero server IPs.");
      }
      return dropletIps[0];
    }
  }
};
