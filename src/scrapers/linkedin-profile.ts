import { logger } from '../utils/logger';
import { getAutoplyDir } from '../db';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ============ Types ============

export interface LinkedInExperienceItem {
  title: string;
  company: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface LinkedInEducationItem {
  institution: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
}

export interface ExtractedLinkedInProfile {
  name?: string;
  headline?: string;
  location?: string;
  about?: string;
  experience: LinkedInExperienceItem[];
  education: LinkedInEducationItem[];
  skills: string[];
  rawText?: string;
}

export interface ExtractionResult {
  profile: ExtractedLinkedInProfile;
  confidence: number;
  extractionPath: 'jsonld' | 'og-meta' | 'browser' | 'text-fallback' | 'failed';
}

// ============ Constants ============

const SOCIAL_PREVIEW_UA =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const DESKTOP_UAS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

const SEMANTIC_SELECTORS = {
  name: 'h1[aria-hidden="true"], h1.text-heading-xlarge, h1',
  headline: '[data-generated-suggestion-target], .text-body-medium.break-words, .text-body-medium',
  location: '.text-body-small.inline.t-black--light.break-words, .top-card__subline-item',
  aboutSection: 'section:has(#about), #about',
  experienceSection: 'section:has(#experience), #experience',
  educationSection: 'section:has(#education), #education',
  skillsSection: 'section:has(#skills), #skills',
} as const;

const RANDOM_DELAY_MIN_MS = 2000;
const RANDOM_DELAY_MAX_MS = 6000;

// ============ Helpers ============

function randomDelay(min = RANDOM_DELAY_MIN_MS, max = RANDOM_DELAY_MAX_MS): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ============ LinkedIn Cookie Resolution ============

interface LinkedInCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly?: boolean;
  secure?: boolean;
}

let cachedCookieString: string | null | undefined = undefined;
let cachedCookies: LinkedInCookie[] | undefined = undefined;

function readLinkedInCookiesFromStorage(): LinkedInCookie[] {
  try {
    const storagePath = join(getAutoplyDir(), 'browser-state.json');
    if (!existsSync(storagePath)) return [];
    const raw = readFileSync(storagePath, 'utf-8');
    const state = JSON.parse(raw);
    const allCookies = (state?.cookies || []).filter(
      (c: { domain?: string }) => c.domain && c.domain.includes('linkedin.com')
    );
    return allCookies.map(
      (c: {
        name: string;
        value: string;
        domain?: string;
        path?: string;
        httpOnly?: boolean;
        secure?: boolean;
      }) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || '.linkedin.com',
        path: c.path || '/',
        httpOnly: c.httpOnly,
        secure: c.secure,
      })
    );
  } catch {
    // Storage state not available
    return [];
  }
}

/**
 * Resolves LinkedIn cookies from:
 * 1. Environment variable LINKEDIN_LI_AT (single li_at cookie)
 * 2. Storage state file (~/.autoply/browser-state.json) used by `autoply login`
 *
 * Returns the cookie string for HTTP headers (e.g., "li_at=xxx; bcookie=xxx")
 * or null if no cookies are found.
 */
function getLinkedInCookieString(): string | null {
  if (cachedCookieString !== undefined) return cachedCookieString;

  // 1. Check environment variable
  const envCookie = process.env.LINKEDIN_LI_AT;
  if (envCookie?.trim()) {
    cachedCookieString = `li_at=${envCookie.trim()}`;
    return cachedCookieString;
  }

  // 2. Check storage state file for all LinkedIn cookies
  const stored = readLinkedInCookiesFromStorage();
  if (stored.length > 0) {
    cachedCookieString = stored.map((c) => `${c.name}=${c.value}`).join('; ');
    return cachedCookieString;
  }

  cachedCookieString = null;
  return null;
}

/**
 * Returns all LinkedIn cookies as an array for browser context.addCookies().
 * Falls back to just li_at from env var if storage state is not available.
 */
function getLinkedInCookies(): LinkedInCookie[] {
  if (cachedCookies !== undefined) return cachedCookies;

  // 1. Check storage state file first (has all cookies)
  const stored = readLinkedInCookiesFromStorage();
  if (stored.length > 0) {
    cachedCookies = stored;
    return cachedCookies;
  }

  // 2. Fall back to env var
  const envCookie = process.env.LINKEDIN_LI_AT;
  if (envCookie?.trim()) {
    cachedCookies = [
      {
        name: 'li_at',
        value: envCookie.trim(),
        domain: '.linkedin.com',
        path: '/',
        httpOnly: true,
        secure: true,
      },
    ];
    return cachedCookies;
  }

  cachedCookies = [];
  return [];
}

// ============ URL Normalization ============

export function normalizeLinkedInUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('linkedin.com')) return url;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return url;
  }
}

