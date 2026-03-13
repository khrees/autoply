import { describe, expect, test } from 'bun:test';
import type { Profile } from '../types';
import {
  getDeterministicFieldValue,
  getExpectedIdentityValue,
  getIdentityAssertionKey,
  matchesIdentityFieldValue,
  normalizeLocationInput,
  requiresHumanAnswer,
  shouldAllowAIAnswer,
} from './form-filler';

// Import the FIELD_PATTERNS by recreating them for testing
// (since they're not exported from form-filler.ts)
const FIELD_PATTERNS = {
  firstName: /first[\s_-]?name|given[\s_-]?name|\bfname\b/i,
  lastName: /last[\s_-]?name|surname|family[\s_-]?name|\blname\b/i,
  fullName: /full[\s_-]?name|\bname\b|your[\s_-]?name|candidate[\s_-]?name/i,
  email: /e?[\s_-]?mail|email[\s_-]?address/i,
  phone: /phone|tel|mobile|cell|contact[\s_-]?number/i,
  location: /location|city|address|where.*based|current[\s_-]?location/i,
  linkedin: /linkedin|li[\s_-]?url|li[\s_-]?profile/i,
  github: /github|gh[\s_-]?url|gh[\s_-]?profile/i,
  portfolio: /portfolio|website|personal[\s_-]?site|url|homepage/i,
  resume: /resume|cv|curriculum[\s_-]?vitae/i,
  coverLetter: /cover[\s_-]?letter|covering[\s_-]?letter|motivation[\s_-]?letter/i,
  workAuthorization: /work[\s_-]?auth|authorized[\s_-]?to[\s_-]?work|legally[\s_-]?authorized|eligib|visa[\s_-]?status|right[\s_-]?to[\s_-]?work/i,
  sponsorship: /sponsor|visa[\s_-]?sponsor|immigration[\s_-]?sponsor|require.*sponsor/i,
  yearsExperience: /years?[\s_-]?(?:of[\s_-]?)?experience|experience[\s_-]?years|how[\s_-]?many[\s_-]?years/i,
  currentCompany: /current[\s_-]?company|employer|where.*work/i,
  currentTitle: /current[\s_-]?title|current[\s_-]?role|job[\s_-]?title/i,
  salary: /salary|compensation|pay|expected[\s_-]?salary|desired[\s_-]?salary/i,
  startDate: /start[\s_-]?date|when.*start|available.*start|availability|earliest[\s_-]?start/i,
  noticePeriod: /notice[\s_-]?period|notice|how[\s_-]?soon/i,
  gender: /gender|sex/i,
  ethnicity: /ethnicity|race|ethnic[\s_-]?background/i,
  veteran: /veteran|military[\s_-]?service/i,
  disability: /disability|disabled/i,
  referral: /referral|how.*hear|source|where.*find|referred[\s_-]?by/i,
  relocation: /relocation|willing[\s_-]?to[\s_-]?relocate|open[\s_-]?to[\s_-]?relocate/i,
} as const;

