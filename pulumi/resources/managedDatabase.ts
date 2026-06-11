import * as pulumi from "@pulumi/pulumi";
import * as digitalOcean from "@pulumi/digitalocean";
import { resourceType } from "./resourceType";

/** The supported PostgreSQL engine versions for the managed cluster */
export enum PostgresVersion {
  V15 = "15",
  V16 = "16",
  V17 = "17",
}

/** The arguments for constructing a ManagedDatabase instance */
export interface ManagedDatabaseArgs {
  /**
   * A stable, environment-scoped name (typically the stack name). Used to build
   * the Pulumi resource name (pg-<stackName>) and to scope the trusted-sources
   * firewall. Intentionally does NOT encode size/version/region so resizing the
   * cluster never triggers a replacement of the crown jewels.
   */
  stackName: string;
  /** The PostgreSQL engine version to pin */
  version: pulumi.Input<PostgresVersion>;
  /** The managed database node size slug (e.g., db-s-1vcpu-1gb) */
  size: pulumi.Input<digitalOcean.DatabaseSlug>;
  /** The region the cluster lives in (must co-locate with the backend droplet) */
  region: pulumi.Input<digitalOcean.Region>;
  /** The number of nodes in the cluster (1 for single-node) */
  nodeCount: pulumi.Input<number>;
  /** The shared VPC the cluster joins so the private endpoint resolves for the backend */
  vpcUuid: pulumi.Input<string>;
  /** The name of the least-privilege application database (POSTGRES_DB) */
  database: pulumi.Input<string>;
  /** The name of the least-privilege application user (POSTGRES_USER) */
  user: pulumi.Input<string>;
  /**
   * The per-stack droplet tag the firewall trusts. The disposable droplet's id
   * changes on every rebuild, so we trust the stack-name tag that survives
   * replacement and scopes access to this stack's backend.
   */
  trustedDropletTag: pulumi.Input<string>;
}

export class ManagedDatabase extends pulumi.ComponentResource {
  /** The private VPC endpoint hostname the backend dials (never the public host) */
  readonly host: pulumi.Output<string>;
  /** The DO-assigned port the cluster listens on (typically 25060) */
  readonly port: pulumi.Output<number>;
  /** The least-privilege application user */
  readonly user: pulumi.Output<string>;
  /** The least-privilege application database */
  readonly database: pulumi.Output<string>;
  /** The DO-generated application user password (a Pulumi secret) */
  readonly password: pulumi.Output<string>;
  /** Cluster admin (`doadmin`) role, used only to grant the app user privileges. */
  readonly adminUser: pulumi.Output<string>;
  /** The cluster admin (`doadmin`) password (a Pulumi secret). */
  readonly adminPassword: pulumi.Output<string>;

  constructor(args: ManagedDatabaseArgs, opts?: pulumi.ComponentResourceOptions) {
    const name = ManagedDatabase.buildResourceName(args);
    super(resourceType("ManagedDatabase"), name, {}, opts);

    const { version, size, region, nodeCount, vpcUuid, trustedDropletTag } =
      args;

    // The cluster is the crown jewels: retainOnDelete lets a `pulumi destroy` of
    // the disposable backend succeed while keeping the cloud database, and protect
    // blocks accidental targeted deletes. Intentional teardown requires a
    // deliberate state delete / unprotect (documented runbook).
    const cluster = new digitalOcean.DatabaseCluster(
      name,
      {
        name,
        engine: "pg",
        version,
        size,
        region,
        nodeCount,
        privateNetworkUuid: vpcUuid,
      },
      { parent: this, retainOnDelete: true, protect: true },
    );

    // The dedicated least-privilege application database (never the default
    // `defaultdb`). retainOnDelete so it is never orphaned alongside the cluster.
    const appDatabase = new digitalOcean.DatabaseDb(
      `${name}-db`,
      {
        clusterId: cluster.id,
        name: args.database,
      },
      { parent: this, retainOnDelete: true },
    );

    // The dedicated least-privilege application user. DO generates the password
    // (a non-superuser managed user by default; never doadmin). retainOnDelete so
    // it survives a backend destroy.
    //
    // SCOPE CAVEAT: DigitalOcean Managed Postgres does NOT auto-scope a new
    // non-doadmin user to a single database — by default it can CONNECT to every
    // database in the cluster. We are non-superuser (the doadmin-avoidance half of
    // least-privilege is satisfied), but tightening privileges to only this
    // stack's `database` (REVOKE CONNECT on others, GRANT only what the app needs)
    // is a deferred follow-up (see README "Per-database GRANT tightening"). It is
    // not a release blocker for the core-first slice.
    const appUser = new digitalOcean.DatabaseUser(
      `${name}-user`,
      {
        clusterId: cluster.id,
        name: args.user,
      },
      { parent: this, retainOnDelete: true },
    );

    // Trusted-sources allowlist: only droplets carrying this stack's tag may
    // reach the cluster. No 0.0.0.0/0 rule; the public endpoint stays locked down.
    new digitalOcean.DatabaseFirewall(
      `${name}-firewall`,
      {
        clusterId: cluster.id,
        rules: [
          {
            type: "tag",
            value: trustedDropletTag,
          },
        ],
      },
      { parent: this },
    );

    this.host = cluster.privateHost;
    this.port = cluster.port;
    this.user = pulumi.output(appUser.name);
    this.database = pulumi.output(appDatabase.name);
    this.password = pulumi.secret(appUser.password);
    this.adminUser = cluster.user;
    this.adminPassword = pulumi.secret(cluster.password);

    this.registerOutputs({
      host: this.host,
      port: this.port,
      user: this.user,
      database: this.database,
      password: this.password,
      adminUser: this.adminUser,
      adminPassword: this.adminPassword,
    });
  }

  /**
   * Build the Pulumi resource name from a stable, environment-scoped string.
   *
   * IMPORTANT: this intentionally encodes ONLY the stack name and NOT the
   * size/version/region. Pulumi keys resources by this name; encoding mutable
   * sizing attributes here would cause a resize to replace (destroy + recreate)
   * the database — exactly the data-loss event we are guarding against.
   *
   * @param a - the arguments for building a ManagedDatabase
   * @returns the name of the managed database within Pulumi
   */
  private static buildResourceName = (a: ManagedDatabaseArgs): string =>
    `pg-${a.stackName}`;
}