// ============ Tier 1: JSON-LD Extraction ============

interface JsonLdPerson {
  '@type': string;
  name?: string;
  jobTitle?: string;
  description?: string;
  address?: { addressLocality?: string; addressCountry?: string; addressRegion?: string };
  worksFor?:
    | Array<{ name?: string; jobTitle?: string; location?: string }>
    | { name?: string; jobTitle?: string; location?: string };
  alumniOf?: Array<{ name?: string }> | { name?: string };
  hasOccupation?: Array<{ name?: string; occupation?: string }>;
  knowsAbout?: string[];
  sameAs?: string[];
  image?: string;
  url?: string;
}

function parseJsonLd(html: string): { person: JsonLdPerson | null; confidence: number } {
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const jsonText = match[1].trim();
      const data = JSON.parse(jsonText);

      // Handle ProfilePage shape: ProfilePage -> mainEntity -> Person
      if (data['@type'] === 'ProfilePage' && data.mainEntity) {
        const person = data.mainEntity;
        if (person['@type'] === 'Person' || person.name) {
          return { person, confidence: 1.0 };
        }
      }

      // Handle bare Person shape
      if (data['@type'] === 'Person') {
        return { person: data, confidence: 1.0 };
      }

      // Handle nested @graph
      if (Array.isArray(data['@graph'])) {
        for (const item of data['@graph']) {
          if (item['@type'] === 'ProfilePage' && item.mainEntity) {
            return { person: item.mainEntity, confidence: 1.0 };
          }
          if (item['@type'] === 'Person') {
            return { person: item, confidence: 1.0 };
          }
        }
      }
    } catch {
      // Invalid JSON-LD, skip
    }
  }

  return { person: null, confidence: 0 };
}

function extractFromJsonLd(person: JsonLdPerson): ExtractedLinkedInProfile {
  const profile: ExtractedLinkedInProfile = {
    experience: [],
    education: [],
    skills: [],
  };

  profile.name = person.name;

  // Handle jobTitle — can be string, or array of strings (LinkedIn sometimes emits empty-string arrays)
  if (person.jobTitle) {
    if (Array.isArray(person.jobTitle)) {
      const nonEmpty = person.jobTitle.filter((t) => typeof t === 'string' && t.trim().length > 0);
      if (nonEmpty.length > 0) {
        profile.headline = nonEmpty[0];
      }
    } else if (typeof person.jobTitle === 'string' && person.jobTitle.trim()) {
      profile.headline = person.jobTitle;
    }
  }

  if (person.description) {
    profile.about = person.description;
  }

  if (person.address) {
    const parts = [
      person.address.addressLocality,
      person.address.addressRegion,
      person.address.addressCountry,
    ].filter(Boolean);
    if (parts.length > 0) {
      profile.location = parts.join(', ');
    }
  }

  // Parse worksFor (can be array or single object, entries may lack names)
  if (person.worksFor) {
    const worksForArr = Array.isArray(person.worksFor) ? person.worksFor : [person.worksFor];
    for (const org of worksForArr) {
      if (org.name && org.name.trim()) {
        const exp: LinkedInExperienceItem = {
          company: org.name,
          title: org.jobTitle || profile.headline || 'Role',
        };
        if (org.location) exp.location = org.location;
        profile.experience.push(exp);
      }
    }
  }

  // Parse alumniOf (can be array or single object)
  if (person.alumniOf) {
    const alumniOfArr = Array.isArray(person.alumniOf) ? person.alumniOf : [person.alumniOf];
    for (const org of alumniOfArr) {
      if (org.name) {
        profile.education.push({ institution: org.name });
      }
    }
  }

  // Parse hasOccupation for additional experience
  if (person.hasOccupation) {
    for (const occ of person.hasOccupation) {
      if (occ.name) {
        profile.experience.push({
          company: occ.name,
          title: occ.occupation || 'Role',
        });
      }
    }
  }

  // Parse knowsAbout for skills
  if (person.knowsAbout && Array.isArray(person.knowsAbout)) {
    profile.skills = person.knowsAbout.filter((s) => typeof s === 'string' && s.length < 80);
  }

  return profile;
}

function tryJsonLdTier(html: string): ExtractionResult | null {
  const { person, confidence } = parseJsonLd(html);
  if (!person) return null;

  const profile = extractFromJsonLd(person);
  const hasData = profile.name || profile.headline || profile.experience.length > 0;

  if (!hasData) return null;

  // Downgrade confidence if we only got partial data
  let adjustedConfidence = confidence;
  if (!profile.experience.length && !profile.education.length) {
    adjustedConfidence = Math.min(confidence, 0.7);
  }

  return { profile, confidence: adjustedConfidence, extractionPath: 'jsonld' };
}

// ============ Tier 2: OG Meta Tag Extraction ============

