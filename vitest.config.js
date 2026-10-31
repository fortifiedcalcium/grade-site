import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/core.unit.test.js", "tests/rules-sim.test.js"] } });
