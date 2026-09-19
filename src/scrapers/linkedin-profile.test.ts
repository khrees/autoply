import { describe, expect, test } from 'bun:test';
import {
  normalizeLinkedInUrl,
  formatLinkedInProfileContext,
  parseProfileFromBodyText,
  scrapeLinkedInProfileDetailed,
  type ExtractedLinkedInProfile,
} from './linkedin-profile';

// Helper to mock globalThis.fetch with a simple handler
function mockFetch(handler: (url: string | URL | Request) => Response): void {
  globalThis.fetch = handler as unknown as typeof globalThis.fetch;
}

// ============ HTML Fixtures ============

const JSONLD_PERSON_HTML = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@type": "Person",
    "name": "Jane Smith",
    "jobTitle": "Senior Software Engineer",
    "description": "Building scalable distributed systems.",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "San Francisco",
      "addressRegion": "CA",
      "addressCountry": "US"
    },
    "worksFor": [
      { "@type": "Organization", "name": "Stripe", "jobTitle": "Senior Software Engineer" },
      { "@type": "Organization", "name": "Google", "jobTitle": "Software Engineer" }
    ],
    "alumniOf": [
      { "@type": "Organization", "name": "MIT" }
    ],
    "knowsAbout": ["TypeScript", "Rust", "Distributed Systems", "Kubernetes"]
  }
  </script>
  <meta property="og:title" content="Jane Smith - Senior Software Engineer | LinkedIn" />
  <meta property="og:description" content="Jane Smith, Senior Software Engineer at Stripe" />
</head>
<body><h1>Jane Smith</h1></body>
</html>`;

const JSONLD_PROFILE_PAGE_HTML = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@type": "ProfilePage",
    "mainEntity": {
      "@type": "Person",
      "name": "Bob Johnson",
      "jobTitle": "Staff Engineer",
      "worksFor": { "@type": "Organization", "name": "Netflix" },
      "alumniOf": { "@type": "Organization", "name": "Stanford University" }
    }
  }
  </script>
</head>
<body><h1>Bob Johnson</h1></body>
</html>`;

const JSONLD_GRAPH_HTML = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@graph": [
      { "@type": "WebPage", "name": "Profile" },
      {
        "@type": "Person",
        "name": "Alice Chen",
        "jobTitle": "ML Engineer",
        "worksFor": [{ "@type": "Organization", "name": "OpenAI" }]
      }
    ]
  }
  </script>
</head>
<body><h1>Alice Chen</h1></body>
</html>`;

const OG_META_ONLY_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="Carlos Rivera - Product Manager | LinkedIn" />
  <meta property="og:description" content="Carlos Rivera, Product Manager at Meta - Menlo Park, California" />
</head>
<body><h1>Carlos Rivera</h1></body>
</html>`;

const PARTIAL_PERSON_HTML = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@type": "Person",
    "name": "Dave Wilson"
  }
  </script>
