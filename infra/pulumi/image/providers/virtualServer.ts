import { DigitalOcean } from "./digitalOcean";
import { DropletField } from "./digitalOcean/types";
import { VirtualServer, VirtualServerFilter } from "./types";

/**
 * Get a list of upstream virtual servers.
 *
 * @param filter
 * @returns the server
 */
export const getVirtualServers = (
  filter?: VirtualServerFilter,
): VirtualServer[] => {
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
        headers: [DropletField.PublicIPv4],
        filter:
          filter && filter.ipv4
            ? { [DropletField.PublicIPv4]: filter.ipv4 }
            : {},
      });
      if (droplets.length === 0) {
        throw new Error("DigitalOcean returned zero virtual servers!");
      }
      return droplets.map((d) => ({ ipv4: d.PublicIPv4 }));
    }
  }
};
