import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache override: every TwoKey page renders per request (no ISR or static
// revalidation), so the R2 bucket from OpenNext's template isn't needed (and isn't billed).
export default defineCloudflareConfig({});
