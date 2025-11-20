import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { getZoneId } from "../providers";

/** Arguments for constructing a ZoneSettings component */
export interface ZoneSettingsArgs {
  /** The DNS domain */
  domain: pulumi.Input<string>;
  /** SSL mode for the zone. Defaults to "strict". */
  ssl?: pulumi.Input<"off" | "flexible" | "full" | "strict">;
}

export class ZoneSettings extends pulumi.ComponentResource {
  readonly value: pulumi.Output<string>;

  constructor(args: ZoneSettingsArgs, opts?: pulumi.ComponentResourceOptions) {
    const name = ZoneSettings.buildResourceName(args);
    super("dalhe:cloudflare:ZoneSettings", name, {}, opts);

    const defaults: Required<Pick<ZoneSettingsArgs, "ssl">> = {
      ssl: "strict",
    };
    const { domain, ssl } = { ...defaults, ...args };

    const zoneSetting = new cloudflare.ZoneSetting(
      `${name}-ssl`,
      {
        zoneId: getZoneId(domain),
        settingId: "ssl",
        value: ssl,
      },
      { parent: this },
    );

    this.value = zoneSetting.value as pulumi.Output<string>;
    this.registerOutputs({
      value: this.value
    })
  }

  private static buildResourceName = (a: ZoneSettingsArgs): string =>
    `zone-settings-${a.domain}`;
}
