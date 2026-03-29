import { SUPPORTED_PLATFORMS, type Platform } from '../types';

export interface ParsedUrl {
  url: string;
  platform: Platform;
  isValid: boolean;
  error?: string;
}

export function parseJobUrl(url: string): ParsedUrl {
  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      url,
      platform: 'greenhouse' as Platform,
      isValid: false,
      error: 'Invalid URL format',
    };
  }

  // Check if HTTPS or HTTP
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return {
      url,
      platform: 'greenhouse' as Platform,
      isValid: false,
      error: 'URL must use HTTP or HTTPS protocol',
    };
  }

  // Detect platform, fall back to generic for unknown platforms
  const platform = detectPlatform(url) ?? 'generic';

  return {
    url,
    platform,
    isValid: true,
  };
}

export function detectPlatform(url: string): Platform | null {
  for (const [platform, regex] of Object.entries(SUPPORTED_PLATFORMS)) {
    if (regex.test(url)) {
      return platform as Platform;
    }
  }
  return null;
}

export function isValidJobUrl(url: string): boolean {
  return parseJobUrl(url).isValid;
}

export function getSupportedPlatforms(): string[] {
  return Object.keys(SUPPORTED_PLATFORMS);
}

export function getPlatformExamples(): Record<Platform, string> {
  return {
    greenhouse: 'https://boards.greenhouse.io/company/jobs/12345',
    linkedin: 'https://linkedin.com/jobs/view/12345',
    lever: 'https://jobs.lever.co/company/job-id',
    jobvite: 'https://jobs.jobvite.com/company/job/12345',
    smartrecruiters: 'https://jobs.smartrecruiters.com/Company/12345',
    pinpoint: 'https://company.pinpointhq.com/jobs/12345',
    teamtailor: 'https://company.teamtailor.com/jobs/12345',
    workday: 'https://company.myworkdayjobs.com/en-US/External/job/12345',
    ashby: 'https://jobs.ashbyhq.com/company/job-id',
    bamboohr: 'https://company.bamboohr.com/careers/123',
    workable: 'https://apply.workable.com/company/j/1234567/apply/',
    generic: 'https://company.com/careers/job/12345',
  };
}

export async function readUrlsFromFile(filePath: string): Promise<string[]> {
  const file = Bun.file(filePath);
  const content = await file.text();
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'ref',
      'fbclid',
      'gclid',
      'source',
    ];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return url;
  }
}

export function validateUrls(urls: string[]): { valid: ParsedUrl[]; invalid: ParsedUrl[] } {
  const results = urls.map(parseJobUrl);
  return {
    valid: results.filter((r) => r.isValid),
    invalid: results.filter((r) => !r.isValid),
  };
}