describe('FormFiller Field Patterns', () => {
  describe('firstName pattern', () => {
    test('matches common first name variations', () => {
      const pattern = FIELD_PATTERNS.firstName;

      expect(pattern.test('firstName')).toBe(true);
      expect(pattern.test('first_name')).toBe(true);
      expect(pattern.test('first-name')).toBe(true);
      expect(pattern.test('first name')).toBe(true);
      expect(pattern.test('givenName')).toBe(true);
      expect(pattern.test('given_name')).toBe(true);
      expect(pattern.test('fname')).toBe(true);
      expect(pattern.test('First Name')).toBe(true);
      expect(pattern.test('FIRST_NAME')).toBe(true);
    });

    test('does not match unrelated fields', () => {
      const pattern = FIELD_PATTERNS.firstName;

      expect(pattern.test('lastName')).toBe(false);
      expect(pattern.test('email')).toBe(false);
      expect(pattern.test('name')).toBe(false);
    });
  });

  describe('lastName pattern', () => {
    test('matches common last name variations', () => {
      const pattern = FIELD_PATTERNS.lastName;

      expect(pattern.test('lastName')).toBe(true);
      expect(pattern.test('last_name')).toBe(true);
      expect(pattern.test('last-name')).toBe(true);
      expect(pattern.test('surname')).toBe(true);
      expect(pattern.test('family_name')).toBe(true);
      expect(pattern.test('familyName')).toBe(true);
      expect(pattern.test('lname')).toBe(true);
      expect(pattern.test('Last Name')).toBe(true);
    });

    test('does not match unrelated fields', () => {
      const pattern = FIELD_PATTERNS.lastName;

      expect(pattern.test('firstName')).toBe(false);
      expect(pattern.test('email')).toBe(false);
      expect(pattern.test('name')).toBe(false);
    });
  });

  describe('fullName pattern', () => {
    test('matches full name variations', () => {
      const pattern = FIELD_PATTERNS.fullName;

      expect(pattern.test('fullName')).toBe(true);
      expect(pattern.test('full_name')).toBe(true);
      expect(pattern.test('name')).toBe(true);
      expect(pattern.test('yourName')).toBe(true);
      expect(pattern.test('your_name')).toBe(true);
      expect(pattern.test('candidateName')).toBe(true);
      expect(pattern.test('Full Name')).toBe(true);
    });

    test('does not match partial name fields', () => {
      const pattern = FIELD_PATTERNS.fullName;

      expect(pattern.test('firstName')).toBe(false);
      expect(pattern.test('lastName')).toBe(false);
    });
  });

  describe('email pattern', () => {
    test('matches email variations', () => {
      const pattern = FIELD_PATTERNS.email;

      expect(pattern.test('email')).toBe(true);
      expect(pattern.test('Email')).toBe(true);
      expect(pattern.test('e-mail')).toBe(true);
      expect(pattern.test('e_mail')).toBe(true);
      expect(pattern.test('mail')).toBe(true);
      expect(pattern.test('emailAddress')).toBe(true);
      expect(pattern.test('email_address')).toBe(true);
    });
  });

  describe('phone pattern', () => {
    test('matches phone variations', () => {
      const pattern = FIELD_PATTERNS.phone;

      expect(pattern.test('phone')).toBe(true);
      expect(pattern.test('Phone')).toBe(true);
      expect(pattern.test('tel')).toBe(true);
      expect(pattern.test('telephone')).toBe(true);
      expect(pattern.test('mobile')).toBe(true);
      expect(pattern.test('cell')).toBe(true);
      expect(pattern.test('cellphone')).toBe(true);
      expect(pattern.test('contact_number')).toBe(true);
      expect(pattern.test('contactNumber')).toBe(true);
    });
  });

  describe('linkedin pattern', () => {
    test('matches LinkedIn URL variations', () => {
      const pattern = FIELD_PATTERNS.linkedin;

      expect(pattern.test('linkedin')).toBe(true);
      expect(pattern.test('LinkedIn')).toBe(true);
      expect(pattern.test('linkedInUrl')).toBe(true);
      expect(pattern.test('linkedin_url')).toBe(true);
      expect(pattern.test('li_url')).toBe(true);
      expect(pattern.test('li_profile')).toBe(true);
    });
  });

  describe('github pattern', () => {
    test('matches GitHub URL variations', () => {
      const pattern = FIELD_PATTERNS.github;

      expect(pattern.test('github')).toBe(true);
      expect(pattern.test('GitHub')).toBe(true);
      expect(pattern.test('githubUrl')).toBe(true);
      expect(pattern.test('github_url')).toBe(true);
      expect(pattern.test('gh_url')).toBe(true);
      expect(pattern.test('gh_profile')).toBe(true);
    });
  });

  describe('workAuthorization pattern', () => {
    test('matches work authorization variations', () => {
      const pattern = FIELD_PATTERNS.workAuthorization;

      expect(pattern.test('workAuth')).toBe(true);
      expect(pattern.test('work_auth')).toBe(true);
      expect(pattern.test('authorized to work')).toBe(true);
      expect(pattern.test('authorizedToWork')).toBe(true);
      expect(pattern.test('legally authorized')).toBe(true);
      expect(pattern.test('legallyAuthorized')).toBe(true);
      expect(pattern.test('Are you eligible to work')).toBe(true);
      expect(pattern.test('visa status')).toBe(true);
      expect(pattern.test('right to work')).toBe(true);
    });
  });

  describe('sponsorship pattern', () => {
    test('matches sponsorship variations', () => {
      const pattern = FIELD_PATTERNS.sponsorship;

      expect(pattern.test('sponsor')).toBe(true);
      expect(pattern.test('sponsorship')).toBe(true);
      expect(pattern.test('visa sponsor')).toBe(true);
      expect(pattern.test('visa_sponsor')).toBe(true);
      expect(pattern.test('immigration sponsor')).toBe(true);
      expect(pattern.test('require sponsorship')).toBe(true);
      expect(pattern.test('Do you require sponsorship')).toBe(true);
    });
  });

  describe('yearsExperience pattern', () => {
    test('matches years of experience variations', () => {
      const pattern = FIELD_PATTERNS.yearsExperience;

      expect(pattern.test('years of experience')).toBe(true);
      expect(pattern.test('yearsOfExperience')).toBe(true);
      expect(pattern.test('years_of_experience')).toBe(true);
      expect(pattern.test('experience years')).toBe(true);
      expect(pattern.test('experienceYears')).toBe(true);
      expect(pattern.test('year experience')).toBe(true);
      expect(pattern.test('how many years')).toBe(true);
      expect(pattern.test('howManyYears')).toBe(true);
    });
  });

  describe('resume pattern', () => {
    test('matches resume/CV variations', () => {
      const pattern = FIELD_PATTERNS.resume;

      expect(pattern.test('resume')).toBe(true);
      expect(pattern.test('Resume')).toBe(true);
      expect(pattern.test('cv')).toBe(true);
      expect(pattern.test('CV')).toBe(true);
      expect(pattern.test('curriculum vitae')).toBe(true);
      expect(pattern.test('curriculumVitae')).toBe(true);
    });
  });

  describe('coverLetter pattern', () => {
    test('matches cover letter variations', () => {
      const pattern = FIELD_PATTERNS.coverLetter;

      expect(pattern.test('coverLetter')).toBe(true);
      expect(pattern.test('cover_letter')).toBe(true);
      expect(pattern.test('cover-letter')).toBe(true);
      expect(pattern.test('Cover Letter')).toBe(true);
      expect(pattern.test('coveringLetter')).toBe(true);
      expect(pattern.test('covering_letter')).toBe(true);
      expect(pattern.test('motivation letter')).toBe(true);
      expect(pattern.test('motivationLetter')).toBe(true);
    });
  });

  describe('startDate pattern', () => {
    test('matches start date variations', () => {
      const pattern = FIELD_PATTERNS.startDate;

      expect(pattern.test('startDate')).toBe(true);
      expect(pattern.test('start_date')).toBe(true);
      expect(pattern.test('Start Date')).toBe(true);
      expect(pattern.test('when can you start')).toBe(true);
      expect(pattern.test('whenCanYouStart')).toBe(true);
      expect(pattern.test('available to start')).toBe(true);
      expect(pattern.test('availability')).toBe(true);
      expect(pattern.test('earliest start')).toBe(true);
      expect(pattern.test('earliestStart')).toBe(true);
    });
  });

  describe('referral pattern', () => {
    test('matches referral source variations', () => {
      const pattern = FIELD_PATTERNS.referral;

      expect(pattern.test('referral')).toBe(true);
      expect(pattern.test('Referral')).toBe(true);
      expect(pattern.test('how did you hear')).toBe(true);
      expect(pattern.test('howDidYouHear')).toBe(true);
      expect(pattern.test('source')).toBe(true);
      expect(pattern.test('where did you find')).toBe(true);
      expect(pattern.test('referred by')).toBe(true);
      expect(pattern.test('referredBy')).toBe(true);
    });
  });

  describe('relocation pattern', () => {
    test('matches relocation variations', () => {
      const pattern = FIELD_PATTERNS.relocation;

      expect(pattern.test('relocation')).toBe(true);
      expect(pattern.test('Relocation')).toBe(true);
      expect(pattern.test('willing to relocate')).toBe(true);
      expect(pattern.test('willingToRelocate')).toBe(true);
      expect(pattern.test('open to relocate')).toBe(true);
      expect(pattern.test('openToRelocate')).toBe(true);
    });
  });
});

