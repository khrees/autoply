# Autoply - Open Source Job Application Automation

> **The privacy-first, open-source alternative to Simplify.jobs.** Take control of your job search with AI-powered autofill, resume tailoring, and application tracking - using your own API keys or local models.

---

## Overview

Autoply is a CLI tool and Chrome extension that automates job applications across major ATS platforms. Unlike Simplify.jobs (proprietary, cloud-dependent), Autoply is:

- **Open Source** (MIT License)
- **Privacy-Focused** (data stays local)
- **BYOK** (Bring Your Own Key)
- **Local AI** (Ollama, LM Studio support)
- **Self-Hostable** (full control)

### Comparison: Autoply vs Simplify.jobs

| Feature | Simplify.jobs | Autoply |
|---------|---------------|---------|
| License | Proprietary | MIT (open source) |
| AI | Cloud (built-in) | BYOK + Local ✅ |
| Privacy | Data on their servers | Data stays local ✅ |
| Deployment | SaaS only | Self-host option ✅ |
| Extension | Chrome, Firefox | Chrome ✅ / Firefox ✅ |
| Autofill | ✅ | ✅ (AI-powered) |
| Resume Builder | ✅ AI-powered | ✅ AI-powered |
| Cover Letters | ❌ | ✅ AI-powered |
| Job Tracker | ✅ | ✅ |
| Bulk Mode | ❌ | ✅ (queue + rate limiting) |
| Profile in Extension | ❌ | ✅ (standalone) |
| Resume Import | ❌ | ✅ (AI extraction) |
| Job Recommendations | ✅ | 📋 Backlog |
| API Access | ❌ | ✅ |
| Platforms | 1000+ | 11 supported |

---

## Supported Job Platforms

| Platform | Status | URL Pattern |
|----------|--------|-------------|
| Greenhouse | ✅ Complete | `boards.greenhouse.io/*` |
| LinkedIn | ✅ Complete | `linkedin.com/jobs/*` |
| Lever | ✅ Complete | `jobs.lever.co/*` |
| Workday | ✅ Complete | `*.myworkdayjobs.com/*` |
| SmartRecruiters | ✅ Complete | `jobs.smartrecruiters.com/*` |
| Ashby | ✅ Complete | `jobs.ashbyhq.com/*` |
| BambooHR | ✅ Complete | `*.bamboohr.com/*` |
| Teamtailor | ✅ Complete | `*.teamtailor.com/*` |
| Pinpoint | ✅ Complete | `*.pinpointhq.com/*` |
| Jobvite | ✅ Complete | `jobs.jobvite.com/*` |
| Generic | ✅ Complete | Fallback for unknown ATS |

---

## Core Features

### 1. Universal Autofill

**Description**: Fill job application forms instantly with profile data across all supported ATS platforms.

**User Flow**:
1. User opens job application page
2. Clicks "Fill Application" in extension sidebar (or CLI)
3. AI analyzes form fields and job context
4. Profile data intelligently mapped to form fields
5. Fields auto-filled; user reviews and submits

**AI-Powered Field Classification**:
- Uses AI models to understand form context
- Maps fields to profile data with confidence scores
- Skips legal/privacy fields (D&I questions)
- Provides smart defaults for ambiguous fields

**Edge Cases**:
- Required fields AI can't determine → Interactive prompt
- reCAPTCHA → Best-effort (checkbox only)
- Email verification → Pause for user input

### 2. AI-Powered Resume Tailoring

**Description**: Generate ATS-optimized resumes tailored to each job posting.

**Features**:
- [x] Extract requirements/qualifications from job description
- [x] Rewrite bullets to highlight relevant experience
- [x] Optimize job titles to match target role
- [x] Add missing keywords from job posting
- [x] Keep existing resume voice/style if provided
- [x] Export as Markdown → PDF conversion

### 3. AI Cover Letter Generation

**Description**: Generate personalized cover letters that sound human, not robotic.

**Features**:
- [x] Reference existing cover letter for voice/style
- [x] Connect candidate story to job requirements
- [x] Keep to 3-4 short paragraphs
- [x] Avoid corporate buzzwords
- [x] Tailor to specific company/role

### 4. Job Application Tracker

**Description**: SQLite database tracks all applications with status, time saved, and diagnostics.

