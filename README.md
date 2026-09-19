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
```

Then set up your profile:

```bash
autoply init
```

<details>
<summary><strong>Install from source</strong></summary>

```bash
git clone https://github.com/khrees/autoply.git
cd autoply
bun install
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
| Ashby | `jobs.ashbyhq.com/*` |

---

## Browser Extension

Autoply includes a browser extension that provides autofill assistance directly on job application pages. No web store required.

### Installation

#### Chrome / Chromium-based browsers

1. Build the extension:
   ```bash
   bun run extension:build
   ```

2. Open `chrome://extensions/`

3. Enable **Developer mode** (toggle in top right)

4. Click **Load unpacked** and select `dist/extension`

5. Pin the extension for easy access (click the puzzle piece icon → pin)

#### Firefox

1. Build the extension:
   ```bash
   bun run extension:build:firefox
   ```

2. Open `about:debugging#/runtime/this-firefox`

3. Click **Load Temporary Add-on...**

4. Select `dist/extension-firefox/manifest.json`

Note: Firefox temporary add-ons are removed when you close Firefox. For permanent installation, you need to sign the extension at [Firefox Add-ons](https://addons.mozilla.org/).

### Usage

1. Start the Autoply API server:
   ```bash
   bun run api
   ```
   The API server runs on port **8088** by default.

2. Navigate to any supported job application page

3. Click the Autoply extension icon

4. The extension sidepanel features:
   - **Autofill**: Detects form fields on the page, maps your profile data, and fills fields automatically.
   - **AI Chat Assistant**: Ask career questions, get interview prep, or draft responses using context from your profile, resume, GitHub, LinkedIn, and portfolio links.
   - **Document Generation**: Tailor resumes and cover letters for the current job page.
   - **Application Stats**: Track submitted, pending, and filled application history and metrics.

### Configuration

The extension communicates with the Autoply API server. By default, it connects to `http://localhost:8088`.

You can set a custom API base URL during build via `VITE_API_BASE_URL` environment variable or dynamically in extension storage.

---

## Configuration

### AI Provider

Autoply uses an AI provider to generate resumes and cover letters. Set one up before applying.

**Cloud providers:**

```bash
# Anthropic
autoply config set ai.provider anthropic
autoply config set ai.model claude-sonnet-4-6

# OpenAI
autoply config set ai.provider openai
autoply config set ai.model gpt-5.4-mini

# Google
autoply config set ai.provider google
autoply config set ai.model gemini-3.1-flash-lite-preview
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

### API server auth

All API routes except `/health` require a bearer token:

```bash
# Token lives at ~/.autoply/api-token (0600), generated on first run
cat ~/.autoply/api-token
curl -H "Authorization: Bearer <token>" http://localhost:8088/config
```

Override with `AUTOPLY_API_TOKEN` (required for Docker/Render where `HOST=0.0.0.0`).
The extension stores the token in Settings → API Token.

API key precedence for cloud providers: `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GOOGLE_API_KEY` env vars → OS keychain → `~/.autoply/credentials.json` file fallback (0600, used in containers without a keychain).

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
| `browser.engine` | `playwright` | Default browser engine. When set to `patchright` globally, `patchrightHosts`/`patchrightPlatforms` are ignored |
| `browser.headless` | `false` | Run browser without UI |
| `browser.timeout` | `30000` | Browser timeout (ms) |
| `browser.reuseSessions` | `true` | Reuse browser processes across jobs |
| `browser.maxOpenPagesPerBrowser` | `2` | Max concurrent pages per browser process |
| `browser.retireBrowserAfterPageCount` | `25` | Rotate a browser process after this many pages |
| `browser.closeInactiveBrowserAfterMillis` | `30000` | Close idle pooled browsers after this delay |
| `browser.patchrightHosts` | `[]` | Hosts that should use Patchright instead of Playwright (only when `browser.engine` is `playwright`) |
| `browser.patchrightPlatforms` | `[]` | Platforms that should use Patchright instead of Playwright (only when `browser.engine` is `playwright`) |
| `browser.proxy` | unset | Optional `{ server, username?, password? }` proxy for bulk mode (IP diversity matters more than UA rotation at volume) |
| `application.autoSubmit` | `false` | Auto-submit after form fill |
| `application.fillOptionalFields` | `false` | Fill optional fields and questions instead of leaving them blank |
| `application.saveScreenshots` | `true` | Save screenshots on submission |
| `application.retryAttempts` | `3` | Retry count for failed operations |
| `application.rateLimitDelay` | `0` | Delay in seconds between bulk applications |

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