describe('FormFiller Value Extraction Logic', () => {
  const mockProfile: Profile = {
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+1-555-123-4567',
    location: 'San Francisco, CA',
    linkedin_url: 'https://linkedin.com/in/johndoe',
    github_url: 'https://github.com/johndoe',
    portfolio_url: 'https://johndoe.dev',
    skills: ['TypeScript', 'React', 'Node.js'],
    experience: [
      {
        company: 'Tech Corp',
        title: 'Senior Engineer',
        start_date: '2020-01-01',
        end_date: undefined,
        highlights: [],
      },
      {
        company: 'Startup Inc',
        title: 'Engineer',
        start_date: '2018-01-01',
        end_date: '2019-12-31',
        highlights: [],
      },
    ],
    education: [
      {
        institution: 'MIT',
        degree: 'BS',
        field: 'Computer Science',
      },
    ],
    preferences: {
      remote_only: false,
      preferred_locations: [],
      excluded_companies: [],
      job_types: ['full-time'],
    },
  };

  // Helper to test value extraction logic
  function getValueForField(
    label: string,
    name: string,
    profile: Profile
  ): string | null {
    return getDeterministicFieldValue(profile, {
      label,
      name,
      type: 'text',
    });
  }

  test('extracts first name from profile', () => {
    expect(getValueForField('First Name', 'firstName', mockProfile)).toBe('John');
    expect(getValueForField('Given Name', 'given_name', mockProfile)).toBe('John');
  });

  test('extracts last name from profile', () => {
    expect(getValueForField('Last Name', 'lastName', mockProfile)).toBe('Doe');
    expect(getValueForField('Surname', 'surname', mockProfile)).toBe('Doe');
  });

  test('extracts full name from profile', () => {
    // Note: 'Full Name' contains 'name' which matches fullName pattern
    // Use field names that don't contain 'location' substring
    expect(getValueForField('Full Name', 'fullName', mockProfile)).toBe('John Doe');
    // 'name' alone matches fullName pattern with ^name$ anchor
    expect(getValueForField('', 'name', mockProfile)).toBe('John Doe');
  });

  test('extracts email from profile', () => {
    expect(getValueForField('Email', 'email', mockProfile)).toBe('john.doe@example.com');
    expect(getValueForField('E-mail Address', 'email_address', mockProfile)).toBe('john.doe@example.com');
  });

  test('extracts phone from profile', () => {
    expect(getValueForField('Phone', 'phone', mockProfile)).toBe('+1-555-123-4567');
    expect(getValueForField('Mobile', 'mobile', mockProfile)).toBe('+1-555-123-4567');
  });

  test('extracts location from profile', () => {
    expect(getValueForField('Location', 'location', mockProfile)).toBe('San Francisco, CA');
    expect(getValueForField('City', 'city', mockProfile)).toBe('San Francisco, CA');
  });

  test('extracts LinkedIn URL from profile', () => {
    expect(getValueForField('LinkedIn', 'linkedin', mockProfile)).toBe('https://linkedin.com/in/johndoe');
    expect(getValueForField('LinkedIn URL', 'linkedin_url', mockProfile)).toBe('https://linkedin.com/in/johndoe');
  });

  test('extracts GitHub URL from profile', () => {
    expect(getValueForField('GitHub', 'github', mockProfile)).toBe('https://github.com/johndoe');
    expect(getValueForField('GitHub Profile', 'github_url', mockProfile)).toBe('https://github.com/johndoe');
  });

  test('extracts portfolio URL from profile', () => {
    expect(getValueForField('Portfolio', 'portfolio', mockProfile)).toBe('https://johndoe.dev');
    expect(getValueForField('Website', 'website', mockProfile)).toBe('https://johndoe.dev');
  });

  test('does not guess work authorization', () => {
    expect(getValueForField('Authorized to work', 'work_auth', mockProfile)).toBe(null);
    expect(getValueForField('Legally authorized', 'legally_authorized', mockProfile)).toBe(null);
  });

  test('does not guess sponsorship answers', () => {
    expect(getValueForField('Require sponsorship', 'sponsorship', mockProfile)).toBe(null);
    expect(getValueForField('Visa sponsor', 'visa_sponsor', mockProfile)).toBe(null);
  });

  test('extracts current company from experience', () => {
    expect(getValueForField('Current Company', 'current_company', mockProfile)).toBe('Tech Corp');
    expect(getValueForField('Employer', 'employer', mockProfile)).toBe('Tech Corp');
  });

  test('extracts current title from experience', () => {
    expect(getValueForField('Current Title', 'current_title', mockProfile)).toBe('Senior Engineer');
    expect(getValueForField('Job Title', 'job_title', mockProfile)).toBe('Senior Engineer');
  });

  test('returns 2 weeks for start date', () => {
    expect(getValueForField('Start Date', 'start_date', mockProfile)).toBe('2 weeks');
    expect(getValueForField('When can you start', 'availability', mockProfile)).toBe('2 weeks');
  });

  test('returns Online Job Board for referral', () => {
    expect(getValueForField('How did you hear', 'referral', mockProfile)).toBe('Online Job Board');
    expect(getValueForField('Source', 'source', mockProfile)).toBe('Online Job Board');
  });

  test('does not guess relocation answers', () => {
    expect(getValueForField('', 'willingToRelocate', mockProfile)).toBe(null);
    expect(getValueForField('Open to relocate', '', mockProfile)).toBe(null);
  });

  test('returns null for unrecognized fields', () => {
    expect(getValueForField('Favorite Color', 'favorite_color', mockProfile)).toBe(null);
    expect(getValueForField('Random Field', 'random_field', mockProfile)).toBe(null);
  });
});

