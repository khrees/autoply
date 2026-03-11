import { Command } from 'commander';
import { configRepository } from '../../db/repositories/config';
import { logger, chalk } from '../../utils/logger';
import { getAvailableProviders, testProvider, createAIProvider } from '../../ai/provider';

export const configCommand = new Command('config')
  .description('Manage configuration');

configCommand
  .command('set <key> <value>')
  .description('Set a configuration value (e.g., ai.provider ollama)')
  .action((key: string, value: string) => {
    try {
      configRepository.setConfigValue(key, value);
      logger.success(`Set ${key} = ${value}`);
    } catch (error) {
      logger.error(`Failed to set config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

configCommand
  .command('get <key>')
  .description('Get a configuration value')
  .action((key: string) => {
    const value = configRepository.getConfigValue(key);
    if (value === undefined) {
      logger.error(`Config key "${key}" not found`);
    } else {
      console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : value);
    }
  });

configCommand
  .command('list')
  .description('List all configuration')
  .action(() => {
    const config = configRepository.loadAppConfig();

    logger.header('Configuration');

    console.log(chalk.bold('AI Settings:'));
    logger.keyValue('  Provider', config.ai.provider);
    logger.keyValue('  Model', config.ai.model);
    if (config.ai.baseUrl) logger.keyValue('  Base URL', config.ai.baseUrl);
    logger.keyValue('  Temperature', config.ai.temperature?.toString() ?? '0.7');

    logger.newline();
    console.log(chalk.bold('Browser Settings:'));
    logger.keyValue('  Headless', config.browser.headless ? 'Yes' : 'No');
    logger.keyValue('  Timeout', `${config.browser.timeout}ms`);

    logger.newline();
    console.log(chalk.bold('Application Settings:'));
    logger.keyValue('  Auto Submit', config.application.autoSubmit ? 'Yes' : 'No');
    logger.keyValue('  Save Screenshots', config.application.saveScreenshots ? 'Yes' : 'No');
    logger.keyValue('  Retry Attempts', config.application.retryAttempts.toString());
  });

configCommand
  .command('reset')
  .description('Reset configuration to defaults')
  .action(async () => {
    const { confirm } = await import('@inquirer/prompts');
    const confirmed = await confirm({
      message: 'Reset all configuration to defaults?',
      default: false,
    });

    if (confirmed) {
      const { DEFAULT_CONFIG } = await import('../../types');
      configRepository.saveAppConfig(DEFAULT_CONFIG);
      logger.success('Configuration reset to defaults');
    }
  });

configCommand
  .command('providers')
  .description('List available AI providers')
  .action(() => {
    getAvailableProviders();

    logger.header('Available AI Providers');

    console.log(`${chalk.cyan('ollama')} - Local LLM via Ollama`);
    console.log('  Default URL: http://localhost:11434');
    console.log('  Config: OLLAMA_BASE_URL (optional)');
    logger.newline();

    console.log(`${chalk.cyan('lmstudio')} - Local LLM via LM Studio`);
    console.log('  Default URL: http://localhost:1234');
    console.log('  Config: LMSTUDIO_BASE_URL (optional)');
    logger.newline();

    console.log(`${chalk.cyan('openai')} - OpenAI API`);
    console.log('  Config: OPENAI_API_KEY (required)');
    logger.newline();

    console.log(`${chalk.cyan('anthropic')} - Anthropic API`);
    console.log('  Config: ANTHROPIC_API_KEY (required)');
    logger.newline();

    logger.info('Set provider with: autoply config set ai.provider <provider>');
  });

configCommand
  .command('test')
  .description('Test the current AI provider configuration')
  .action(async () => {
    const config = configRepository.loadAppConfig();
    logger.info(`Testing ${config.ai.provider} provider...`);

    try {
      const provider = createAIProvider();
      const result = await testProvider(provider);

      if (result.success) {
        logger.success('AI provider is working correctly!');
      } else {
        logger.error(`AI provider test failed: ${result.error}`);
      }
    } catch (error) {
      logger.error(`Failed to test provider: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