**Data Model**:
```
Application {
  id: number
  profile_id: number
  url: string
  platform: enum
  company: string
  job_title: string
  status: 'pending' | 'filled' | 'submitted' | 'failed'
  generated_resume?: string
  generated_cover_letter?: string
  form_data?: JSON
  error_message?: string
  time_saved: number (seconds)
  applied_at?: timestamp
  created_at: timestamp
}
```

**CLI Commands**:
```bash
autoply history          # List all applications
autoply history --status submitted  # Filter by status
autoply history --company "Acme"  # Filter by company
```

### 5. Browser Extension

**Description**: Browser extension for one-click autofill and job tracking. Works with Chrome and Firefox.

**Components**:
- [x] `content.ts` - Injected script for form detection and autofill
- [x] `background.ts` - Service worker for side panel management
- [x] `background-firefox.ts` - Firefox-compatible background script
- [x] `sidepanel.tsx` - React UI for extension controls

**Extension Features**:
- [x] Side panel UI with dashboard
- [x] One-click "Fill Application"
- [x] Connection status indicator
- [x] Application history view
- [x] Profile tab with inline editing
- [x] Import profile from resume (AI extraction)
- [x] Settings/AI provider config
- [x] Bulk apply queue in extension
- [x] Firefox support
- [ ] Job recommendations feed

### 6. Bulk Application Mode

**Description**: Process multiple job URLs from a file with queue persistence and rate limiting.

**CLI**:
```bash
autoply apply --file jobs.txt --auto
```

**Features**:
- [ ] Resume interrupted bulk applications
- [ ] Configurable delay between applications
- [ ] Progress indicator
- [ ] Queue persistence (survive restarts)
- [ ] Deduplication (skip already-applied)

---

## AI Provider Configuration

### Supported Providers

| Provider | Type | Configuration |
|----------|------|---------------|
| OpenAI | Cloud | `OPENAI_API_KEY` |
| Anthropic | Cloud | `ANTHROPIC_API_KEY` |
| Google | Cloud | `GOOGLE_API_KEY` |
| Ollama | Local | `OLLAMA_BASE_URL` (default: `http://localhost:11434`) |
| LMStudio | Local | `LMSTUDIO_BASE_URL` (default: `http://localhost:1234`) |

### Model Recommendations

| Use Case | Recommended Model | Notes |
|----------|-------------------|-------|
| Resume tailoring | GPT-4o-mini, Claude 3.5 Haiku | Fast, cost-effective |
| Cover letters | Claude 3.5 Sonnet | Better at creative writing |
| Form field detection | GPT-4o-mini | Good at structured output |
| Local (Mac M-series) | llama3.2:3b, mistral-nemo | Good quality/speed balance |
| Local (with GPU) | llama3.2:70b, mixtral-8x7b | Near cloud quality |

### Configuration

```bash
# Use OpenAI
autoply config set ai.provider openai
autoply config set ai.model gpt-4o-mini
autoply config set ai.apiKey YOUR_KEY

# Use local Ollama
autoply config set ai.provider ollama
autoply config set ai.model llama3.2
autoply config set ai.baseUrl http://localhost:11434
```

---

## CLI Commands

