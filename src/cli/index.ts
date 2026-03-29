#!/usr/bin/env bun
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { profileCommand } from './commands/profile';
import { configCommand, credentialsCommand } from './commands/config';
import { applyCommand } from './commands/apply';
import { generateCommand } from './commands/generate';
import { historyCommand } from './commands/history';
import { loginCommand } from './commands/login';
import { statusCommand } from './commands/status';
import { importCommand } from './commands/import';
import { closeDb } from '../db';
import { setVerbose } from '../utils/logger';
import { browserManager } from '../core/browser-manager';

const program = new Command();

program
  .name('autoply')
  .description('Automated job application CLI - Apply to jobs with AI-generated resumes')
  .version('1.0.0')
  .option('-v, --verbose', 'Enable verbose output for debugging');

program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.optsWithGlobals();
  if (opts.verbose) {
    setVerbose(true);
  }
});

// Register commands
program.addCommand(initCommand);
program.addCommand(profileCommand);
program.addCommand(configCommand);
program.addCommand(credentialsCommand);
program.addCommand(applyCommand);
program.addCommand(generateCommand);
program.addCommand(historyCommand);
program.addCommand(loginCommand);
program.addCommand(statusCommand);
program.addCommand(importCommand);

// Cleanup on exit
process.on('exit', () => {
  void browserManager.closeAll();
  closeDb();
});

process.on('SIGINT', async () => {
  await browserManager.closeAll();
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await browserManager.closeAll();
  closeDb();
  process.exit(0);
});

// Parse and execute
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
