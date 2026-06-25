import type { Profile, JobData } from '../../types';
import type { AIProvider } from '../../ai/provider';
import type { JobFitResult } from '../../ai/job-matcher';
import { evaluateJobFit } from '../../ai/job-matcher';
import { logger } from '../../utils/logger';

export interface FitResult {
  fitResult?: JobFitResult;
  /** true when the score was below threshold and processing should stop */
  belowThreshold?: boolean;
}

/**
 * Pipeline step 2: Evaluate how well the profile fits the job.
 * Returns `belowThreshold: true` when the fit is too low to proceed.
 */
export async function evaluateFitForJob(
  provider: AIProvider,
  profile: Profile,
  jobData: JobData,
  minFitScore?: number
): Promise<FitResult> {
  try {
    if (!(await provider.isAvailable())) {
      return {}; // fit evaluation is optional
    }

    const fitResult = await evaluateJobFit(provider, profile, jobData);

    logger.info(`Fit score: ${fitResult.score}% (${fitResult.recommendation})`);

    if (fitResult.strongMatches.length > 0) {
      logger.info(`  Strong: ${fitResult.strongMatches.slice(0, 3).join(', ')}`);
    }
    if (fitResult.missingSkills.length > 0) {
      logger.info(`  Gaps: ${fitResult.missingSkills.slice(0, 3).join(', ')}`);
    }

    // Check minimum fit score threshold
    if (minFitScore && fitResult.score < minFitScore) {
      logger.warning(
        `Skipping: fit score ${fitResult.score}% below threshold ${minFitScore}%`
      );
      return { fitResult, belowThreshold: true };
    }

    return { fitResult };
  } catch {
    // Fit evaluation is optional — continue without it
    return {};
  }
}
