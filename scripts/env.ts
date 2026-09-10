// Loads the project's environment for standalone scripts exactly the way Next.js does for the app:
// .env.local → .env.development / .env (same precedence, same parser, via @next/env). Import this
// FIRST in any script that reaches the LLM layer, so process.env is populated before lib/llm reads it.
// Never prints values – only which files were loaded.
import { loadEnvConfig } from "@next/env";
const { loadedEnvFiles } = loadEnvConfig(process.cwd(), true);
export const loadedEnvFileNames = loadedEnvFiles.map(f => f.path);
if (process.env.QIQ_ENV_QUIET !== "1") console.log(loadedEnvFileNames.length ? `env: loaded ${loadedEnvFileNames.join(", ")}` : "env: no .env.local / .env found (using the shell environment)");
