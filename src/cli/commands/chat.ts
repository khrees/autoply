import { Command } from 'commander';
import ora from 'ora';
import { profileRepository } from '../../db/repositories/profile';
import { createAIProvider } from '../../ai/provider';
import { answerQuestionFromProfile, type ChatMessage } from '../../ai/chat';
import { logger, chalk } from '../../utils/logger';

export const chatCommand = new Command('chat').description(
  'Ask questions about your profile and get interview-ready answers'
);

chatCommand
  .argument('<question>', 'The question you want answered')
  .action(async (question: string) => {
    const profile = profileRepository.findFirst();
    if (!profile) {
      logger.error('No profile found. Run "autoply init" first.');
      process.exit(1);
    }

    const provider = createAIProvider();
    if (!(await provider.isAvailable())) {
      logger.error('AI provider is not available. Run "autoply config test" to check your setup.');
      process.exit(1);
    }

    logger.info(`Question: ${question}`);
    console.log();

    const spinner = ora({ text: 'Thinking...', color: 'cyan' }).start();
    try {
      spinner.stop();
      const answer = await answerQuestionFromProfile(provider, profile, question);
      console.log(answer);
    } catch (error) {
      spinner.fail();
      logger.error(
        `Failed to get answer: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      process.exit(1);
    }
  });

chatCommand
  .command('interactive')
  .description('Start an interactive chat session')
  .action(async () => {
    const profile = profileRepository.findFirst();
    if (!profile) {
      logger.error('No profile found. Run "autoply init" first.');
      process.exit(1);
    }

    const provider = createAIProvider();
    if (!(await provider.isAvailable())) {
      logger.error('AI provider is not available. Run "autoply config test" to check your setup.');
      process.exit(1);
    }

    console.log(chalk.cyan.bold(`\nInterview Prep Chat`));
    console.log(
      chalk.dim(`   Ask me anything about your experience, or for help with interview questions.\n`)
    );
    console.log(chalk.dim(`   Type "exit" or "quit" to end the session.\n`));

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const history: ChatMessage[] = [];

    const askQuestion = (): void => {
      rl.question(chalk.cyan('\n> '), async (question: string) => {
        if (
          !question.trim() ||
          question.toLowerCase() === 'exit' ||
          question.toLowerCase() === 'quit'
        ) {
          console.log(chalk.dim('\nGood luck with your interviews!\n'));
          rl.close();
          return;
        }

        const spinner = ora({ text: 'Thinking...', color: 'cyan' }).start();
        try {
          spinner.stop();
          const answer = await answerQuestionFromProfile(provider, profile, question, history);
          console.log(chalk.white(answer));
          // Maintain conversation context (keep last 10 exchanges to avoid huge prompts)
          history.push({ role: 'user', content: question });
          history.push({ role: 'assistant', content: answer });
          if (history.length > 20) history.splice(0, 2);
        } catch (error) {
          spinner.fail();
          logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        askQuestion();
      });
    };

    askQuestion();
  });
