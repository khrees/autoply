import { Command } from 'commander';
import { profileRepository } from '../../db/repositories/profile';
import { logger } from '../../utils/logger';
import {
  extractTextFromFile,
  getSupportedFormatsDescription,
} from '../../utils/document-extractor';
import { confirm } from '@inquirer/prompts';

export const importCommand = new Command('import')
  .description('Import resume or cover letter from a file')
  .argument('<type>', 'Document type: "resume" or "cover-letter"')
  .argument('<file>', `Path to file (${getSupportedFormatsDescription()})`)
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (type: string, file: string, options: { yes?: boolean }) => {
    // Validate document type
    const validTypes = ['resume', 'cover-letter'];
    if (!validTypes.includes(type)) {
      logger.error(`Invalid document type: ${type}`);
      logger.info(`Valid types: ${validTypes.join(', ')}`);
      process.exit(1);
    }

    // Check for existing profile
    const profile = profileRepository.findFirst();
    if (!profile) {
      logger.error('No profile found. Run "autoply init" first.');
      process.exit(1);
    }

    // Extract text from file
    logger.info(`Extracting text from: ${file}`);
    const result = await extractTextFromFile(file);

    if (!result.success) {
      logger.error(result.error || 'Failed to extract text');
      process.exit(1);
    }

    logger.success(
      `Extracted ${result.content ? result.content.length : 0} characters from ${result.fileType} file`
    );
    logger.newline();

    // Show preview
    const preview = result.content ? result.content.slice(0, 300) : '';
    logger.header('Preview');
    console.log(preview + (result.content && result.content.length > 300 ? '\n...' : ''));
    logger.newline();

    // Confirm update
    if (!options.yes) {
      const shouldUpdate = await confirm({
        message: `Update your ${type.replace('-', ' ')} with this content?`,
        default: true,
      });

      if (!shouldUpdate) {
        logger.info('Import cancelled.');
        return;
      }
    }

    // Update profile
    const fieldName = type === 'resume' ? 'base_resume' : 'base_cover_letter';
    const updates = { [fieldName]: result.content };

    const updated = profile.id !== undefined ? profileRepository.update(profile.id, updates) : null;
    if (!updated) {
      logger.error('Failed to update profile');
      process.exit(1);
    }

    logger.success(`${type === 'resume' ? 'Resume' : 'Cover letter'} updated successfully!`);
    logger.keyValue('Characters', result.content ? result.content.length.toString() : '0');
    logger.keyValue('Source', result.filePath || file);
  });
