import { Command } from 'commander';
import { applicationOrchestrator } from '../../core/application';
import { parseJobUrl, getSupportedPlatforms } from '../../utils/url-parser';
import { profileRepository } from '../../db/repositories/profile';
import { logger } from '../../utils/logger';
import { copyFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, resolve } from 'path';

export const generateCommand = new Command('generate')
  .description('Generate documents without applying');

generateCommand
  .command('resume <url>')
  .description('Generate a tailored resume for a job posting')
  .option('-o, --output <path>', 'Output file path', './resume.pdf')
  .action(async (url: string, options: { output: string }) => {
    await generateDocument(url, options.output, 'resume');
  });

generateCommand
  .command('cover-letter <url>')
  .description('Generate a cover letter for a job posting')
  .option('-o, --output <path>', 'Output file path', './cover_letter.pdf')
  .action(async (url: string, options: { output: string }) => {
    await generateDocument(url, options.output, 'cover-letter');
  });

generateCommand
  .command('both <url>')
  .description('Generate both resume and cover letter')
  .option('-d, --output-dir <path>', 'Output directory', '.')
  .action(async (url: string, options: { outputDir: string }) => {
    const profile = profileRepository.findFirst();
    if (!profile) {
      logger.error('No profile found. Run "autoply init" first.');
      process.exit(1);
    }

    const parsed = parseJobUrl(url);
    if (!parsed.isValid) {
      logger.error(parsed.error || 'Invalid URL');
      logger.info('Supported platforms: ' + getSupportedPlatforms().join(', '));
      process.exit(1);
    }

    const outputDir = resolve(options.outputDir);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    try {
      const result = await applicationOrchestrator.generateDocuments(url, outputDir, 'both');

      logger.newline();
      logger.success('Documents generated successfully!');
      if (result.resumePath) {
        logger.keyValue('Resume', result.resumePath);
      }
      if (result.coverLetterPath) {
        logger.keyValue('Cover Letter', result.coverLetterPath);
      }
    } catch (error) {
      logger.error(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

async function generateDocument(
  url: string,
  outputPath: string,
  type: 'resume' | 'cover-letter'
): Promise<void> {
  const profile = profileRepository.findFirst();
  if (!profile) {
    logger.error('No profile found. Run "autoply init" first.');
    process.exit(1);
  }

  const parsed = parseJobUrl(url);
  if (!parsed.isValid) {
    logger.error(parsed.error || 'Invalid URL');
    logger.info('Supported platforms: ' + getSupportedPlatforms().join(', '));
    process.exit(1);
  }

  const resolvedPath = resolve(outputPath);
  const outputDir = dirname(resolvedPath);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    const result = await applicationOrchestrator.generateDocuments(url, outputDir, type);

    logger.newline();
    logger.success('Document generated successfully!');

    const generatedPath = type === 'resume' ? result.resumePath : result.coverLetterPath;
    if (generatedPath && generatedPath !== resolvedPath) {
      copyFileSync(generatedPath, resolvedPath);
      unlinkSync(generatedPath);
    }

    if (generatedPath) {
      logger.keyValue('Output', resolvedPath);
    }
  } catch (error) {
    logger.error(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}
