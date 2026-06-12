import { isAbsolute, resolve } from "node:path";
import { type MaestroConfig } from "./schema";

/**
 * Resolve user-supplied relative paths in the config against the config
 * file's directory, so `dir: ./website` works no matter where maestro is
 * invoked from. Currently the only path-valued setting is
 * `ansible.web.static.dir`.
 *
 * Must run before semantic validation, which checks the path exists on disk.
 */
export function resolveConfigPaths(
  config: MaestroConfig,
  configDir: string,
): MaestroConfig {
  const dir = config.ansible?.web?.static?.dir;
  if (!dir || isAbsolute(dir)) {
    return config;
  }

  return {
    ...config,
    ansible: {
      ...config.ansible!,
      web: {
        ...config.ansible!.web!,
        static: {
          ...config.ansible!.web!.static!,
          dir: resolve(configDir, dir),
        },
      },
    },
  };
}
