import { describe, expect, test } from 'bun:test';
import { shouldSkipLeverCustomQuestion } from './lever';

describe('shouldSkipLeverCustomQuestion', () => {
  test('skips standard contact and resume fields', () => {
    expect(shouldSkipLeverCustomQuestion('Full name', 'name')).toBe(true);
    expect(shouldSkipLeverCustomQuestion('Email', 'email')).toBe(true);
    expect(shouldSkipLeverCustomQuestion('Phone', 'phone')).toBe(true);
    expect(shouldSkipLeverCustomQuestion('Current location', 'location')).toBe(true);
    expect(shouldSkipLeverCustomQuestion('Resume/CV', 'resume')).toBe(true);
  });

  test('skips branded URL fields by input name', () => {
    expect(shouldSkipLeverCustomQuestion('Avive Solutions', 'urls[Other]')).toBe(true);
    expect(shouldSkipLeverCustomQuestion('LinkedIn URL', 'urls[LinkedIn]')).toBe(true);
  });

  test('keeps actual application questions', () => {
    expect(shouldSkipLeverCustomQuestion('Are you based in the US or Canada?', 'surveysResponses[field0]')).toBe(
      false
    );
    expect(
      shouldSkipLeverCustomQuestion(
        'In a few words, what makes you the ideal candidate for this position?',
        'cards[field0]'
      )
    ).toBe(false);
  });
});