function tryOgMetaTier(html: string): ExtractionResult | null {
  let name: string | undefined;
  let headline: string | undefined;
  let location: string | undefined;

  // OG meta tags are always in <head>, so only search first 10KB to avoid
  // catastrophic backtracking with lazy quantifiers on large authenticated HTML
  const headHtml = html.slice(0, 10000);

  // og:title format is typically "Name - Headline | LinkedIn"
  const ogTitle =
    headHtml.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1] ||
    headHtml.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i)?.[1];

  if (ogTitle) {
    const parts = ogTitle.split(/\s*[-–|]\s*/);
    if (parts[0]) name = parts[0].trim();
    if (parts[1]) headline = parts[1].trim();
  }

  // og:description often has "Name, Title at Company - Location - LinkedIn"
  const ogDesc =
    headHtml.match(
      /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i
    )?.[1] ||
    headHtml.match(
      /<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["']/i
    )?.[1] ||
    headHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ||
    headHtml.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1];

  if (ogDesc && !headline) {
    headline = ogDesc.slice(0, 200);
  }

  if (!name) return null;

  return {
    profile: {
      name,
      headline,
      location,
      experience: [],
      education: [],
      skills: [],
    },
    confidence: 0.5,
    extractionPath: 'og-meta',
  };
}

// ============ Tier 3: Browser Extraction ============

const MONTH_RE = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const DATE_RANGE_RE = new RegExp(
  `(${MONTH_RE}\\s+\\d{4})\\s*[-–]\\s*(${MONTH_RE}\\s+\\d{4}|Present)`,
  'i'
);
const DATE_LINE_RE = new RegExp(`${MONTH_RE}\\s+\\d{4}`, 'i');
const EMPLOYMENT_TYPE_RE = /^(?:Full-time|Part-time|Contract|Internship|Self-employed|Freelance)/i;
const SECTION_BREAK_RE =
  /^(?:Show all|Show more|Featured|Activity|Interests|Services|Recommendations|Top Voices|Companies|Newsletters|Schools|Profile language|Public profile|Who your viewers|People you may|Pages for you|You might like)$/i;
const SKILLS_TAG_RE = /\band \+\d+ skills?$/i;

/**
 * Parses LinkedIn profile data from raw body text.
 * Used as a fallback when DOM selectors fail (common with authenticated LinkedIn pages).
 *
 * LinkedIn authenticated body text structure:
 * - Experience section lists companies, with roles under each
 * - Each role has a date line like "Feb 2026 - Present · 6 mos"
 * - Title sits 1-2 lines above the date line
 * - Company name appears above the first role (may span multiple roles)
 */
