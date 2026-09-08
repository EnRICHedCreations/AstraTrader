import { config, liveConfiguration } from "./config.mjs";
const c = config();
const checks = [
  ["Node >=24", Number(process.versions.node.split(".")[0]) >= 24],
  ["Operator token configured", c.apiToken.length >= 32],
  ["Jupiter quote API configured", !!c.jupiterKey],
];
console.log(
  JSON.stringify(
    {
      mode: c.mode,
      operationalChecks: checks,
      liveChecks: liveConfiguration(c),
      note: "This configuration check does not place trades or establish production readiness",
    },
    null,
    2,
  ),
);
if (checks.some((x) => !x[1])) process.exitCode = 1;