```bash
# Initialize profile
autoply init

# Manage profile
autoply profile show
autoply profile edit
autoply profile import <resume.pdf>

# Configure AI provider
autoply config set ai.provider ollama
autoply config set ai.model llama3.2
autoply config set ai.baseUrl http://localhost:11434
autoply config list

# Apply to jobs
autoply apply <url>
autoply apply <url1> <url2> <url3>
autoply apply --file urls.txt
autoply apply <url> --dry-run
autoply apply <url> --auto

# Resume interrupted batch
autoply apply --resume

# Generate documents (without applying)
autoply generate resume <url> --output resume.pdf
autoply generate cover-letter <url> --output cover.pdf

# View history
autoply history
autoply history --status pending
autoply history --company "Acme Corp"

# API Server (for extension)
autoply api
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Extension                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │Sidepanel│  │Content  │  │Background│ │  Icons  │       │
│  │  (UI)   │  │ Script  │  │ Worker  │  │         │       │
│  └────┬────┘  └────┬────┘  └────┬────┘  └─────────┘       │
└───────┼────────────┼────────────┼───────────────────────────┘
        │            │            │
        └────────────┴────────────┘
                    │ HTTP
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Server (Fastify)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Routes  │  │  Middle- │  │  CORS    │  │  Auth    │   │
│  │          │  │  ware    │  │          │  │  (future)│   │
│  └────┬─────┘  └──────────┘  └──────────┘  └──────────┘   │
└───────┼─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                      Core Application                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Scraper  │  │  Form    │  │Document  │  │   AI     │   │
│  │  Manager │  │  Filler  │  │Generator │  │ Provider │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
└───────┼──────────────┼─────────────┼─────────────┼──────────┘
        │              │             │             │
        ▼              ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│                      Data Layer                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ SQLite   │  │  Config  │  │ Resume   │  │   AI     │   │
│  │ Database │  │   JSON   │  │  Store   │  │ Cache    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/
├── cli/                    # CLI entry point
│   ├── index.ts           # Commander.js setup
│   ├── commands/          # apply, init, history, etc.
│   └── prompts/          # Interactive prompts
├── core/                   # Business logic
│   ├── application.ts     # Application orchestrator
│   ├── browser-manager.ts # Playwright/Patchright pool
│   ├── form-filler.ts     # Form field detection & filling
│   ├── queue.ts          # Job queue management
│   └── helpers.ts        # Shared utilities
├── scrapers/              # Platform-specific scrapers
│   ├── base.ts           # Base scraper class
│   ├── greenhouse.ts     # Greenhouse implementation
│   ├── linkedin.ts       # LinkedIn Easy Apply
│   ├── lever.ts          # Lever implementation
│   └── ...               # Other platforms
├── ai/                    # AI integrations
│   ├── provider.ts       # AI provider factory
│   ├── openai.ts         # OpenAI implementation
│   ├── anthropic.ts      # Anthropic implementation
│   ├── google.ts         # Google implementation
│   ├── ollama.ts         # Ollama implementation
│   ├── lmstudio.ts       # LM Studio implementation
│   ├── resume.ts         # Resume generation
│   ├── cover-letter.ts   # Cover letter generation
│   ├── job-extractor.ts  # AI job data extraction
│   └── profile-extractor.ts # Resume → Profile parsing
├── db/                    # Database layer
│   ├── index.ts          # SQLite initialization
│   └── repositories/     # Data access objects
│       ├── profile.ts
│       ├── application.ts
│       └── config.ts
├── api/                   # REST API server
│   └── server.ts         # Fastify server
├── extension/             # Chrome extension
│   ├── manifest.json     # Extension manifest
│   ├── sidepanel.html    # Side panel entry
│   ├── sidepanel.tsx     # Side panel React app
│   ├── background.ts     # Service worker
│   ├── content.ts        # Content script
│   └── index.css         # Styles
├── utils/                 # Utilities
│   ├── logger.ts         # Logging
│   ├── url-parser.ts      # URL validation
│   └── document-extractor.ts # PDF/MD parsing
└── types/                 # TypeScript types
    └── index.ts          # All type definitions
```

---

## Data Flow

```
1. User runs: autoply apply https://boards.greenhouse.io/company/jobs/123

2. URL Parser
   └── Validates URL
   └── Detects platform (Greenhouse)

3. Job Scraper (Platform-specific)
   └── Launches headless browser
   └── Extracts job details & form structure
   └── Returns structured job data

4. AI Service
   └── Receives: job data + user profile
   └── Generates: tailored resume + cover letter
   └── Returns: generated documents

5. Form Filler
   └── Maps profile fields to form inputs
   └── Uploads generated resume
   └── Fills custom questions via AI
   └── Takes screenshot (if enabled)

6. Submission (if autoSubmit enabled)
   └── Submits application
   └── Saves to history database

7. History
   └── Logs application with status
   └── Stores generated documents
```

---

## Database Schema

### profiles
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| name | TEXT | Full name |
| email | TEXT | Email address |
| phone | TEXT | Phone number |
| location | TEXT | City, Country |
| linkedin_url | TEXT | LinkedIn profile |
| github_url | TEXT | GitHub profile |
| portfolio_url | TEXT | Portfolio website |
| base_resume | TEXT | Base resume (markdown) |
| base_cover_letter | TEXT | Base cover letter template |
| preferences | JSON | Job preferences |
| skills | JSON | Array of skills |
| experience | JSON | Work history |
| education | JSON | Education history |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update |

