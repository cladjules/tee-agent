/**
 * Default oracle entry point — starts the TEE oracle with no custom handlers.
 * Custom handler examples live in src/examples/.
 */
import { startOracle } from "./server.js";

await startOracle({ handlers: {} });
