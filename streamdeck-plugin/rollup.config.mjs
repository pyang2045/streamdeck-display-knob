import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

/** @type {import('rollup').RollupOptions} */
export default {
  input: "src/plugin.ts",
  output: {
    file: "dev.sheepy.display-knob.sdPlugin/bin/plugin.js",
    format: "es",
    sourcemap: false,
  },
  plugins: [
    typescript(),
    nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
    commonjs(),
  ],
  external: [],
};
