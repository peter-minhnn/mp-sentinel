import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fusionVariant } from "./fusion-ablation.mjs";
import { withFusionTrace } from "./fusion-trace.mjs";
import { anchorExperiment, ANCHOR_EXPERIMENTS } from "./anchor-experiment.mjs";

export async function compileFusion({ variant, source, sourcePath, directory }) {
  const outfile = join(directory, `${variant}.mjs`);
  await build({
    entryPoints: [sourcePath],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
    plugins: [
      {
        name: "frozen-fusion-variant",
        setup(builder) {
          builder.onLoad({ filter: /task-context\.ts$/ }, (args) => {
            if (args.path !== sourcePath) return undefined;
            return {
              contents: ANCHOR_EXPERIMENTS.includes(variant)
                ? anchorExperiment(withFusionTrace(source), variant)
                : withFusionTrace(fusionVariant(source, variant)),
              loader: "ts",
              resolveDir: resolve(sourcePath, ".."),
            };
          });
        },
      },
    ],
  });
  return {
    module: await import(pathToFileURL(outfile).href),
    sha256: createHash("sha256").update(readFileSync(outfile)).digest("hex"),
  };
}
