import { describe, expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { GreenhouseScraper } from './greenhouse';
import { LeverScraper } from './lever';
import type { JobData } from '../types';
import { join } from 'path';

// Check if Playwright browsers are installed
let playwrightAvailable = false;
try {
  const browser = await chromium.launch({ headless: true });
  await browser.close();
  playwrightAvailable = true;
} catch {
  console.log('Playwright browsers not installed. Skipping integration tests.');
  console.log('Run "npx playwright install chromium" to enable integration tests.');
}

// Test scraper that exposes protected methods and allows injecting a page
class TestableGreenhouseScraper extends GreenhouseScraper {
  public async testWithHtml(html: string, url: string): Promise<JobData> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html);

    this.page = page;
    await this.waitForContent();
    const result = await this.extractJobData(url);
    await browser.close();
    return result;
  }

  public async testWithFixture(fixturePath: string, url: string): Promise<JobData> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`file://${fixturePath}`);

    this.page = page;
    await this.waitForContent();
    const result = await this.extractJobData(url);
    await browser.close();
    return result;
  }
}

class TestableLeverScraper extends LeverScraper {
  public async testWithHtml(html: string, url: string): Promise<JobData> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html);

    this.page = page;
    await this.waitForContent();
    const result = await this.extractJobData(url);
    await browser.close();
    return result;
  }

  public async testWithFixture(fixturePath: string, url: string): Promise<JobData> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`file://${fixturePath}`);

    this.page = page;
    await this.waitForContent();
    const result = await this.extractJobData(url);
    await browser.close();
    return result;
  }
}