export function parseProfileFromBodyText(text: string): ExtractedLinkedInProfile {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const profile: ExtractedLinkedInProfile = { experience: [], education: [], skills: [] };

  const skipPatterns =
    /^(Home|My Network|Jobs|Messaging|Notifications|Me|For Business|Skip to .+|Retry for .+|\d+|Verify in \d+ minutes?|Show details|Get started|Suggested for you|Private to you|Past 7 days|This page isn.?t working)$/i;

  // Find name: first substantial non-nav line
  for (const line of lines) {
    if (skipPatterns.test(line)) continue;
    if (
      line.length > 2 &&
      line.length < 60 &&
      !line.includes('·') &&
      !line.includes('Show') &&
      !/^\d/.test(line)
    ) {
      profile.name = line;
      break;
    }
  }

  // Find headline: next meaningful line after name (skip duplicates of name, nav items)
  if (profile.name) {
    const nameIdx = lines.indexOf(profile.name);
    // Look for the second occurrence of the name (profile card) and take what follows
    let secondNameIdx = -1;
    for (let i = nameIdx + 1; i < Math.min(nameIdx + 20, lines.length); i++) {
      if (lines[i] === profile.name) {
        secondNameIdx = i;
        break;
      }
    }
    const searchFrom = secondNameIdx >= 0 ? secondNameIdx + 1 : nameIdx + 1;
    for (let i = searchFrom; i < Math.min(searchFrom + 5, lines.length); i++) {
      const line = lines[i];
      if (skipPatterns.test(line) || line === profile.name) continue;
      if (line.length > 3 && line.length < 100 && !line.includes('·') && !/^\d/.test(line)) {
        profile.headline = line;
        break;
      }
    }
  }

  // Find location: "City, Region" pattern or a known place / work-mode token.
  // The City,Region pattern already covers "Lagos, Nigeria" / "San Francisco, CA".
  // The country list below is only for standalone tokens like "Nigeria" or "Remote".
  const countries =
    /^(?:Canada|United States|United Kingdom|Germany|France|India|Nigeria|Remote|Hybrid|On-site|Japan|Brazil|Australia|Singapore|Netherlands|Ireland|Kenya|South Africa|Mexico|Italy|Spain|Poland|Sweden|Switzerland|Austria|Belgium|Denmark|Norway|Finland|Portugal|Greece|Turkey|Israel|UAE|United Arab Emirates|Saudi Arabia|Egypt|Ghana|Ethiopia|Uganda|Tanzania|Rwanda|Cameroon|Senegal|Ivory Coast|Morocco|Algeria|Tunisia|Argentina|Chile|Colombia|Peru|Venezuela|Uruguay|Ecuador|Paraguay|Bolivia|Costa Rica|Panama|Guatemala|Philippines|Indonesia|Malaysia|Vietnam|Thailand|South Korea|China|Hong Kong|Taiwan|New Zealand|Pakistan|Bangladesh|Sri Lanka|Nepal|Ukraine|Romania|Hungary|Czech Republic|Czechia|Slovakia|Bulgaria|Croatia|Lithuania|Latvia|Estonia|Georgia|Armenia|Azerbaijan|Kazakhstan)$/i;
  for (const line of lines) {
    if (
      /^[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*(?:,\s*[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*)+$/.test(
        line
      ) ||
      countries.test(line)
    ) {
      profile.location = line;
      break;
    }
  }

  // Find about section
  const aboutIdx = lines.findIndex((l) => l === 'About');
  if (aboutIdx >= 0) {
    const aboutLines: string[] = [];
    for (let i = aboutIdx + 1; i < Math.min(aboutIdx + 50, lines.length); i++) {
      const line = lines[i];
      if (
        /^(?:Top skills|Experience|Education|Skills|Featured|Activity|Show all|… more)$/.test(line)
      )
        break;
      aboutLines.push(line);
    }
    if (aboutLines.length > 0) {
      profile.about = aboutLines
        .join(' ')
        .replace(/\s*…\s*more$/, '')
        .trim();
    }
  }

  // Find Top skills section (first occurrence, before Experience)
  const topSkillsIdx = lines.findIndex((l) => /^Top skills$/i.test(l));
  if (topSkillsIdx >= 0) {
    for (let i = topSkillsIdx + 1; i < Math.min(topSkillsIdx + 5, lines.length); i++) {
      const line = lines[i];
      if (/^(?:Services|Featured|Activity|Show all|Experience)$/i.test(line)) break;
      const parts = line
        .split(/•|,/)
        .map((s) => s.trim())
        .filter((s) => s.length > 1 && s.length < 60);
      if (parts.length > 0) {
        profile.skills.push(...parts);
      }
    }
  }

  // Also check "Skills (N)" section at the bottom for a more complete list
  if (profile.skills.length === 0) {
    const skillsIdx = lines.findIndex((l) => /^Skills\s*\(\d+\)$/i.test(l));
    if (skillsIdx >= 0) {
      for (let i = skillsIdx + 1; i < Math.min(skillsIdx + 60, lines.length); i++) {
        const line = lines[i];
        if (SECTION_BREAK_RE.test(line)) break;
        // Skip "Show all" and navigation-like items
        if (/^Show all$/.test(line)) break;
        // Individual skill lines in the skills section (not section headers)
        if (
          line.length > 2 &&
          line.length < 60 &&
          !DATE_LINE_RE.test(line) &&
          !EMPLOYMENT_TYPE_RE.test(line)
        ) {
          // Skip lines that look like section headers or navigation
          if (
            /^(?:About|Experience|Education|Featured|Activity|Interests|Recommendations|Connected apps|Projects|Volunteering|Licenses|Publications)$/i.test(
              line
            )
          )
            break;
          profile.skills.push(line);
        }
      }
    }
  }

  // Find experience section
  const expIdx = lines.findIndex((l) => l === 'Experience');
  if (expIdx >= 0) {
    // Collect all lines in the experience section
    const expLines: string[] = [];
    for (let i = expIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (
        /^(?:Education|Skills|Featured|Activity|Interests|Show all|Recommendations|Licenses)$/i.test(
          line
        )
      )
        break;
      expLines.push(line);
    }

    // Strategy: find all date-range lines as anchors, then extract title/company from context
    let currentCompany = '';

    for (let i = 0; i < expLines.length; i++) {
      const line = expLines[i];

      // Check if this is a date range line (the most reliable anchor)
      const dateMatch = line.match(DATE_RANGE_RE);
      if (!dateMatch) continue;

      const startDate = dateMatch[1];
      const endDate = dateMatch[2];

      // Extract title: look backwards from the date line
      // LinkedIn format puts title 1-2 lines before the date line
      let title = '';
      let company = currentCompany;

      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        const prev = expLines[j];
        if (!prev || prev === line) continue;
        // Skip empty-ish lines, employment types, date lines, locations
        if (DATE_LINE_RE.test(prev)) break;
        if (EMPLOYMENT_TYPE_RE.test(prev)) {
          // Employment type line — company might be above this
          // e.g., "Port IO · Contract" → company is "Port IO"
          const companyMatch = prev.match(
            /^(.+?)\s*·\s*(?:Full-time|Part-time|Contract|Internship)/i
          );
          if (companyMatch) company = companyMatch[1].trim();
          continue;
        }
        if (SKILLS_TAG_RE.test(prev)) continue;
        // Skip location-like lines
        if (/^(?:Remote|Hybrid|On-site|In-person)$/i.test(prev)) continue;
        if (/^[A-Z][a-z]+(?:,?\s*[A-Z][a-z]+)*\s*·\s*(?:Remote|Hybrid|On-site)$/i.test(prev))
          continue;
        if (
          /^(?:\+\d+ more|Mountain View.+| Lagos State.+|.+United States|.+Nigeria.+)$/i.test(prev)
        )
          continue;

        // This is likely the title
        if (!title) {
          title = prev.replace(EMPLOYMENT_TYPE_RE, '').trim();
        } else {
          // Second line back might be the company
          if (
            prev.length > 1 &&
            prev.length < 60 &&
            !SKILLS_TAG_RE.test(prev) &&
            !EMPLOYMENT_TYPE_RE.test(prev) &&
            !/^(?:Remote|Hybrid|On-site)$/i.test(prev)
          ) {
            company = prev;
          }
          break;
        }
      }

      // Also check if the line above the title is a company name (multi-role under same company)
      // If title was found but company is still empty, look further back
      if (title && !company) {
        for (let j = i - 2; j >= Math.max(0, i - 6); j--) {
          const prev = expLines[j];
          if (!prev || DATE_LINE_RE.test(prev) || EMPLOYMENT_TYPE_RE.test(prev)) break;
          if (
            prev.length > 1 &&
            prev.length < 60 &&
            !SKILLS_TAG_RE.test(prev) &&
            !/^(?:Remote|Hybrid|On-site)$/i.test(prev)
          ) {
            company = prev;
            break;
          }
        }
      }

      // Update current company for subsequent roles at same company
      if (company) currentCompany = company;

      if (title) {
        const exp: LinkedInExperienceItem = {
          title: title.replace(EMPLOYMENT_TYPE_RE, '').trim(),
          company: company || 'Unknown',
          startDate,
          endDate,
        };

        // Avoid duplicates
        if (
          !profile.experience.some(
            (e) =>
              e.title === exp.title && e.company === exp.company && e.startDate === exp.startDate
          )
        ) {
          profile.experience.push(exp);
        }
      }
    }
  }

  // Find education section
  const eduIdx = lines.findIndex((l) => l === 'Education');
  if (eduIdx >= 0) {
    for (let i = eduIdx + 1; i < Math.min(eduIdx + 30, lines.length); i++) {
      const line = lines[i];
      if (SECTION_BREAK_RE.test(line)) break;
      if (/^(?:Skills|Projects|Volunteering|Licenses|Recommendations|Interests)$/i.test(line))
        break;

      // Education entries: Institution, Degree, Dates, Grade
      // e.g., "Ladoke Akintola University of Technology Software Engineering Institute"
      //        "Bachelor of Technology - BTech, Computer Science and Engineering"
      //        "2018 – 2023"
      //        "Grade: Second Class Honours (Upper Division)"

      // Look for year ranges to identify education entries
      if (
        /\b20\d{2}\s*[–-]\s*20\d{2}\b/.test(line) ||
        /\b20\d{2}\s*[–-]\s*(?:Present|Current)\b/i.test(line)
      ) {
        // This is a date line — look back for institution and degree
        let institution = '';
        let degree = '';
        let startDate = '';
        let endDate = '';

        const dateRangeMatch = line.match(/(\d{4})\s*[–-]\s*(\d{4}|Present)/i);
        if (dateRangeMatch) {
          startDate = dateRangeMatch[1];
          endDate = dateRangeMatch[2];
        }

        // Look back for degree and institution
        for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
          const prev = lines[j];
          if (!prev || SECTION_BREAK_RE.test(prev)) break;
          if (/^(?:Grade:|Activities|Connected|Show all)$/i.test(prev)) break;

          if (
            !degree &&
            (prev.includes('Bachelor') ||
              prev.includes('Master') ||
              prev.includes('PhD') ||
              prev.includes('Certificate') ||
              prev.includes('Diploma') ||
              prev.includes('Associate') ||
              prev.includes('BTech') ||
              prev.includes('BSc') ||
              prev.includes('MSc') ||
              prev.includes('B.A.') ||
              prev.includes('M.A.'))
          ) {
            degree = prev;
          } else if (!institution && prev.length > 1 && prev.length < 120) {
            if (/^(?:Education|Experience|Skills|About)$/i.test(prev)) break;
            institution = prev;
          }
        }

        if (institution) {
          const edu: LinkedInEducationItem = { institution };
          if (degree) edu.degree = degree;
          if (startDate) edu.startDate = startDate;
          if (endDate) edu.endDate = endDate;
          if (!profile.education.some((e) => e.institution === institution)) {
            profile.education.push(edu);
          }
        }
      }
    }
  }

  return profile;
}

