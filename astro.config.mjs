// @ts-check
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

const reactClient = fileURLToPath(new URL("./vendor/react-island-client.js", import.meta.url));

/** Astro's React check calls the component outside React and React 19 throws. */
function skipReactProbe() {
  return {
    name: "gpufit-skip-react-probe",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("@astrojs/react/dist/server.js")) return;
      if (!code.includes("let isReactComponent = false;")) return;
      return code.replace("let isReactComponent = false;", "return true;\n  let isReactComponent = false;");
    },
  };
}

export default defineConfig({
  site: process.env.SITE_URL || "https://gpufit.tech",
  output: "static",
  session: false,
  adapter: cloudflare({
    prerenderEnvironment: "node",
  }),
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss(), skipReactProbe()],
    resolve: {
      alias: {
        "@astrojs/react/client.js": reactClient,
      },
      dedupe: ["react", "react-dom"],
    },
  },
});
