#!/usr/bin/env node
import { Command } from "commander";
import { createBuildCommand } from "./build.js";
import { createListCommand } from "./list.js";
import { createValidateCommand } from "./validate.js";
import { getVersion } from "./version.js";

const program = new Command();
program
  .name("promptweave")
  .description("YAML composer for assembling agent prompts, hooks, and MCP configs from reusable behaviors")
  .version(getVersion());

program.addCommand(createBuildCommand());
program.addCommand(createListCommand());
program.addCommand(createValidateCommand());

program.parse();