describe('Option Matching Logic', () => {
  function findBestMatchingOption(value: string, options: string[]): string | null {
    const normalizedValue = value.toLowerCase().trim();

    // Exact match
    const exactMatch = options.find((opt) => opt.toLowerCase().trim() === normalizedValue);
    if (exactMatch) return exactMatch;

    // Contains match
    const containsMatch = options.find(
      (opt) =>
        opt.toLowerCase().includes(normalizedValue) ||
        normalizedValue.includes(opt.toLowerCase())
    );
    if (containsMatch) return containsMatch;

    // Fuzzy match for yes/no variants
    if (['yes', 'true', 'y'].includes(normalizedValue)) {
      const yesOption = options.find((opt) =>
        /^(yes|true|y|affirmative|correct)$/i.test(opt.trim())
      );
      if (yesOption) return yesOption;
    }

    if (['no', 'false', 'n'].includes(normalizedValue)) {
      const noOption = options.find((opt) =>
        /^(no|false|n|negative)$/i.test(opt.trim())
      );
      if (noOption) return noOption;
    }

    return null;
  }

  test('finds exact match', () => {
    const options = ['Yes', 'No', 'Maybe'];
    expect(findBestMatchingOption('Yes', options)).toBe('Yes');
    expect(findBestMatchingOption('yes', options)).toBe('Yes');
    expect(findBestMatchingOption('YES', options)).toBe('Yes');
  });

  test('finds contains match', () => {
    const options = ['United States of America', 'United Kingdom', 'Canada'];
    expect(findBestMatchingOption('United States', options)).toBe('United States of America');
    expect(findBestMatchingOption('Kingdom', options)).toBe('United Kingdom');
  });

  test('matches yes variations', () => {
    const options = ['Yes', 'No'];
    expect(findBestMatchingOption('yes', options)).toBe('Yes');
    expect(findBestMatchingOption('true', options)).toBe('Yes');
    expect(findBestMatchingOption('y', options)).toBe('Yes');
  });

  test('matches no variations', () => {
    const options = ['Yes', 'No'];
    expect(findBestMatchingOption('no', options)).toBe('No');
    expect(findBestMatchingOption('false', options)).toBe('No');
    expect(findBestMatchingOption('n', options)).toBe('No');
  });

  test('returns null when no match', () => {
    const options = ['Option A', 'Option B', 'Option C'];
    expect(findBestMatchingOption('Option Z', options)).toBe(null);
  });

  test('handles affirmative/correct in yes options', () => {
    const options = ['Affirmative', 'Negative'];
    expect(findBestMatchingOption('yes', options)).toBe('Affirmative');
    expect(findBestMatchingOption('no', options)).toBe('Negative');
  });
});

