import * as digitalOcean from "@pulumi/digitalocean";

// Map DigitalOcean droplet size strings (from config) to the DropletSlug enum.
export const SIZE_MAP: Record<string, digitalOcean.DropletSlug> = {
  "s-1vcpu-1gb": digitalOcean.DropletSlug.DropletS1VCPU1GB,
  "s-1vcpu-2gb": digitalOcean.DropletSlug.DropletS1VCPU2GB,
  "s-2vcpu-2gb": digitalOcean.DropletSlug.DropletS2VCPU2GB,
  "s-2vcpu-4gb": digitalOcean.DropletSlug.DropletS2VCPU4GB,
  "s-4vcpu-8gb": digitalOcean.DropletSlug.DropletS4VCPU8GB,
};

// Map region strings to the Region enum. Key set must stay in sync with
// RegionValues in lib/config/schema.ts (the codec that validates them).
export const REGION_MAP: Record<string, digitalOcean.Region> = {
  nyc1: digitalOcean.Region.NYC1,
  nyc2: digitalOcean.Region.NYC2,
  nyc3: digitalOcean.Region.NYC3,
  sfo1: digitalOcean.Region.SFO1,
  sfo2: digitalOcean.Region.SFO2,
  sfo3: digitalOcean.Region.SFO3,
  ams2: digitalOcean.Region.AMS2,
  ams3: digitalOcean.Region.AMS3,
  lon1: digitalOcean.Region.LON1,
  fra1: digitalOcean.Region.FRA1,
  tor1: digitalOcean.Region.TOR1,
  blr1: digitalOcean.Region.BLR1,
  sgp1: digitalOcean.Region.SGP1,
};

// Map managed-database size strings (from config) to the DatabaseSlug enum,
// mirroring SIZE_MAP for droplets. Key set must stay in sync with
// DatabaseSizeValues in lib/config/schema.ts (the codec that validates them).
export const DATABASE_SIZE_MAP: Record<string, digitalOcean.DatabaseSlug> = {
  "db-s-1vcpu-1gb": digitalOcean.DatabaseSlug.DB_1VPCU1GB,
  "db-s-1vcpu-2gb": digitalOcean.DatabaseSlug.DB_1VPCU2GB,
  "db-s-2vcpu-4gb": digitalOcean.DatabaseSlug.DB_2VPCU4GB,
  "db-s-4vcpu-8gb": digitalOcean.DatabaseSlug.DB_4VPCU8GB,
  "db-s-6vcpu-16gb": digitalOcean.DatabaseSlug.DB_6VPCU16GB,
  "db-s-8vcpu-32gb": digitalOcean.DatabaseSlug.DB_8VPCU32GB,
  "db-s-16vcpu-64gb": digitalOcean.DatabaseSlug.DB_16VPCU64GB,
};