describe('Scraper Integration Tests', () => {
  // Skip all tests if Playwright is not available
  const testFn = playwrightAvailable ? test : test.skip;

  describe('GreenhouseScraper', () => {
    testFn('extracts job data from greenhouse HTML fixture', async () => {
      const fixturePath = join(import.meta.dir, '__fixtures__', 'greenhouse.html');
      const scraper = new TestableGreenhouseScraper();
      const jobData = await scraper.testWithFixture(
        fixturePath,
        'https://boards.greenhouse.io/acme/jobs/12345'
      );

      expect(jobData.platform).toBe('greenhouse');
      expect(jobData.title).toBe('Software Engineer');
      expect(jobData.company).toBe('Acme Corp');
      expect(jobData.location).toBe('San Francisco, CA');
      expect(jobData.description).toContain('talented Software Engineer');
    });

    testFn('extracts requirements from greenhouse fixture', async () => {
      const fixturePath = join(import.meta.dir, '__fixtures__', 'greenhouse.html');
      const scraper = new TestableGreenhouseScraper();
      const jobData = await scraper.testWithFixture(
        fixturePath,
        'https://boards.greenhouse.io/acme/jobs/12345'
      );

      expect(jobData.requirements.length).toBeGreaterThan(0);
      expect(
        jobData.requirements.some((r) => r.includes('JavaScript') || r.includes('TypeScript'))
      ).toBe(true);
    });

    testFn('extracts custom questions from greenhouse fixture', async () => {
      const fixturePath = join(import.meta.dir, '__fixtures__', 'greenhouse.html');
      const scraper = new TestableGreenhouseScraper();
      const jobData = await scraper.testWithFixture(
        fixturePath,
        'https://boards.greenhouse.io/acme/jobs/12345'
      );

      expect(jobData.custom_questions.length).toBeGreaterThan(0);

      const textareaQuestion = jobData.custom_questions.find((q) => q.type === 'textarea');
      expect(textareaQuestion).toBeDefined();
      expect(textareaQuestion?.question).toContain('Why do you want to work');

      const selectQuestion = jobData.custom_questions.find((q) => q.type === 'select');
      expect(selectQuestion).toBeDefined();
      expect(selectQuestion?.options).toContain('3-5 years');
    });

    testFn('extracts form fields from greenhouse fixture', async () => {
      const fixturePath = join(import.meta.dir, '__fixtures__', 'greenhouse.html');
      const scraper = new TestableGreenhouseScraper();
      const jobData = await scraper.testWithFixture(
        fixturePath,
        'https://boards.greenhouse.io/acme/jobs/12345'
      );

      expect(jobData.form_fields.length).toBeGreaterThan(0);

      const nameField = jobData.form_fields.find((f) => f.name === 'name');
      expect(nameField).toBeDefined();
      expect(nameField?.type).toBe('text');

      const emailField = jobData.form_fields.find((f) => f.name === 'email');
      expect(emailField).toBeDefined();
      expect(emailField?.type).toBe('email');
    });

    testFn('extracts company from URL when not in page', async () => {
      const html = `
        <div id="app_body">
          <h1 class="app-title">Engineer</h1>
          <div id="content">Job description</div>
        </div>
      `;

      const scraper = new TestableGreenhouseScraper();
      const jobData = await scraper.testWithHtml(
        html,
        'https://boards.greenhouse.io/my-company/jobs/12345'
      );

      expect(jobData.company).toBe('my company');
    });

    testFn('handles missing title gracefully', async () => {
      const html = `
        <div id="app_body">
          <div id="content">Job description</div>
        </div>
      `;

      const scraper = new TestableGreenhouseScraper();
      const jobData = await scraper.testWithHtml(
        html,
        'https://boards.greenhouse.io/company/jobs/12345'
      );

      expect(jobData.title).toBe('Unknown Position');
    });
  });

  describe('LeverScraper', () => {
    testFn('extracts job data from lever HTML fixture', async () => {
      const fixturePath = join(import.meta.dir, '__fixtures__', 'lever.html');
      const scraper = new TestableLeverScraper();
      const jobData = await scraper.testWithFixture(
        fixturePath,
        'https://jobs.lever.co/techstartup/job-12345'
      );

      expect(jobData.platform).toBe('lever');
      expect(jobData.title).toBe('Product Manager');
      expect(jobData.company).toBe('TechStartup');
      expect(jobData.location).toBe('New York, NY');
      expect(jobData.description).toContain('Product Manager');
    });

    testFn('extracts requirements from lever fixture', async () => {
      const fixturePath = join(import.meta.dir, '__fixtures__', 'lever.html');
      const scraper = new TestableLeverScraper();
      const jobData = await scraper.testWithFixture(
        fixturePath,
        'https://jobs.lever.co/techstartup/job-12345'
      );

      expect(jobData.requirements.length).toBeGreaterThan(0);
      expect(jobData.requirements.some((r) => r.includes('product management'))).toBe(true);
    });

    testFn('extracts custom questions from lever fixture', async () => {
      const fixturePath = join(import.meta.dir, '__fixtures__', 'lever.html');
      const scraper = new TestableLeverScraper();
      const jobData = await scraper.testWithFixture(
        fixturePath,
        'https://jobs.lever.co/techstartup/job-12345'
      );

      expect(jobData.custom_questions.length).toBeGreaterThan(0);

      const launchQuestion = jobData.custom_questions.find((q) => q.question.includes('product'));
      expect(launchQuestion).toBeDefined();
    });

    testFn('extracts company from URL when not in page', async () => {
      const html = `
        <div class="posting">
          <div class="posting-headline">
            <h2>Engineer</h2>
          </div>
          <div class="posting-description">Description</div>
        </div>
      `;

      const scraper = new TestableLeverScraper();
      const jobData = await scraper.testWithHtml(
        html,
        'https://jobs.lever.co/my-startup/job-id'
      );

      expect(jobData.company).toBe('my startup');
    });
  });

  describe('Edge cases', () => {
    testFn(
      'handles minimal page gracefully',
      async () => {
        // Use minimal but valid structure
        const html = '<html><body><div id="app_body"></div></body></html>';

        const scraper = new TestableGreenhouseScraper();
        const jobData = await scraper.testWithHtml(
          html,
          'https://boards.greenhouse.io/company/jobs/12345'
        );

        expect(jobData.title).toBe('Unknown Position');
        expect(jobData.description).toBe('');
        expect(jobData.requirements).toHaveLength(0);
        expect(jobData.form_fields).toHaveLength(0);
      },
      { timeout: 15000 }
    );

    testFn(
      'handles page with missing optional fields',
      async () => {
        const html = `
          <div id="app_body">
            <h1 class="app-title">Test Job</h1>
            <div id="content">Job description here</div>
          </div>
        `;

        const scraper = new TestableGreenhouseScraper();
        const jobData = await scraper.testWithHtml(
          html,
          'https://boards.greenhouse.io/company/jobs/12345'
        );

        expect(jobData).toBeDefined();
        expect(jobData.platform).toBe('greenhouse');
        expect(jobData.title).toBe('Test Job');
      },
      { timeout: 15000 }
    );

    testFn('handles special characters in job data', async () => {
      const html = `
        <div id="app_body">
          <h1 class="app-title">Senior Engineer &amp; Team Lead</h1>
          <div class="company-name">O'Reilly &amp; Associates</div>
          <div class="location">São Paulo, Brazil</div>
          <div id="content">
            Requirements:
            - Experience with C++ and "modern" languages
          </div>
        </div>
      `;

      const scraper = new TestableGreenhouseScraper();
      const jobData = await scraper.testWithHtml(
        html,
        'https://boards.greenhouse.io/company/jobs/12345'
      );

      expect(jobData.title).toContain('Senior Engineer');
      expect(jobData.company).toContain("O'Reilly");
      expect(jobData.location).toContain('São Paulo');
    });

    testFn('handles very long descriptions', async () => {
      const longDescription = 'A'.repeat(10000);
      const html = `
        <div id="app_body">
          <h1 class="app-title">Engineer</h1>
          <div id="content">${longDescription}</div>
        </div>
      `;

      const scraper = new TestableGreenhouseScraper();
      const jobData = await scraper.testWithHtml(
        html,
        'https://boards.greenhouse.io/company/jobs/12345'
      );

      expect(jobData.description.length).toBeGreaterThan(5000);
    });
  });
});