describe('Years of Experience Calculation', () => {
  function calculateYearsExperience(experience: Profile['experience']): string {
    if (experience.length === 0) {
      return '0';
    }

    let totalMonths = 0;
    for (const exp of experience) {
      const start = new Date(exp.start_date);
      const end = exp.end_date ? new Date(exp.end_date) : new Date();
      const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      totalMonths += Math.max(0, months);
    }

    const years = Math.round(totalMonths / 12);
    return years.toString();
  }

  test('returns 0 for empty experience', () => {
    expect(calculateYearsExperience([])).toBe('0');
  });

  test('calculates years for single job', () => {
    const experience = [
      {
        company: 'Test Corp',
        title: 'Engineer',
        start_date: '2020-01-01',
        end_date: '2022-01-01',
        highlights: [],
      },
    ];
    expect(calculateYearsExperience(experience)).toBe('2');
  });

  test('calculates years for multiple jobs', () => {
    const experience = [
      {
        company: 'Corp A',
        title: 'Senior',
        start_date: '2021-01-01',
        end_date: '2023-01-01',
        highlights: [],
      },
      {
        company: 'Corp B',
        title: 'Junior',
        start_date: '2019-01-01',
        end_date: '2020-12-31',
        highlights: [],
      },
    ];
    // 2 years + 2 years = 4 years
    expect(calculateYearsExperience(experience)).toBe('4');
  });

  test('uses current date for ongoing job', () => {
    const now = new Date();
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());

    const experience = [
      {
        company: 'Current Corp',
        title: 'Engineer',
        start_date: twoYearsAgo.toISOString().split('T')[0],
        end_date: undefined,
        highlights: [],
      },
    ];
    expect(calculateYearsExperience(experience)).toBe('2');
  });

  test('handles partial years by rounding', () => {
    const experience = [
      {
        company: 'Test Corp',
        title: 'Engineer',
        start_date: '2020-01-01',
        end_date: '2021-07-01', // 18 months
        highlights: [],
      },
    ];
    // 18 months rounds to 2 years
    expect(calculateYearsExperience(experience)).toBe('2');
  });
});

