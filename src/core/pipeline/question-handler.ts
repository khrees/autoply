import type { Profile, JobData } from '../../types';
import type { AIProvider } from '../../ai/provider';
import { answerAllQuestions } from '../../ai/cover-letter';
import { applicationRepository } from '../../db/repositories/application';
import { savedAnswersRepository } from '../../db/repositories/saved-answers';
import { requiresHumanAnswer, shouldAllowAIAnswer } from '../form-filler';
import { createSpinner } from '../../utils/logger';

/**
 * Pipeline step 4: Answer custom questions using cache, AI, and saved answers.
 */
export async function handleCustomQuestions(
  jobData: JobData,
  profile: Profile,
  provider: AIProvider,
  config: { application: { fillOptionalFields?: boolean; [key: string]: unknown } },
  spinner: ReturnType<typeof createSpinner>
): Promise<void> {
  if (jobData.custom_questions.length === 0) return;

  const totalQuestions = jobData.custom_questions.length;
  spinner.start(`Answering custom questions (0/${totalQuestions})...`);

  try {
    const aiAnswerableQuestions = jobData.custom_questions.filter(
      (question) =>
        !question.answer &&
        (question.required || config.application.fillOptionalFields) &&
        !requiresHumanAnswer(question.question) &&
        shouldAllowAIAnswer({
          label: question.question,
          name: question.id,
          type: question.type,
          options: question.options,
        })
    );

    // Check saved answers first — reuse past answers for similar questions
    let fromCache = 0;
    const stillNeedingAI: typeof aiAnswerableQuestions = [];
    for (const q of aiAnswerableQuestions) {
      const savedMatches = savedAnswersRepository.findSimilar(profile.id || 0, q.question, 1);
      if (savedMatches.length > 0) {
        q.answer = savedMatches[0].answer;
        fromCache++;
        spinner.start(
          `Answering custom questions (${fromCache}/${totalQuestions} from cache)...`
        );
      } else {
        stillNeedingAI.push(q);
      }
    }

    // Replace the list so only unanswered questions go to AI
    aiAnswerableQuestions.splice(0, aiAnswerableQuestions.length, ...stillNeedingAI);

    // Get previous answers from DB for few-shot learning
    const previousApps = applicationRepository.findAll({
      profile_id: profile.id,
      status: 'submitted',
    });
    const previousAnswers: Array<{ question: string; answer: string }> = [];
    for (const app of previousApps.slice(0, 5)) {
      const questions = app.form_data?.questions as
        | Array<{ question: string; answer?: string }>
        | undefined;
      if (questions) {
        for (const q of questions) {
          if (q.answer && previousAnswers.length < 10) {
            previousAnswers.push({ question: q.question, answer: q.answer });
          }
        }
      }
    }

    if (aiAnswerableQuestions.length > 0) {
      spinner.start(
        `Answering custom questions (${fromCache} cached, asking AI for ${aiAnswerableQuestions.length})...`
      );
      const answers = await answerAllQuestions(
        provider,
        profile,
        jobData,
        aiAnswerableQuestions,
        previousAnswers
      );
      for (const q of aiAnswerableQuestions) {
        if (!q.answer) {
          q.answer = answers.get(q.question);
        }
      }
      // Persist answers for future reuse
      for (const q of aiAnswerableQuestions) {
        if (q.answer) {
          savedAnswersRepository.upsert(profile.id || 0, q.question, q.answer);
        }
      }
    }

    const answeredCount = jobData.custom_questions.filter((q) => q.answer).length;
    const skippedCount = totalQuestions - answeredCount;
    spinner.succeed(
      skippedCount > 0
        ? `Custom questions answered (${answeredCount}/${totalQuestions}, ${skippedCount} skipped)`
        : `Custom questions answered (${answeredCount}/${totalQuestions})`
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    spinner.warn(`Some questions could not be auto-answered: ${msg}`);
  }
}