async function fetchHtmlViaHttp(url: string): Promise<string | null> {
  // Try without cookie first (for public profile extraction), then with cookie as fallback.
  // Dedupe so we don't fire the same unauthenticated request twice when no cookie exists.
  const cookie = getLinkedInCookieString();
  const attempts = cookie ? [null, cookie] : [null];
  for (const attemptCookie of attempts) {
    const ua = pickRandom(DESKTOP_UAS);
    try {
      const headers: Record<string, string> = {
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
      };
      if (attemptCookie) {
        headers['Cookie'] = attemptCookie;
      }

      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });

      if (!res.ok) continue;
      const html = await res.text();
      // Only accept responses with meaningful content
      if (html.length > 500) return html;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchHtmlViaSocialPreview(url: string): Promise<string | null> {
  // Social-preview UA does NOT use cookies — it's designed for public profile extraction
  // Sending cookies with this UA causes LinkedIn to reject the request
  try {
    const headers: Record<string, string> = {
      'User-Agent': SOCIAL_PREVIEW_UA,
      Accept: 'text/html',
    };

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });

    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function tryBrowserTier(url: string): Promise<ExtractionResult | null> {
  let browserSession: Awaited<
    ReturnType<typeof import('../core/browser-manager').browserManager.createSession>
  > | null = null;

  try {
    const { browserManager } = await import('../core/browser-manager');
    browserSession = await browserManager.createSession('linkedin', url);

    // Resolve stored cookies lazily — the first navigation is intentionally
    // WITHOUT cookies to avoid redirect loops from incomplete sessions.
    // Cookies are only injected below if we hit an authwall.
    const cookies = getLinkedInCookies();

    const { page } = browserSession;

    // First try WITHOUT cookies to avoid redirect loops from incomplete cookies.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
    // Wait for any post-load redirects (LinkedIn bot detection → JS redirect to authwall)
    await new Promise((r) => setTimeout(r, 2000));

    // Check for authwall or login redirect (URL and page content)
    let currentUrl = page.url();
    const pageTitle = await page.title().catch(() => '');
    const isAuthPage =
      currentUrl.includes('/authwall') ||
      currentUrl.includes('/login') ||
      currentUrl.includes('/signup') ||
      currentUrl.includes('/checkpoint') ||
      /^(Sign Up|Log In|Join LinkedIn)/i.test(pageTitle);
    if (isAuthPage) {
      // Try with cookies only if we have the FULL set (from storage state, not just li_at from env).
      // li_at alone causes redirect loops in browsers - LinkedIn needs the full session.
      if (cookies.length > 1) {
        try {
          await browserSession.context.addCookies(cookies);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
          currentUrl = page.url();
        } catch {
          // Cookie injection failed
        }
      }
      const pageTitle2 = await page.title().catch(() => '');
      if (
        currentUrl.includes('/authwall') ||
        currentUrl.includes('/login') ||
        currentUrl.includes('/signup') ||
        currentUrl.includes('/checkpoint') ||
        /^(Sign Up|Log In|Join LinkedIn)/i.test(pageTitle2)
      ) {
        return null;
      }
    }

    // Randomized scrolling to trigger lazy-loaded sections
    // LinkedIn SPA uses #workspace as the scroll container, not the body
    const scrollSteps = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < scrollSteps; i++) {
      const scrollAmount = 400 + Math.floor(Math.random() * 600);
      await page.evaluate((amount) => {
        const workspace = document.getElementById('workspace') || document.scrollingElement;
        if (workspace) workspace.scrollTop += amount;
      }, scrollAmount);
      await randomDelay(600, 1200);
    }

    const extracted = await page.evaluate((selectors) => {
      function queryText(selectorStr: string): string | null {
        const selectors = selectorStr.split(',').map((s) => s.trim());
        for (const sel of selectors) {
          try {
            const el = document.querySelector(sel);
            if (el) {
              const text = el.textContent?.trim();
              if (text) return text;
            }
          } catch {
            continue;
          }
        }
        return null;
      }

      // Name
      const name = queryText(selectors.name);

      // Headline
      const headline = queryText(selectors.headline);

      // Location
      const location = queryText(selectors.location);

      // About
      const aboutSection = document.querySelector(selectors.aboutSection);
      const aboutText = aboutSection?.textContent?.replace(/^About\s*/i, '').trim() || null;

      // Experience
      const expItems: Array<{
        title: string;
        company: string;
        location?: string;
        startDate?: string;
        endDate?: string;
        description?: string;
      }> = [];
      const expSection = document.querySelector(selectors.experienceSection);
      if (expSection) {
        const expNodes = expSection.querySelectorAll('li.artdeco-list__item, li');
        expNodes.forEach((node) => {
          const lines = (node.textContent || '')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          if (lines.length >= 2) {
            const title = lines[0];
            const company = lines[1];
            let dateStr: string | undefined;
            let desc: string | undefined;

            for (let i = 2; i < lines.length; i++) {
              if (/\d{4}|present|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(lines[i])) {
                dateStr = lines[i];
                break;
              }
            }

            if (lines.length > 3 && !dateStr) {
              desc = lines.slice(2).join(' ');
            } else if (lines.length > 3) {
              desc = lines.slice(lines.findIndex((l) => l === dateStr) + 1).join(' ');
            }

            let startDate: string | undefined;
            let endDate: string | undefined;
            if (dateStr) {
              const parts = dateStr.split(/–|-|to/i);
              if (parts[0]) startDate = parts[0].trim();
              if (parts[1]) endDate = parts[1].trim();
            }

            expItems.push({ title, company, startDate, endDate, description: desc });
          }
        });
      }

      // Education
      const eduItems: Array<{
        institution: string;
        degree?: string;
        field?: string;
        startDate?: string;
        endDate?: string;
      }> = [];
      const eduSection = document.querySelector(selectors.educationSection);
      if (eduSection) {
        const eduNodes = eduSection.querySelectorAll('li.artdeco-list__item, li');
        eduNodes.forEach((node) => {
          const lines = (node.textContent || '')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          if (lines.length >= 1) {
            eduItems.push({
              institution: lines[0],
              degree: lines[1],
            });
          }
        });
      }

      // Skills
      const skills: string[] = [];
      const skillsSection = document.querySelector(selectors.skillsSection);
      if (skillsSection) {
        const skillNodes = skillsSection.querySelectorAll('span[aria-hidden="true"]');
        skillNodes.forEach((s) => {
          const text = s.textContent?.trim() || '';
          if (text && text.length < 80) skills.push(text);
        });
      }

      const rawText = document.body.innerText.slice(0, 5000);

      return {
        name,
        headline,
        location,
        about: aboutText,
        experience: expItems,
        education: eduItems,
        skills,
        rawText,
      };
    }, SEMANTIC_SELECTORS);

    // If DOM selectors returned nothing meaningful, fall back to body text parsing
    // (authenticated LinkedIn pages use a different DOM structure without h1/section IDs)
    const hasDomData = extracted.name || extracted.headline || extracted.experience.length > 0;
    if (!hasDomData) {
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 25000));
      const parsed = parseProfileFromBodyText(bodyText);
      if (parsed.name) {
        return {
          profile: parsed,
          confidence: 0.7,
          extractionPath: 'browser',
        };
      }
    }

    if (!extracted.name && extracted.experience.length === 0 && !extracted.headline) {
      return null;
    }

    // Convert null to undefined for type compatibility
    const profile: ExtractedLinkedInProfile = {
      name: extracted.name ?? undefined,
      headline: extracted.headline ?? undefined,
      location: extracted.location ?? undefined,
      about: extracted.about ?? undefined,
      experience: extracted.experience,
      education: extracted.education,
      skills: extracted.skills,
      rawText: extracted.rawText ?? undefined,
    };

    // Calculate confidence based on data completeness
    let confidence = 0.6; // Base browser confidence
    if (profile.name && profile.headline) confidence = 0.8;
    if (profile.experience.length > 0) confidence = 0.9;
    if (profile.education.length > 0) confidence = 0.95;

    return {
      profile,
      confidence,
      extractionPath: 'browser',
    };
  } catch (err) {
    logger.debug(`Browser extraction failed for ${url}: ${err}`, {}, 'api');
    return null;
  } finally {
    if (browserSession) {
      await browserSession.release().catch(() => {});
    }
  }
}