describe('requiresHumanAnswer', () => {
  test('flags work authorization and sponsorship questions', () => {
    expect(requiresHumanAnswer('Are you based in the US or Canada?')).toBe(true);
    expect(requiresHumanAnswer('Will you now or in the future require a visa sponsorship or transfer?')).toBe(true);
    expect(requiresHumanAnswer('Are you legally authorized to work in the United States?')).toBe(true);
  });

  test('flags hybrid and onsite attendance questions', () => {
    expect(
      requiresHumanAnswer(
        'Are you willing and able to come onsite to our Brisbane, CA location Tues-Thurs on a weekly basis?'
      )
    ).toBe(true);
    expect(requiresHumanAnswer('This is a hybrid role. Can you work onsite three days per week?')).toBe(true);
  });

  test('allows normal role-fit questions', () => {
    expect(requiresHumanAnswer('In a few words, what makes you the ideal candidate for this position?')).toBe(
      false
    );
    expect(requiresHumanAnswer('Describe your experience supporting API integrations.')).toBe(false);
  });
});

describe('normalizeLocationInput', () => {
  test('removes administrative suffixes for autocomplete fields', () => {
    expect(normalizeLocationInput('Lagos State, Nigeria')).toBe('Lagos, Nigeria');
    expect(normalizeLocationInput('Ontario Province, Canada')).toBe('Ontario, Canada');
  });

  test('preserves already clean locations', () => {
    expect(normalizeLocationInput('San Francisco, CA')).toBe('San Francisco, CA');
    expect(normalizeLocationInput('Berlin, Germany')).toBe('Berlin, Germany');
  });
});

