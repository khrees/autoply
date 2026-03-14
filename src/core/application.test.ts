import { describe, expect, test } from 'bun:test';
import { summarizeSubmissionFailure } from './application';

describe('summarizeSubmissionFailure', () => {
  test('preserves the scraper failure message as the primary source of truth', () => {
    const summary = summarizeSubmissionFailure(
      {
        success: false,
        message: 'Form validation failed',
        errors: ['Required field "Current location" is empty'],
      },
      {
        submitted: true,
        confidence: 'high',
        reason: 'A thank you page may be visible',
      }
    );

    expect(summary).toContain('Form validation failed');
    expect(summary).toContain('Required field "Current location" is empty');
    expect(summary).toContain('Screenshot check: A thank you page may be visible');
  });

  test('handles missing screenshot diagnostics', () => {
    const summary = summarizeSubmissionFailure({
      success: false,
      message: 'Could not confirm submission status',
      errors: [],
    });

    expect(summary).toBe('Could not confirm submission status');
  });
});
