import { logger } from './logger';
import { scrapeLinkedInProfile, formatLinkedInProfileContext } from '../scrapers/linkedin-profile';

interface LinkContext {
  url: string;
  type: 'github' | 'linkedin' | 'portfolio';
  content: string;
}

// Simple in-memory cache with 15-minute TTL
interface CachedEntry {
  content: string;
  timestamp: number;
}
const cache = new Map<string, CachedEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;

function getCached(url: string): string | null {
  const entry = cache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(url);
    return null;
  }
  return entry.content;
}

function setCache(url: string, content: string): void {
  cache.set(url, { content, timestamp: Date.now() });
}

/**
 * Fetch context from a GitHub profile or repository URL
 */
async function fetchGithubContext(url: string): Promise<string> {
  const cached = getCached(url);
  if (cached) return cached;

  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname.split('/').filter(Boolean);

    if (pathSegments.length === 0) return '';

    const username = pathSegments[0];
    const isRepo = pathSegments.length >= 2;

    const headers = {
      'User-Agent': 'Autoply-AI-Assistant/1.0',
      Accept: 'application/vnd.github.v3+json',
    };

    if (isRepo) {
      const repoName = pathSegments[1];
      const res = await fetch(`https://api.github.com/repos/${username}/${repoName}`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return `GitHub Repo URL: ${url}`;
      const data = (await res.json()) as {
        name?: string;
        description?: string;
        language?: string;
        stargazers_count?: number;
        topics?: string[];
      };
      const result = [
        `GitHub Repo (${url}):`,
        `- Name: ${data.name || repoName}`,
        data.description ? `- Description: ${data.description}` : null,
        data.language ? `- Primary Language: ${data.language}` : null,
        data.stargazers_count ? `- Stars: ${data.stargazers_count}` : null,
        data.topics?.length ? `- Topics: ${data.topics.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      setCache(url, result);
      return result;
    }

    // User profile
    const [userRes, reposRes] = await Promise.allSettled([
      fetch(`https://api.github.com/users/${username}`, {
        headers,
        signal: AbortSignal.timeout(3000),
      }),
      fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=5`, {
        headers,
        signal: AbortSignal.timeout(3000),
      }),
    ]);

    const parts: string[] = [`GitHub Profile (${url}):`];

    if (userRes.status === 'fulfilled' && userRes.value.ok) {
      const userData = (await userRes.value.json()) as {
        name?: string;
        bio?: string;
        public_repos?: number;
        followers?: number;
        location?: string;
        company?: string;
      };
      if (userData.name) parts.push(`- Name: ${userData.name}`);
      if (userData.bio) parts.push(`- Bio: ${userData.bio}`);
      if (userData.company) parts.push(`- Company: ${userData.company}`);
      if (userData.location) parts.push(`- Location: ${userData.location}`);
      if (userData.public_repos !== undefined)
        parts.push(`- Public Repos: ${userData.public_repos}`);
    }

    if (reposRes.status === 'fulfilled' && reposRes.value.ok) {
      const repos = (await reposRes.value.json()) as Array<{
        name: string;
        description?: string;
        language?: string;
        stargazers_count?: number;
      }>;
      if (Array.isArray(repos) && repos.length > 0) {
        parts.push('- Recent Repositories:');
        for (const repo of repos) {
          const lang = repo.language ? ` [${repo.language}]` : '';
          const desc = repo.description ? `: ${repo.description}` : '';
          parts.push(`  * ${repo.name}${lang}${desc}`);
        }
      }
    }

    const result = parts.length > 1 ? parts.join('\n') : `GitHub Profile: ${url}`;
    setCache(url, result);
    return result;
  } catch (err) {
    logger.warn(`Failed to fetch GitHub context for ${url}: ${err}`, {}, 'api');
    return `GitHub Profile: ${url}`;
  }
}

/**
 * Fetch HTML content from portfolio or LinkedIn links and extract readable text
 */
async function fetchWebContent(url: string, type: 'portfolio' | 'linkedin'): Promise<string> {
  const cached = getCached(url);
  if (cached) return cached;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      return `${type === 'linkedin' ? 'LinkedIn' : 'Portfolio'} Link: ${url}`;
    }

    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : '';

    // Extract meta description or og:description
    const metaDescMatch =
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i) ||
      html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["']/i) ||
      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i) ||
      html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*property=["']og:description["']/i);
    const metaDescription = metaDescMatch ? metaDescMatch[1].trim().replace(/\s+/g, ' ') : '';

    // Strip scripts, styles, and tags for body text
    const cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

    // Extract basic body text
    const bodyText = cleanHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2500);

    const label = type === 'linkedin' ? 'LinkedIn Profile' : 'Portfolio / Website';
    const parts = [`${label} (${url}):`];
    if (title) parts.push(`- Page Title: ${title}`);
    if (metaDescription) parts.push(`- Meta Description: ${metaDescription}`);
    if (bodyText && bodyText.length > 50) parts.push(`- Page Content Snippet:\n  ${bodyText}`);

    const result = parts.length > 1 ? parts.join('\n') : `${label}: ${url}`;
    setCache(url, result);
    return result;
  } catch (err) {
    logger.warn(`Failed to fetch content for ${type} link ${url}: ${err}`, {}, 'api');
    return `${type === 'linkedin' ? 'LinkedIn' : 'Portfolio'} Link: ${url}`;
  }
}

async function fetchLinkedInContext(url: string): Promise<string> {
  const cached = getCached(url);
  if (cached) return cached;

  try {
    const profileData = await scrapeLinkedInProfile(url);
    const formatted = formatLinkedInProfileContext(profileData, url);
    setCache(url, formatted);
    return formatted;
  } catch (err) {
    logger.warn(`Failed to scrape LinkedIn profile for ${url}: ${err}`, {}, 'api');
    return `LinkedIn Profile: ${url}`;
  }
}

/**
 * Main function to fetch live context from all profile links (GitHub, LinkedIn, Portfolio)
 */
export async function fetchProfileLinksContext(profile: {
  github_url?: string;
  linkedin_url?: string;
  portfolio_url?: string;
}): Promise<string> {
  const fetchTasks: Array<Promise<LinkContext>> = [];

  if (profile.github_url) {
    const githubUrl = profile.github_url;
    fetchTasks.push(
      fetchGithubContext(githubUrl).then((content) => ({
        url: githubUrl,
        type: 'github' as const,
        content,
      }))
    );
  }

  if (profile.linkedin_url) {
    const linkedinUrl = profile.linkedin_url;
    fetchTasks.push(
      fetchLinkedInContext(linkedinUrl).then((content) => ({
        url: linkedinUrl,
        type: 'linkedin' as const,
        content,
      }))
    );
  }

  if (profile.portfolio_url) {
    const portfolioUrl = profile.portfolio_url;
    fetchTasks.push(
      fetchWebContent(portfolioUrl, 'portfolio').then((content) => ({
        url: portfolioUrl,
        type: 'portfolio' as const,
        content,
      }))
    );
  }

  if (fetchTasks.length === 0) return '';

  const results = await Promise.allSettled(fetchTasks);
  const contexts: string[] = [];

  for (const res of results) {
    if (res.status === 'fulfilled' && res.value.content) {
      contexts.push(res.value.content);
    }
  }

  if (contexts.length === 0) return '';

  return `\n\nExternal Links & Portfolio Context:\n${contexts.join('\n\n')}`;
}

/**
 * Fetch and format context from an active job posting page URL or link dropped in chat
 */
export async function fetchJobUrlContext(url: string): Promise<string> {
  if (!url || !url.startsWith('http')) return '';

  const cached = getCached(url);
  if (cached) return cached;

  try {
    const { detectPlatform } = await import('./url-parser');
    const platform = detectPlatform(url) || 'generic';

    if (platform !== 'generic') {
      try {
        const { createScraper } = await import('../scrapers');
        const scraper = createScraper(platform);
        const jobData = await scraper.scrape(url);

        const parts = [
          `Active Job Posting Context (${url}):`,
          `- Job Title: ${jobData.title}`,
          `- Company: ${jobData.company}`,
          jobData.location ? `- Location: ${jobData.location}` : null,
          jobData.job_type ? `- Job Type: ${jobData.job_type}` : null,
          jobData.description ? `- Description:\n  ${jobData.description.slice(0, 3000)}` : null,
          jobData.requirements?.length
            ? `- Requirements:\n  * ${jobData.requirements.join('\n  * ')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n');

        setCache(url, parts);
        return parts;
      } catch {
        // Fall back to HTTP web content fetcher
      }
    }

    const textContent = await fetchWebContent(url, 'portfolio');
    const result = `Active Job / Page Context (${url}):\n${textContent}`;
    setCache(url, result);
    return result;
  } catch (err) {
    logger.warn(`Failed to fetch job URL context for ${url}: ${err}`, {}, 'api');
    return `Job Page Link: ${url}`;
  }
}