// ============ Main Entry Point ============

/**
 * Scrapes detailed LinkedIn profile information using a 3-tier extraction strategy:
 * 1. HTTP + JSON-LD (fastest, safest, ~60-70% coverage)
 * 2. HTTP + OG meta tags (sub-second, partial data)
 * 3. Patchright browser + stealth (full profile, slower)
 *
 * Returns an ExtractionResult with confidence score indicating data completeness.
 */
export async function scrapeLinkedInProfile(url: string): Promise<ExtractedLinkedInProfile> {
  const result = await scrapeLinkedInProfileDetailed(url);
  return result.profile;
}

/**
 * Extended version that returns the full ExtractionResult with confidence scoring.
 */
export async function scrapeLinkedInProfileDetailed(url: string): Promise<ExtractionResult> {
  const cleanUrl = normalizeLinkedInUrl(url);

  // Tier 1: Try social-preview UA first (highest success rate for public data)
  const socialHtml = await fetchHtmlViaSocialPreview(cleanUrl);
  if (socialHtml) {
    const jsonLdResult = tryJsonLdTier(socialHtml);
    if (jsonLdResult) {
      logger.info(
        `LinkedIn profile extracted via JSON-LD (confidence: ${jsonLdResult.confidence}) for ${cleanUrl}`,
        {},
        'api'
      );
      return jsonLdResult;
    }

    const ogResult = tryOgMetaTier(socialHtml);
    if (ogResult) {
      logger.info(`LinkedIn profile extracted via OG meta for ${cleanUrl}`, {}, 'api');
      return ogResult;
    }
  }

  // Tier 1b: Try standard desktop UA
  const desktopHtml = await fetchHtmlViaHttp(cleanUrl);
  if (desktopHtml) {
    const jsonLdResult = tryJsonLdTier(desktopHtml);
    if (jsonLdResult) {
      logger.info(
        `LinkedIn profile extracted via JSON-LD (desktop UA, confidence: ${jsonLdResult.confidence}) for ${cleanUrl}`,
        {},
        'api'
      );
      return jsonLdResult;
    }

    const ogResult = tryOgMetaTier(desktopHtml);
    if (ogResult) {
      logger.info(`LinkedIn profile extracted via OG meta (desktop UA) for ${cleanUrl}`, {}, 'api');
      return ogResult;
    }
  }

  // Tier 2: Social-preview HTML had data but JSON-LD/OG failed — try raw body text
  // Skip for large HTML (>200KB) — likely an authenticated SPA page with no useful body text
  const sourceHtml = socialHtml || desktopHtml;
  if (sourceHtml && sourceHtml.length < 200_000) {
    const bodyText = sourceHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (bodyText.length > 100) {
      // Attempt basic name extraction from body text
      const nameMatch = bodyText.match(/^([^,|–-]+?)(?:\s*[,|–-]|\s+on\s+LinkedIn)/i);
      if (nameMatch) {
        return {
          profile: {
            name: nameMatch[1].trim(),
            rawText: bodyText.slice(0, 2000),
            experience: [],
            education: [],
            skills: [],
          },
          confidence: 0.3,
          extractionPath: 'text-fallback',
        };
      }
    }
  }

  // Tier 3: Browser extraction
  const browserResult = await tryBrowserTier(cleanUrl);
  if (browserResult) {
    logger.info(
      `LinkedIn profile extracted via browser (confidence: ${browserResult.confidence}) for ${cleanUrl}`,
      {},
      'api'
    );
    return browserResult;
  }

  // All tiers failed
  return {
    profile: { experience: [], education: [], skills: [] },
    confidence: 0,
    extractionPath: 'failed',
  };
}

