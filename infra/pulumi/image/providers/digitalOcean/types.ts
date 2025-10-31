/** The fields that can describe a DigitalOcean droplet */
export type DropletField =
  | "Name"
  | "PublicIPv4"
  | "PrivateIPv4"
  | "PublicIPv6"
  | "Memory"
  | "VCPUs"
  | "Disk"
  | "Region"
  | "Image"
  | "VPCUUID"
  | "Status"
  | "Tags"
  | "Features"
  | "Volumes";