### applications
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| profile_id | INTEGER | FK to profiles |
| url | TEXT | Job posting URL |
| platform | TEXT | Platform name |
| company | TEXT | Company name |
| job_title | TEXT | Position title |
| status | TEXT | pending/filled/submitted/failed |
| generated_resume | TEXT | Tailored resume |
| generated_cover_letter | TEXT | Generated cover letter |
| form_data | JSON | Submitted form data |
| error_message | TEXT | Error if failed |
| time_saved | INTEGER | Seconds saved |
| applied_at | DATETIME | Submission time |
| created_at | DATETIME | Creation timestamp |

### config
| Column | Type | Description |
|--------|------|-------------|
| key | TEXT | Config key (primary) |
| value | TEXT | Config value (JSON) |

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/profile` | GET | Get current profile |
| `/profile` | POST | Update profile |
| `/config` | GET | Get app config |
| `/config` | POST | Update config |
| `/config/test` | POST | Test AI provider |
| `/applications` | GET | List applications |
| `/applications/apply` | POST | Submit application |
| `/jobs/passive-process` | POST | Process job HTML |
| `/jobs/scrape` | POST | Scrape job page |
| `/extension/status` | GET | Extension connection status |

---

## Privacy & Security

### Data Storage

| Data | Location | User Control |
|------|----------|--------------|
| Profile | `~/.autoply/` | ✅ Full |
| Applications | SQLite in `~/.autoply/` | ✅ Full |
| AI API Keys | `config.json` | ✅ Full |
| Browser Sessions | `~/.autoply/sessions/` | ✅ Full |
| Generated Docs | `~/.autoply/documents/` | ✅ Full |

### Security Measures

- [x] No third-party data collection
- [x] API keys stored locally only
- [x] Browser sessions encrypted at rest (optional)
- [x] No cloud sync without explicit consent
- [ ] End-to-end encryption for sync (future)
- [ ] Secure credential manager integration (future)

---

## Installation & Setup

### Prerequisites
- Node.js 18+ or Bun 1.0+
- Playwright (installed automatically)

### Quick Start

```bash
# Install
bun install

# Initialize profile
bun run src/cli/index.ts init

# Start API server (for extension)
bun run api

# Apply to a job
bun run src/cli/index.ts apply https://boards.greenhouse.io/acme/jobs/123

# Load extension from dist/extension/
```

### Extension Setup

1. Build: `bun run extension:build`
2. Open Chrome: `chrome://extensions`
3. Enable "Developer mode"
4. "Load unpacked" → Select `dist/extension/`
5. Click Autoply icon in toolbar
6. Ensure API server is running: `bun run api`

---

## Testing

```bash
# Run all tests
bun test

# Watch mode
bun test --watch

# Specific test
bun test src/scrapers/base.test.ts

# Type check
bun run typecheck

# Lint
bun run lint
```

---

## Roadmap

### Phase 1: MVP Stabilization (Current)
- [x] Core autofill for all major ATS platforms
- [x] AI resume tailoring
- [x] AI cover letter generation
- [x] CLI application tracker
- [x] Extension with autofill
- [ ] Extension login (standalone, no CLI dependency)
- [ ] Bug fixes and edge case handling

### Phase 2: Bulk & Scale
- [ ] Bulk application mode
- [ ] Queue persistence
- [ ] Rate limiting
- [ ] Deduplication
- [ ] Progress reporting

### Phase 3: Discovery
- [ ] Job recommendations engine
- [ ] LinkedIn job search integration
- [ ] Custom company list support
- [ ] Email notifications for new matches

### Phase 4: Polish
- [ ] Firefox extension
- [ ] Safari extension
- [ ] Mobile companion app
- [ ] Collaborative features (shared team profiles)

---

## Contributing

Autoply is MIT licensed and welcomes contributions.

### Areas Needing Help

1. **More ATS Platforms**: Workday, Taleo, iCIMS, BrassRing integrations
2. **Firefox Extension**: Port from Chrome
3. **Better Form Detection**: ML-based field classification
4. **Resume Parsing**: Improved PDF structure extraction
5. **Documentation**: User guides, video tutorials

### Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Run tests
bun test

# Type check
bun run typecheck

# Lint
bun run lint
```

---

## License

MIT License - see [LICENSE](LICENSE)

---
<!-- 
## Resources

- [Documentation](https://docs.autoply.dev) (planned)
- [Discord Community](https://discord.gg/autoply) (planned)
- [Issue Tracker](https://github.com/autoply/autoply/issues) -->
