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

  describe('jobvite', () => {
    const regex = SUPPORTED_PLATFORMS.jobvite;

    test('matches standard jobvite URL', () => {
      expect(regex.test('https://jobs.jobvite.com/company/job/12345')).toBe(true);
    });

    test('matches jobvite careers URL', () => {
      expect(regex.test('https://jobs.jobvite.com/company/careers')).toBe(true);
    });

    test('does not match non-jobvite URLs', () => {
      expect(regex.test('https://jobvite.com/jobs')).toBe(false);
    });
  });

  describe('smartrecruiters', () => {
    const regex = SUPPORTED_PLATFORMS.smartrecruiters;

    test('matches real smartrecruiters URL', () => {
      // Real example from SmartRecruiters
      expect(
        regex.test(
          'https://jobs.smartrecruiters.com/WabashValleyPowerAlliance/744000090457343-line-superintendent-kankakee-valley-remc-'
        )
      ).toBe(true);
    });

    test('matches smartrecruiters URL with numeric ID', () => {
      expect(
        regex.test('https://jobs.smartrecruiters.com/Skechers1/12308096-quality-assurance-manager')
      ).toBe(true);
    });

    test('does not match non-smartrecruiters URLs', () => {
      expect(regex.test('https://smartrecruiters.com/jobs')).toBe(false);
    });
  });

  describe('pinpoint', () => {
    const regex = SUPPORTED_PLATFORMS.pinpoint;

    test('matches standard pinpoint URL', () => {
      expect(regex.test('https://company.pinpointhq.com/jobs/12345')).toBe(true);
    });

    test('matches pinpoint URL with different subdomains', () => {
      expect(regex.test('https://acme-corp.pinpointhq.com/postings/engineer')).toBe(true);
    });

    test('matches pinpoint URL with en subdomain', () => {
      expect(regex.test('https://en.company.pinpointhq.com/jobs/12345')).toBe(true);
    });

    test('does not match non-pinpoint URLs', () => {
      expect(regex.test('https://pinpointhq.com/jobs')).toBe(false);
    });
  });

  describe('teamtailor', () => {
    const regex = SUPPORTED_PLATFORMS.teamtailor;

    test('matches standard teamtailor URL', () => {
      expect(regex.test('https://company.teamtailor.com/jobs/12345')).toBe(true);
    });

    test('matches teamtailor URL with different subdomains', () => {
      expect(regex.test('https://acme-corp.teamtailor.com/jobs/engineer')).toBe(true);
    });

    test('matches teamtailor careers subdomain', () => {
      expect(regex.test('https://careers.company.teamtailor.com/jobs/12345')).toBe(true);
    });

    test('does not match non-teamtailor URLs', () => {
      expect(regex.test('https://teamtailor.com/jobs')).toBe(false);
    });
  });

  describe('workday', () => {
    const regex = SUPPORTED_PLATFORMS.workday;

    test('matches real Workday careers URL', () => {
      // Real example: Workday's own careers page
      expect(regex.test('https://workday.wd5.myworkdayjobs.com/Workday')).toBe(true);
    });

    test('matches Mastercard Workday URL', () => {
      // Real example: Mastercard
      expect(regex.test('https://mastercard.wd1.myworkdayjobs.com/CorporateCareers')).toBe(true);
    });

    test('matches workday.com URL with /job/ path', () => {
      expect(regex.test('https://company.workday.com/en-US/job/12345')).toBe(true);
    });

    test('matches workday.com URL with deep path', () => {
      expect(regex.test('https://company.workday.com/wday/cxs/company/External/job/12345')).toBe(
        true
      );
    });

    test('does not match workday.com without /job/ path', () => {
      expect(regex.test('https://company.workday.com/careers')).toBe(false);
    });

    test('does not match non-workday URLs', () => {
      expect(regex.test('https://example.com/myworkdayjobs')).toBe(false);
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

  describe('workable', () => {
    const regex = SUPPORTED_PLATFORMS.workable;

    test('matches workable apply URL', () => {
      expect(regex.test('https://apply.workable.com/pubgenius-1/j/9DD2F70851/apply/')).toBe(true);
    });

    test('matches workable URL without apply path', () => {
      expect(regex.test('https://apply.workable.com/company/j/1234567/')).toBe(true);
    });

    test('does not match non-workable URLs', () => {
      expect(regex.test('https://workable.com/jobs')).toBe(false);
    });
  });

  describe('platform coverage', () => {
    test('all expected platforms are defined', () => {
      const expectedPlatforms: Platform[] = [
        'greenhouse',
        'linkedin',
        'lever',
        'jobvite',
        'smartrecruiters',
        'pinpoint',
        'teamtailor',
        'workday',
        'ashby',
        'workable',
      ];

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
        jobvite: 'https://jobs.jobvite.com/careers/company/job/12345',
        smartrecruiters:
          'https://jobs.smartrecruiters.com/Skechers1/12308096-quality-assurance-manager',
        pinpoint: 'https://acme.pinpointhq.com/postings/engineer-12345',
        teamtailor: 'https://company.teamtailor.com/jobs/software-engineer',
        workday: 'https://workday.wd5.myworkdayjobs.com/Workday',
        ashby: 'https://jobs.ashbyhq.com/ashby',
        bamboohr: 'https://company.bamboohr.com/careers/12345',
        workable: 'https://apply.workable.com/pubgenius-1/j/9DD2F70851/apply/',
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
