import esbuild from "esbuild";

// Cloud Functions only uploads this directory. Bundle the shared order
// model (which lives next to the React app) into functions/lib so deploy
// does not depend on files outside `functions/`.
await esbuild.build({
  entryPoints: ["index.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "lib/index.js",
  packages: "external",
  legalComments: "none",
});
