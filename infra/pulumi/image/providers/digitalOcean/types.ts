/** The fields that can describe a DigitalOcean droplet */
export enum DropletField {
  ID = "ID",
  Name = "Name",
  PublicIPv4 = "PublicIPv4",
  PrivateIPv4 = "PrivateIPv4",
  PublicIPv6 = "PublicIPv6",
  Memory = "Memory",
  VCPUs = "VCPUs",
  Disk = "Disk",
  Region = "Region",
  Image = "Image",
  VPCUUID = "VPCUUID",
  Status = "Status",
  Tags = "Tags",
  Features = "Features",
  Volumes = "Volumes",
}

/** The filters for a DigitalOcean droplet */
export type DropletFilter = Partial<Record<DropletField, string[]>>;