</head>
<body><h1>Dave Wilson</h1></body>
</html>`;

// ============ normalizeLinkedInUrl ============

describe('normalizeLinkedInUrl', () => {
  test('strips query params and trailing slashes', () => {
    expect(normalizeLinkedInUrl('https://linkedin.com/in/johndoe/?utm_source=share')).toBe(
      'https://linkedin.com/in/johndoe'
    );
  });

  test('preserves clean URLs', () => {
    expect(normalizeLinkedInUrl('https://www.linkedin.com/in/johndoe')).toBe(
      'https://www.linkedin.com/in/johndoe'
    );
  });

  test('handles URLs with hash fragments', () => {
    expect(normalizeLinkedInUrl('https://linkedin.com/in/johndoe#experience')).toBe(
      'https://linkedin.com/in/johndoe'
    );
  });

  test('returns non-LinkedIn URLs unchanged', () => {
    expect(normalizeLinkedInUrl('https://github.com/johndoe')).toBe('https://github.com/johndoe');
  });

  test('returns invalid URLs as-is', () => {
    expect(normalizeLinkedInUrl('not-a-url')).toBe('not-a-url');
  });
});

// ============ formatLinkedInProfileContext ============

describe('formatLinkedInProfileContext', () => {
  const profile: ExtractedLinkedInProfile = {
    name: 'Jane Smith',
    headline: 'Senior Software Engineer at Stripe',
    location: 'San Francisco, CA',
    about: 'Building scalable distributed systems.',
    experience: [
      {
        title: 'Senior Software Engineer',
        company: 'Stripe',
        startDate: 'Jan 2022',
        endDate: 'Present',
        location: 'San Francisco, CA',
      },
      {
        title: 'Software Engineer',
        company: 'Google',
        startDate: 'Jun 2019',
        endDate: 'Dec 2021',
      },
    ],
    education: [{ institution: 'MIT', degree: 'BS', field: 'Computer Science' }],
    skills: ['TypeScript', 'Rust', 'Distributed Systems'],
  };

  test('formats full profile with all fields', () => {
    const result = formatLinkedInProfileContext(profile, 'https://linkedin.com/in/janesmith');
    expect(result).toContain('Jane Smith');
    expect(result).toContain('Senior Software Engineer at Stripe');
    expect(result).toContain('San Francisco, CA');
    expect(result).toContain('Building scalable distributed systems');
    expect(result).toContain('Stripe');
    expect(result).toContain('Google');
    expect(result).toContain('MIT');
    expect(result).toContain('TypeScript');
  });

  test('formats dates correctly', () => {
    const result = formatLinkedInProfileContext(profile, 'https://linkedin.com/in/janesmith');
    expect(result).toContain('Jan 2022 - Present');
    expect(result).toContain('Jun 2019 - Dec 2021');
  });

  test('handles minimal profile', () => {
    const minimal: ExtractedLinkedInProfile = {
      experience: [],
      education: [],
      skills: [],
    };
    const result = formatLinkedInProfileContext(minimal, 'https://linkedin.com/in/janesmith');
    expect(result).toContain('LinkedIn Profile');
    // Should not crash or produce empty bullets
  });

  test('includes rawText fallback when no other data', () => {
    const rawOnly: ExtractedLinkedInProfile = {
      experience: [],
      education: [],
      skills: [],
      rawText: 'Some raw text from the page that provides context',
    };
    const result = formatLinkedInProfileContext(rawOnly, 'https://linkedin.com/in/janesmith');
    expect(result).toContain('Some raw text from the page');
  });
});

// ============ JSON-LD Extraction (via mocked fetch) ============

describe('scrapeLinkedInProfileDetailed - JSON-LD tier', () => {
  test('extracts from bare Person JSON-LD', async () => {
    const originalFetch = globalThis.fetch;
    mockFetch(
      () =>
        new Response(JSONLD_PERSON_HTML, { status: 200, headers: { 'content-type': 'text/html' } })
    );

    try {
      const result = await scrapeLinkedInProfileDetailed('https://linkedin.com/in/janesmith');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.extractionPath).toBe('jsonld');
      expect(result.profile.name).toBe('Jane Smith');
      expect(result.profile.headline).toBe('Senior Software Engineer');
      expect(result.profile.location).toContain('San Francisco');
      expect(result.profile.experience.length).toBeGreaterThanOrEqual(1);
      expect(result.profile.education.length).toBe(1);
      expect(result.profile.skills).toContain('TypeScript');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('extracts from ProfilePage.mainEntity JSON-LD', async () => {
    const originalFetch = globalThis.fetch;
    mockFetch(
      () =>
        new Response(JSONLD_PROFILE_PAGE_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
    );

    try {
      const result = await scrapeLinkedInProfileDetailed('https://linkedin.com/in/bobjohnson');
      expect(result.extractionPath).toBe('jsonld');
      expect(result.profile.name).toBe('Bob Johnson');
      expect(result.profile.headline).toBe('Staff Engineer');
      expect(result.profile.experience[0].company).toBe('Netflix');
      expect(result.profile.education[0].institution).toBe('Stanford University');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('extracts from @graph JSON-LD', async () => {
    const originalFetch = globalThis.fetch;
    mockFetch(
      () =>
        new Response(JSONLD_GRAPH_HTML, { status: 200, headers: { 'content-type': 'text/html' } })
    );

    try {
      const result = await scrapeLinkedInProfileDetailed('https://linkedin.com/in/alicechen');
      expect(result.extractionPath).toBe('jsonld');
      expect(result.profile.name).toBe('Alice Chen');
      expect(result.profile.headline).toBe('ML Engineer');
      expect(result.profile.experience[0].company).toBe('OpenAI');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('falls back to OG meta when no JSON-LD', async () => {
    const originalFetch = globalThis.fetch;
    mockFetch(
      () =>
        new Response(OG_META_ONLY_HTML, { status: 200, headers: { 'content-type': 'text/html' } })
    );

    try {
      const result = await scrapeLinkedInProfileDetailed('https://linkedin.com/in/carlosrivera');
      expect(result.extractionPath).toBe('og-meta');
      expect(result.confidence).toBe(0.5);
      expect(result.profile.name).toBe('Carlos Rivera');
      expect(result.profile.headline).toBe('Product Manager');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns low confidence for partial Person data', async () => {
    const originalFetch = globalThis.fetch;
    mockFetch(
      () =>
        new Response(PARTIAL_PERSON_HTML, { status: 200, headers: { 'content-type': 'text/html' } })
    );

    try {
      const result = await scrapeLinkedInProfileDetailed('https://linkedin.com/in/davewilson');
      expect(result.extractionPath).toBe('jsonld');
      expect(result.profile.name).toBe('Dave Wilson');
      // Confidence should be downgraded since no experience/education
      expect(result.confidence).toBeLessThan(1.0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ============ parseProfileFromBodyText ============

describe('parseProfileFromBodyText', () => {
  const BODY_TEXT = [
    'Jane Smith',
    'Jane Smith',
    'Senior Software Engineer at Stripe',
    'San Francisco, CA',
    'About',
    'Building scalable distributed systems.',
    'Top skills',
    'TypeScript • Distributed Systems',
    'Experience',
    'Stripe',
    'Senior Software Engineer',
    'Full-time',
    'Jan 2022 - Present · 4 yrs',
    'San Francisco, CA · Hybrid',
    'Google',
    'Software Engineer',
    'Jun 2019 - Dec 2021 · 2 yrs 7 mos',
    'Education',
    'MIT',
    'Bachelor of Science, Computer Science',
    '2014 - 2018',
  ].join('\n');

  test('extracts name, headline, and location', () => {
    const profile = parseProfileFromBodyText(BODY_TEXT);
    expect(profile.name).toBe('Jane Smith');
    expect(profile.headline).toContain('Senior Software Engineer');
    expect(profile.location).toContain('San Francisco');
  });

  test('extracts experience anchored on date ranges', () => {
    const profile = parseProfileFromBodyText(BODY_TEXT);
    expect(profile.experience.length).toBeGreaterThanOrEqual(1);
    expect(profile.experience[0].title).toContain('Senior Software Engineer');
    expect(profile.experience[0].startDate).toBe('Jan 2022');
  });

  test('extracts education anchored on year ranges', () => {
    const profile = parseProfileFromBodyText(BODY_TEXT);
    expect(profile.education.length).toBe(1);
    expect(profile.education[0].institution).toBe('MIT');
    expect(profile.education[0].startDate).toBe('2014');
  });

  test('returns empty sections for blank input', () => {
    const profile = parseProfileFromBodyText('');
    expect(profile.experience).toEqual([]);
    expect(profile.education).toEqual([]);
    expect(profile.skills).toEqual([]);
  });
});
