/** The VirtualServer interface */
export interface VirtualServer {
  /** The server's Public IPv4 address */
  ipv4: string;
}

/** Filters for a VirtualServer */
export type VirtualServerFilter = {
  /** The server's public IPv4 address */
  ipv4?: string[];
};
