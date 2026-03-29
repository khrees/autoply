import type { Experience } from '../types';

/**
 * Calculates total years of experience from an array of experience entries.
 * Handles "present" as end date and invalid date formats.
 */
export function calculateYearsExperience(experience: Experience[]): number {
  if (!experience || experience.length === 0) return 0;

  let totalMonths = 0;
  const now = new Date();

  for (const exp of experience) {
    if (!exp.start_date) continue;

    const start = new Date(exp.start_date);
    const end =
      exp.end_date && exp.end_date.toLowerCase() !== 'present' ? new Date(exp.end_date) : now;

    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;

    const months = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30);
    totalMonths += Math.max(0, months);
  }

  return Math.round(totalMonths / 12);
}

/**
 * Calculates years of experience and returns as a string.
 */
export function calculateYearsExperienceString(experience: Experience[]): string {
  return calculateYearsExperience(experience).toString();
}
