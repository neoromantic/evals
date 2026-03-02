#!/usr/bin/env node
const { execFileSync } = require("child_process");
const { resolve } = require("path");
execFileSync("bun", [resolve(__dirname, "../src/run.ts"), ...process.argv.slice(2)], { stdio: "inherit" });
