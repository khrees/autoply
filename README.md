<p align="center">
  <h1 align="center">Autoply</h1>
  <p align="center">Apply to jobs from your terminal. AI-generated resumes, cover letters, and form submissions — fully automated.</p>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#supported-platforms">Platforms</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#development">Development</a>
</p>

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime — `curl -fsSL https://bun.sh/install | bash`

### Install

```bash
curl -fsL https://autoply.khrees.com/install | bash
bunx playwright install chromium
```

Then set up your profile:

```bash
autoply init
```

<details>
<summary><strong>Install from source</strong></summary>

```bash
git clone https://github.com/khrees2412/autoply.git
cd autoply
bun install
bunx playwright install chromium
bun run build
mv dist/autoply /usr/local/bin/
```

</details>

---

## Usage

### Apply to a job

```bash
autoply apply https://boards.greenhouse.io/company/jobs/123456
```

Autoply scrapes the posting, generates a tailored resume and cover letter, fills out the application form, and submits it. By default, Autoply will pause and ask for your confirmation before final submission.

**Auto-Submit Mode**:
To skip the confirmation prompt and have Autoply submit automatically when confident:
```bash
autoply apply --auto https://boards.greenhouse.io/company/jobs/123456
```
*(You can also set `application.autoSubmit` to `true` in your config to always use this behavior).*

### Apply in bulk

```bash
# Pass multiple URLs
autoply apply https://job1.com https://job2.com https://job3.com

# Or read from a file (one URL per line)
autoply apply -f jobs.txt
```

### Dry run

Generate documents without submitting:

```bash
autoply apply -d https://boards.greenhouse.io/company/jobs/123456
```

### Generate documents only

```bash
autoply generate resume https://boards.greenhouse.io/company/jobs/123456
autoply generate cover-letter https://boards.greenhouse.io/company/jobs/123456
autoply generate both https://boards.greenhouse.io/company/jobs/123456 -d ./output
```

### View history

```bash
autoply history                  # All applications
autoply history -s submitted     # Filter by status
autoply history -c "Anthropic"   # Search by company
```

### Manage your profile

```bash
autoply profile show
autoply profile edit
autoply profile delete
```

### Save a browser session

For platforms that require login (e.g. LinkedIn):

```bash
autoply login linkedin
```

A browser window opens — log in manually, and the session is saved for future use.

---

## Supported Platforms

| Platform | URL Pattern |
|---|---|
| Greenhouse | `boards.greenhouse.io/*` |
| LinkedIn | `linkedin.com/jobs/*` |
| Lever | `jobs.lever.co/*` |
| Workday | `*.myworkdayjobs.com/*` |
| Ashby | `jobs.ashbyhq.com/*` |
| Jobvite | `jobs.jobvite.com/*` |
| SmartRecruiters | `jobs.smartrecruiters.com/*` |
| Pinpoint | `*.pinpointhq.com/*` |
| Teamtailor | `*.teamtailor.com/*` |

---

## Configuration

### AI Provider

Autoply uses an AI provider to generate resumes and cover letters. Set one up before applying.

**Cloud providers:**

```bash
# Anthropic
autoply config set ai.provider anthropic
autoply config set ai.model claude-sonnet-4-5-20250929

# OpenAI
autoply config set ai.provider openai
autoply config set ai.model gpt-5.2

# Google
autoply config set ai.provider google
autoply config set ai.model gemini-pro-3
```

Set your API key as an environment variable — add to your `.env` or shell profile:

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
```

**Local providers** (no API key needed):

```bash
# Ollama (default)
autoply config set ai.provider ollama
autoply config set ai.model llama3.2

# LM Studio
autoply config set ai.provider lmstudio
```

Verify your setup:

```bash
autoply config test
```

### All Options

```bash
autoply config list              # Show all settings
autoply config set <key> <value> # Set a value
autoply config get <key>         # Get a value
autoply config reset             # Reset to defaults
autoply config providers         # List AI providers
```

| Key | Default | Description |
|---|---|---|
| `ai.provider` | `ollama` | AI provider |
| `ai.model` | varies | Model name |
| `ai.baseUrl` | varies | API base URL (local providers) |
| `ai.temperature` | `0.7` | Generation temperature |
| `browser.engine` | `playwright` | Default browser engine |
| `browser.headless` | `false` | Run browser without UI |
| `browser.timeout` | `30000` | Browser timeout (ms) |
| `browser.reuseSessions` | `true` | Reuse browser processes across jobs |
| `browser.maxOpenPagesPerBrowser` | `2` | Max concurrent pages per browser process |
| `browser.retireBrowserAfterPageCount` | `25` | Rotate a browser process after this many pages |
| `browser.closeInactiveBrowserAfterMillis` | `30000` | Close idle pooled browsers after this delay |
| `browser.patchrightHosts` | `[]` | Hosts that should use Patchright instead of Playwright |
| `browser.patchrightPlatforms` | `[]` | Platforms that should use Patchright instead of Playwright |
| `application.autoSubmit` | `false` | Auto-submit after form fill |
| `application.fillOptionalFields` | `false` | Fill optional fields and questions instead of leaving them blank |
| `application.saveScreenshots` | `true` | Save screenshots on submission |
| `application.retryAttempts` | `3` | Retry count for failed operations |

Example targeted stealth setup:

```bash
autoply config set browser.patchrightHosts '["hypr.com"]'
autoply config set browser.patchrightPlatforms '["linkedin"]'
```

### Debugging

Autoply supports debugging flags to help identify issues during form submission. Set these as environment variables:

- `DEBUG=1` (or `true`) — Enables comprehensive debugging output.
- `DEBUG_GREENHOUSE=1` — Specifically enables pre-submission debugging for Greenhouse forms (logs unfilled fields to the console and saves a snapshot).

---

## Data Storage

All data is stored locally in `~/.autoply/`:

```
~/.autoply/
├── autoply.db           # SQLite database
├── config.json          # App configuration
├── browser-state.json   # Saved browser session
├── documents/           # Generated resumes and cover letters
└── screenshots/         # Submission screenshots
```

---

## Development

```bash
bun install
bun run dev              # Run CLI in dev mode
bun test                 # Run tests
bun run build            # Build for current platform
bun run build:all        # Build for all platforms
```

### Build targets

```bash
bun run build:mac        # macOS ARM (Apple Silicon)
bun run build:mac-intel  # macOS Intel
bun run build:linux      # Linux x64
bun run build:windows    # Windows x64
```

---

## License

MIT
