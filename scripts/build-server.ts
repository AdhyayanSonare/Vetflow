import { build, type BuildOptions } from "esbuild";

/**
 * The server bundles that production runs. Names are flattened on purpose: the Dockerfile, the
 * Compose file and `pnpm start` all expect dist/index.js, dist/worker.js, dist/db-migrate.js,
 * dist/tenant-create.js and dist/user-set-password.js (without [name] esbuild would mirror the source folders instead).
 * tests/unit/bundle.test.ts builds with these same options and boots the result.
 */
export const SERVER_ENTRIES = ["server/index.ts", "server/jobs/worker.ts", "scripts/db-migrate.ts", "scripts/tenant-create.ts", "scripts/user-set-password.ts"];

export function serverBuildOptions(outdir: string): BuildOptions {
  return {
    entryPoints: SERVER_ENTRIES,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outdir,
    entryNames: "[name]",
    logLevel: "info",
  };
}

if (process.argv[1] && /build-server\.(ts|js)$/.test(process.argv[1])) {
  await build(serverBuildOptions("dist"));
}
