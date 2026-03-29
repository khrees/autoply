import { describe, expect, test } from 'bun:test';
import { BaseScraper } from './base';
import type { JobData, Platform } from '../types';

// Create a concrete implementation for testing the base class methods
class TestScraper extends BaseScraper {
  platform: Platform = 'greenhouse';

  protected async waitForContent(): Promise<void> {
    // No-op for testing
  }

  protected async extractJobData(url: string): Promise<JobData> {
    return {
      url,
      platform: this.platform,
      title: 'Test Job',
      company: 'Test Company',
      description: '',
      requirements: [],
      qualifications: [],
      form_fields: [],
      custom_questions: [],
    };
  }

  // Expose protected methods for testing
  public testExtractRequirements(description: string): string[] {
    return this.extractRequirements(description);
  }

  public testExtractQualifications(description: string): string[] {
    return this.extractQualifications(description);
  }
}

describe('BaseScraper', () => {
  describe('extractRequirements', () => {
    const scraper = new TestScraper();

    test('extracts requirements section with bullet points', () => {
      const description = `
About the Role
We are looking for a software engineer.

Requirements:
- 3+ years of experience with TypeScript
- Experience with React or Vue
- Strong problem-solving skills

Nice to have:
- Experience with GraphQL
      `;

      const requirements = scraper.testExtractRequirements(description);

      expect(requirements).toContain('3+ years of experience with TypeScript');
      expect(requirements).toContain('Experience with React or Vue');
      expect(requirements).toContain('Strong problem-solving skills');
      expect(requirements).not.toContain('Experience with GraphQL');
    });

    test('extracts requirements with "must have" header', () => {
      const description = `
Job Description

Must have:
- Bachelor's degree in CS
- 5+ years of experience
- Leadership skills

What we offer:
- Competitive salary
      `;

      const requirements = scraper.testExtractRequirements(description);

      expect(requirements).toContain("Bachelor's degree in CS");
      expect(requirements).toContain('5+ years of experience');
      expect(requirements).toContain('Leadership skills');
      expect(requirements).not.toContain('Competitive salary');
    });

    test('extracts requirements with "you will need" header', () => {
      const description = `
About You

You will need:
- Strong communication skills
- Ability to work independently

What we offer:
- Health insurance
      `;

      const requirements = scraper.testExtractRequirements(description);

      expect(requirements).toContain('Strong communication skills');
      expect(requirements).toContain('Ability to work independently');
      expect(requirements).not.toContain('Health insurance');
    });

    test('handles bullet point variations (-, •, *)', () => {
      const description = `
Requirements:
- Dash bullet point
• Circle bullet point
* Star bullet point

Preferred:
- Nice to have item
      `;

      const requirements = scraper.testExtractRequirements(description);

      expect(requirements).toContain('Dash bullet point');
      expect(requirements).toContain('Circle bullet point');
      expect(requirements).toContain('Star bullet point');
      expect(requirements).not.toContain('Nice to have item');
    });

    test('stops at "preferred" section', () => {
      const description = `
Requirements:
- Required skill 1
- Required skill 2

Preferred qualifications:
- Preferred skill 1
      `;

      const requirements = scraper.testExtractRequirements(description);

      expect(requirements).toContain('Required skill 1');
      expect(requirements).toContain('Required skill 2');
      expect(requirements).not.toContain('Preferred skill 1');
    });

    test('stops at "bonus" section', () => {
      const description = `
Requirements:
- TypeScript experience
- React knowledge

Bonus points:
- Extra skill
      `;

      const requirements = scraper.testExtractRequirements(description);

      expect(requirements).toContain('TypeScript experience');
      expect(requirements).toContain('React knowledge');
      expect(requirements).not.toContain('Extra skill');
    });

    test('returns empty array when no requirements section', () => {
      const description = `
About the Company
We are a great company.

About the Role
This is an exciting opportunity.
      `;

      const requirements = scraper.testExtractRequirements(description);

      expect(requirements).toHaveLength(0);
    });

    test('returns empty array for empty description', () => {
      const requirements = scraper.testExtractRequirements('');

      expect(requirements).toHaveLength(0);
    });

    test('ignores non-bullet lines in requirements section', () => {
      const description = `
Requirements:
We are looking for:
- TypeScript proficiency

Nice to have:
- Optional skill
      `;

      const requirements = scraper.testExtractRequirements(description);

      expect(requirements).toContain('TypeScript proficiency');
      expect(requirements).not.toContain('We are looking for:');
      expect(requirements).not.toContain('Optional skill');
    });

    test('extracts bullet items containing header keywords', () => {
      const description = `
Requirements:
- You must have 3+ years experience
- Must have TypeScript skills
- Should have 5+ years

What we offer:
- Competitive salary
      `;

      const requirements = scraper.testExtractRequirements(description);

      expect(requirements).toContain('You must have 3+ years experience');
      expect(requirements).toContain('Must have TypeScript skills');
      expect(requirements).toContain('Should have 5+ years');
      expect(requirements).not.toContain('Competitive salary');
    });
  });

  describe('extractQualifications', () => {
    const scraper = new TestScraper();

    test('extracts qualifications section', () => {
      const description = `
About the Role

Nice to have:
- Bachelor's degree
- 2+ years experience

What we offer:
- Great benefits
      `;

      const qualifications = scraper.testExtractQualifications(description);

      expect(qualifications).toContain("Bachelor's degree");
      expect(qualifications).toContain('2+ years experience');
      expect(qualifications).not.toContain('Great benefits');
    });

    test('extracts "nice to have" section', () => {
      const description = `
Requirements:
- Must have skill

Nice to have:
- Bonus skill 1
- Bonus skill 2

Benefits:
- Health insurance
      `;

      const qualifications = scraper.testExtractQualifications(description);

      expect(qualifications).toContain('Bonus skill 1');
      expect(qualifications).toContain('Bonus skill 2');
      expect(qualifications).not.toContain('Must have skill');
      expect(qualifications).not.toContain('Health insurance');
    });

    test('extracts "preferred" section', () => {
      const description = `
Must Have:
- Required skill

Preferred:
- Nice skill 1
- Nice skill 2

What we offer:
- Great culture
      `;

      const qualifications = scraper.testExtractQualifications(description);

      expect(qualifications).toContain('Nice skill 1');
      expect(qualifications).toContain('Nice skill 2');
      expect(qualifications).not.toContain('Required skill');
      expect(qualifications).not.toContain('Great culture');
    });

    test('stops at "responsibilities" section', () => {
      const description = `
Nice to have:
- GraphQL experience

Responsibilities:
- Do some work
      `;

      const qualifications = scraper.testExtractQualifications(description);

      expect(qualifications).toContain('GraphQL experience');
      expect(qualifications).not.toContain('Do some work');
    });

    test('stops at "benefits" section', () => {
      const description = `
Preferred:
- Docker knowledge

Benefits:
- Health insurance
      `;

      const qualifications = scraper.testExtractQualifications(description);

      expect(qualifications).toContain('Docker knowledge');
      expect(qualifications).not.toContain('Health insurance');
    });

    test('returns empty array when no qualifications section', () => {
      const description = `
About the Company
We are a great company.

Requirements:
- Required skill
      `;

      const qualifications = scraper.testExtractQualifications(description);

      expect(qualifications).toHaveLength(0);
    });

    test('returns empty array for empty description', () => {
      const qualifications = scraper.testExtractQualifications('');

      expect(qualifications).toHaveLength(0);
    });

    test('handles case-insensitive matching', () => {
      const description = `
NICE TO HAVE:
- Uppercase header skill

qualifications:
- Lowercase header skill
      `;

      // Note: The current implementation uses toLowerCase, so this should work
      const qualifications = scraper.testExtractQualifications(description);

      expect(qualifications.length).toBeGreaterThan(0);
    });
  });

  describe('extractRequirements and extractQualifications interaction', () => {
    const scraper = new TestScraper();

    test('requirements and qualifications do not overlap in typical job description', () => {
      const description = `
About the Role
Join our team as a Software Engineer.

Requirements:
- 5+ years of experience
- Strong TypeScript skills
- Experience with cloud services

Nice to have:
- Experience with Kubernetes
- GraphQL knowledge

What we offer:
- Competitive salary
- Remote work
      `;

      const requirements = scraper.testExtractRequirements(description);
      const qualifications = scraper.testExtractQualifications(description);

      // Requirements should have the must-haves
      expect(requirements).toContain('5+ years of experience');
      expect(requirements).toContain('Strong TypeScript skills');
      expect(requirements).toContain('Experience with cloud services');

      // Qualifications should have the nice-to-haves
      expect(qualifications).toContain('Experience with Kubernetes');
      expect(qualifications).toContain('GraphQL knowledge');

      // Neither should have benefits
      expect(requirements).not.toContain('Competitive salary');
      expect(qualifications).not.toContain('Competitive salary');

      // No overlap
      for (const req of requirements) {
        expect(qualifications).not.toContain(req);
      }
    });
  });
});
