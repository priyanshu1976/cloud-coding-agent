// Used by the prisma CLI (`pnpm --filter @agent/db db:push`). It reads DATABASE_URL from the repo's .env.
import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile("../../.env");
} catch {} // no .env file: DATABASE_URL must already be in the environment

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL },
});
