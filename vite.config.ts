import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json' with { type: "json" }

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    crx({ manifest }),
    tailwindcss(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
  ],
});
