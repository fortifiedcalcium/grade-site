import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/core.unit.test.js", "tests/theme.dom.test.jsx", "tests/signin.dom.test.jsx", "tests/schema.test.js", "tests/db.supabase.test.js"] } });
