import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";

execFileSync("npx", ["vite", "build", "--config", "vite.dashboard.config.js"], { stdio: "inherit" });
copyFileSync("dist/index.html", "dist/goldfish-dashboard.html");