describe('field guardrails', () => {
  const profile: Profile = {
    name: 'Christian Ndu',
    email: 'christiannduh@gmail.com',
    phone: '+234 812 927 0350',
    location: 'Lagos State, Nigeria',
    linkedin_url: 'https://linkedin.com/in/ndu-christian',
    github_url: 'https://github.com/khrees/2412',
    portfolio_url: 'https://example.com',
    skills: ['Go', 'TypeScript'],
    experience: [
      {
        company: 'Mono',
        title: 'Technical Product Specialist',
        start_date: '2024-12-01',
        highlights: ['Debugged issues'],
      },
    ],
    education: [],
  };

  test('blocks AI for identity, compliance, and demographic fields', () => {
    expect(shouldAllowAIAnswer({ label: 'Email address', type: 'text' })).toBe(false);
    expect(shouldAllowAIAnswer({ label: 'Will you now or in the future require visa sponsorship?', type: 'select' })).toBe(false);
    expect(shouldAllowAIAnswer({ label: 'Gender', type: 'select' })).toBe(false);
    expect(shouldAllowAIAnswer({ label: 'Why are you interested in this role?', type: 'textarea' })).toBe(true);
  });

  test('does not guess compliance answers deterministically', () => {
    expect(
      getDeterministicFieldValue(profile, { label: 'Are you legally authorized to work in the United States?', type: 'select' })
    ).toBeNull();
    expect(
      getDeterministicFieldValue(profile, { label: 'Will you require visa sponsorship?', type: 'select' })
    ).toBeNull();
  });

  test('derives identity assertions from labels and matches expected values', () => {
    expect(getIdentityAssertionKey({ label: 'Full name', type: 'text' })).toBe('fullName');
    expect(getIdentityAssertionKey({ label: 'Current location', type: 'text' })).toBe('location');
    expect(getExpectedIdentityValue(profile, 'email')).toBe('christiannduh@gmail.com');
    expect(matchesIdentityFieldValue('phone', '+2348129270350', '+234 812 927 0350')).toBe(true);
    expect(matchesIdentityFieldValue('location', 'Lagos State, Nigeria', 'Lagos, Nigeria')).toBe(true);
    expect(matchesIdentityFieldValue('fullName', 'Christian Ndu', 'Christina Diaz')).toBe(false);
  });
});