// ============ Formatting ============

/**
 * Formats an ExtractedLinkedInProfile into clean Markdown text for prompt context
 */
export function formatLinkedInProfileContext(
  profile: ExtractedLinkedInProfile,
  url: string
): string {
  const parts: string[] = [`LinkedIn Profile (${url}):`];

  if (profile.name) parts.push(`- Full Name: ${profile.name}`);
  if (profile.headline) parts.push(`- Headline / Current Role: ${profile.headline}`);
  if (profile.location) parts.push(`- Location: ${profile.location}`);
  if (profile.about) parts.push(`- About / Summary: ${profile.about}`);

  if (profile.experience.length > 0) {
    parts.push('- Work Experience:');
    profile.experience.forEach((exp) => {
      const dates = exp.startDate
        ? ` (${exp.startDate}${exp.endDate ? ` - ${exp.endDate}` : ''})`
        : '';
      const loc = exp.location ? ` - ${exp.location}` : '';
      const desc = exp.description ? `\n  Details: ${exp.description}` : '';
      parts.push(`  * ${exp.title} at ${exp.company}${dates}${loc}${desc}`);
    });
  }

  if (profile.education.length > 0) {
    parts.push('- Education:');
    profile.education.forEach((edu) => {
      const degree = edu.degree ? ` (${edu.degree}${edu.field ? ` in ${edu.field}` : ''})` : '';
      parts.push(`  * ${edu.institution}${degree}`);
    });
  }

  if (profile.skills.length > 0) {
    parts.push(`- Skills: ${profile.skills.join(', ')}`);
  }

  if (parts.length === 1 && profile.rawText) {
    parts.push(`- Snippet: ${profile.rawText.slice(0, 1000)}`);
  }

  return parts.join('\n');
}
