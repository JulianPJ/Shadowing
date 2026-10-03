import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { responseStoreServiceBinding } from "./cloudflare.config";
import { responseStoreAdapter } from "@vinext/cloudflare/cache/response-store-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import path from "node:path";

export default defineConfig({
  plugins: [
    vinext({
      cache: responseStoreAdapter(),
      images: { optimizer: imagesOptimizer() },
    }),
    cloudflare({
      auxiliaryWorkers: [{ config: responseStoreServiceBinding }],
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  resolve: {
    alias: {
      "sharp": path.resolve(__dirname, "empty-stub.js"),
    },
  },
});
