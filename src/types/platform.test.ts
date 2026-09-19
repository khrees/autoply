import { describe, expect, test } from 'bun:test';
import { SUPPORTED_PLATFORMS, type Platform } from './index';

describe('SUPPORTED_PLATFORMS regex patterns', () => {
  describe('greenhouse', () => {
    const regex = SUPPORTED_PLATFORMS.greenhouse;

    test('matches real greenhouse URL', () => {
      // Real example from Greenhouse documentation
      expect(regex.test('https://boards.greenhouse.io/vaulttec/jobs/127817')).toBe(true);
    });

    test('matches greenhouse URL with subdomain path', () => {
      expect(regex.test('https://boards.greenhouse.io/acme-corp')).toBe(true);
    });

    test('matches greenhouse URL with gh_jid query param', () => {
      expect(regex.test('https://boards.greenhouse.io/company/jobs/130142?gh_jid=130142')).toBe(
        true
      );
    });

    test('does not match non-greenhouse URLs', () => {
      expect(regex.test('https://greenhouse.io')).toBe(false);
      // Note: The regex will match substring patterns - URL validation layer handles full validation
    });
  });

  describe('linkedin', () => {
    const regex = SUPPORTED_PLATFORMS.linkedin;

    test('matches linkedin job view URL', () => {
      expect(regex.test('https://www.linkedin.com/jobs/view/3812345678')).toBe(true);
    });

    test('matches linkedin URL without www', () => {
      expect(regex.test('https://linkedin.com/jobs/view/3812345678')).toBe(true);
    });

    test('matches linkedin job collections URL', () => {
      expect(regex.test('https://www.linkedin.com/jobs/collections/recommended')).toBe(true);
    });

    test('matches linkedin job search URL', () => {
      expect(
        regex.test(
          'https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=San%20Francisco'
        )
      ).toBe(true);
    });

    test('does not match linkedin profile URLs', () => {
      expect(regex.test('https://linkedin.com/in/johndoe')).toBe(false);
    });

    test('does not match linkedin company URLs', () => {
      expect(regex.test('https://linkedin.com/company/google')).toBe(false);
    });
  });

  describe('lever', () => {
    const regex = SUPPORTED_PLATFORMS.lever;

    test('matches real lever URL with UUID', () => {
      // Real example format from Lever documentation
      expect(
        regex.test('https://jobs.lever.co/examplecompany/4f816f9a-7f03-4e18-9710-6ec9a9c0d40e')
      ).toBe(true);
    });

    test('matches lever apply URL', () => {
      expect(
        regex.test(
          'https://jobs.lever.co/examplecompany/4f816f9a-7f03-4e18-9710-6ec9a9c0d40e/apply'
        )
      ).toBe(true);
    });

    test('does not match non-lever URLs', () => {
      expect(regex.test('https://lever.co/company')).toBe(false);
      // Note: The regex will match substring patterns - URL validation layer handles full validation
    });
  });

  describe('ashby', () => {
    const regex = SUPPORTED_PLATFORMS.ashby;

    test('matches real ashby URL', () => {
      // Real example: Ashby's own careers page
      expect(regex.test('https://jobs.ashbyhq.com/ashby')).toBe(true);
    });

    test('matches ashby job with apply path', () => {
      expect(regex.test('https://jobs.ashbyhq.com/example/apply')).toBe(true);
    });

    test('matches ashby embed demo URL', () => {
      expect(regex.test('https://jobs.ashbyhq.com/ashby-embed-demo-org')).toBe(true);
    });

    test('does not match non-ashby URLs', () => {
      expect(regex.test('https://ashbyhq.com/jobs')).toBe(false);
      // Note: The regex will match substring patterns - URL validation layer handles full validation
    });
  });

  describe('platform coverage', () => {
    test('all expected platforms are defined', () => {
      const expectedPlatforms: Platform[] = ['greenhouse', 'linkedin', 'lever', 'ashby', 'generic'];

      for (const platform of expectedPlatforms) {
        expect(SUPPORTED_PLATFORMS[platform]).toBeDefined();
        expect(SUPPORTED_PLATFORMS[platform]).toBeInstanceOf(RegExp);
      }
    });

    test('each platform regex is unique (no overlaps on real URLs)', () => {
      // Using real-world URL examples for each platform
      const testUrls: Record<Platform, string> = {
        greenhouse: 'https://boards.greenhouse.io/vaulttec/jobs/127817',
        linkedin: 'https://www.linkedin.com/jobs/view/3812345678',
        lever: 'https://jobs.lever.co/examplecompany/4f816f9a-7f03-4e18-9710-6ec9a9c0d40e',
        ashby: 'https://jobs.ashbyhq.com/ashby',
        generic: 'https://careers.somecompany.com/jobs/12345',
      };

      for (const [platform, url] of Object.entries(testUrls)) {
        if (platform === 'generic') continue;
        const matchingPlatforms = Object.entries(SUPPORTED_PLATFORMS)
          .filter(([p, regex]) => p !== 'generic' && regex.test(url))
          .map(([p, _]) => p);

        expect(matchingPlatforms).toHaveLength(1);
        expect(matchingPlatforms[0]).toBe(platform);
      }
    });
  });
});
