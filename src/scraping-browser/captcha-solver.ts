import type { Page } from 'playwright-core';

const TWOCAPTCHA_IN_URL = 'https://2captcha.com/in.php';
const TWOCAPTCHA_RES_URL = 'https://2captcha.com/res.php';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 24; // 2 minutes max (24 × 5s)
const CF_CHALLENGE_TIMEOUT_MS = 30000;

const CF_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

type CaptchaType = 'recaptcha-v2' | 'recaptcha-v3' | 'hcaptcha' | 'cloudflare';

export interface CaptchaSolverOptions {
  /** 2captcha / Anti-Captcha API key. Optional — audio solving works without it. */
  twoCaptchaKey?: string;
  /** Groq API key for free Whisper transcription of reCAPTCHA audio challenges. */
  groqApiKey?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export class CaptchaSolver {
  private twoCaptchaKey: string | undefined;
  private groqApiKey: string | undefined;
  private pollIntervalMs: number;
  private maxPollAttempts: number;

  constructor(options: CaptchaSolverOptions) {
    this.twoCaptchaKey = options.twoCaptchaKey;
    this.groqApiKey = options.groqApiKey;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.maxPollAttempts = options.maxPollAttempts ?? MAX_POLL_ATTEMPTS;
  }

  /**
   * Detect the CAPTCHA type on the page and solve it automatically.
   *
   * Priority order:
   *  1. Cloudflare — browser executes challenge JS natively, no key needed.
   *  2. reCAPTCHA v2 — audio challenge via Groq Whisper (free), or 2captcha token (paid).
   *  3. hCaptcha — 2captcha token if key available.
   *  4. reCAPTCHA v3 — relies on stealth fingerprint for a passing score; token fallback via 2captcha.
   */
  async solvePage(page: Page): Promise<boolean> {
    const type = await this.detectCaptchaType(page);
    if (!type) return false;

    if (type === 'cloudflare') return CaptchaSolver.solveCloudflare(page);
    if (type === 'recaptcha-v2') return this.solveRecaptchaV2(page);
    if (type === 'hcaptcha') return this.solveHCaptcha(page);
    if (type === 'recaptcha-v3') return this.solveRecaptchaV3(page);
    return false;
  }

  private async detectCaptchaType(page: Page): Promise<CaptchaType | null> {
    return page.evaluate(() => {
      const title = document.title.toLowerCase();
      const bodyText = (document.body?.innerText ?? '').toLowerCase();
      const inlineScripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map((s) => s.textContent ?? '')
        .join(' ');

      // Full-page Cloudflare challenge — covers JS challenge, managed challenge,
      // and error pages. Uses the same signals as isAntiBotChallengePage().
      const isCFChallenge =
        title === 'just a moment...' ||
        document.getElementById('challenge-running') !== null ||
        document.getElementById('challenge-form') !== null ||
        document.getElementById('challenge-error-text') !== null ||
        bodyText.includes('performing security verification') ||
        bodyText.includes('verifying you are human') ||
        bodyText.includes('enable javascript and cookies to continue') ||
        bodyText.includes('performance and security by cloudflare') ||
        inlineScripts.includes('_cf_chl_opt');

      if (isCFChallenge) return 'cloudflare';

      // Cloudflare Turnstile widget embedded in a page (not a full-page challenge)
      if (
        document.querySelector('iframe[src*="challenges.cloudflare.com"]') ||
        document.querySelector('.cf-turnstile')
      ) {
        return 'cloudflare';
      }

      if (
        document.querySelector('iframe[src*="hcaptcha.com"]') ||
        document.querySelector('iframe[title*="hCaptcha"]') ||
        document.querySelector('[data-hcaptcha-widget-id]')
      ) {
        return 'hcaptcha';
      }

      if (document.querySelector('.g-recaptcha[data-sitekey]')) {
        return 'recaptcha-v2';
      }

      const externalScripts = Array.from(
        document.querySelectorAll('script[src]')
      ) as HTMLScriptElement[];
      const hasV3Script = externalScripts.some(
        (s) => s.src.includes('recaptcha/api.js?render=') && !s.src.includes('render=explicit')
      );
      if (hasV3Script) return 'recaptcha-v3';

      if (document.querySelector('iframe[src*="recaptcha/api2/anchor"]')) {
        return 'recaptcha-v2';
      }

      return null;
    });
  }

  // ---------------------------------------------------------------------------
  // Cloudflare — browser-based, no API key needed
  // ---------------------------------------------------------------------------

  /**
   * Wait for Cloudflare's JS challenge to self-resolve.
   * A real Chromium browser executes the challenge JS, passes fingerprinting,
   * and receives a cf_clearance cookie automatically.
   */
  static async solveCloudflare(page: Page): Promise<boolean> {
    try {
      await page.setExtraHTTPHeaders({ 'User-Agent': CF_USER_AGENT });

      const isTurnstileWidget = await page.evaluate(
        () =>
          document.querySelector('.cf-turnstile') !== null &&
          document.title !== 'Just a moment...'
      );

      if (isTurnstileWidget) {
        await page.waitForTimeout(3000);
        return true;
      }

      await page.waitForFunction(
        () => document.title !== 'Just a moment...',
        { timeout: CF_CHALLENGE_TIMEOUT_MS }
      );
      await page.waitForLoadState('domcontentloaded');
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // reCAPTCHA v2 — audio challenge (free) → 2captcha token (paid fallback)
  // ---------------------------------------------------------------------------

  async solveRecaptchaV2(page: Page): Promise<boolean> {
    // Free path: audio challenge transcribed via Groq Whisper
    if (this.groqApiKey) {
      const solved = await this.solveRecaptchaV2Audio(page);
      if (solved) return true;
    }

    // Paid fallback: 2captcha token injection
    if (this.twoCaptchaKey) {
      return this.solveRecaptchaV2Token(page);
    }

    return false;
  }

  /**
   * Free reCAPTCHA v2 solver using the audio accessibility challenge.
   *
   * Flow:
   *  1. Click the "I'm not a robot" checkbox — may auto-pass (score is fine).
   *  2. If a challenge appears, switch to the audio track.
   *  3. Download the MP3 and transcribe it with Groq's free Whisper endpoint.
   *  4. Submit the transcription and verify the token was set.
   */
  private async solveRecaptchaV2Audio(page: Page): Promise<boolean> {
    try {
      // Step 1: click the checkbox in the anchor iframe
      const anchorFrame = page.frames().find(
        (f) => f.url().includes('recaptcha/api2/anchor') || f.url().includes('recaptcha/enterprise/anchor')
      );
      if (!anchorFrame) return false;

      const checkbox = await anchorFrame.$('#recaptcha-anchor, .recaptcha-checkbox');
      if (!checkbox || !(await checkbox.isVisible())) return false;

      await checkbox.click();
      await page.waitForTimeout(1500);

      // Check if it auto-passed (no challenge frame appeared)
      const autoPassed = await page.evaluate((): boolean => {
        const el = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement | null;
        return !!el?.value;
      });
      if (autoPassed) return true;

      // Step 2: find the challenge iframe (bframe)
      const bframe = page.frames().find(
        (f) => f.url().includes('recaptcha/api2/bframe') || f.url().includes('recaptcha/enterprise/bframe')
      );
      if (!bframe) return false;

      // Click the audio button
      const audioBtn = await bframe.$('#recaptcha-audio-button');
      if (!audioBtn || !(await audioBtn.isVisible())) return false;
      await audioBtn.click();
      await page.waitForTimeout(1000);

      // Step 3: get the audio URL
      const audioUrl = await bframe.evaluate((): string | null => {
        const link = document.querySelector(
          '.rc-audiochallenge-tdownload-link'
        ) as HTMLAnchorElement | null;
        if (link?.href) return link.href;

        const source = document.querySelector('#audio-source') as HTMLSourceElement | null;
        return source?.src ?? null;
      });

      if (!audioUrl) return false;

      // Step 4: download audio
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) return false;
      const audioBuffer = await audioRes.arrayBuffer();

      // Step 5: transcribe with Groq Whisper (free)
      const transcription = await this.transcribeWithGroq(audioBuffer);
      if (!transcription) return false;

      // Step 6: type transcription and verify
      const responseField = await bframe.$('#audio-response');
      if (!responseField) return false;

      await responseField.click();
      await responseField.fill(transcription.toLowerCase().trim());
      await page.waitForTimeout(300);

      await bframe.click('#recaptcha-verify-button');
      await page.waitForTimeout(2000);

      // Confirm token was issued
      const token = await page.evaluate(
        (): string => (document.getElementById('g-recaptcha-response') as HTMLTextAreaElement | null)?.value ?? ''
      );
      return token.length > 0;
    } catch {
      return false;
    }
  }

  private async transcribeWithGroq(audioBuffer: ArrayBuffer): Promise<string | null> {
    if (!this.groqApiKey) return null;
    try {
      const formData = new FormData();
      formData.append('file', new Blob([audioBuffer], { type: 'audio/mp3' }), 'audio.mp3');
      formData.append('model', 'whisper-large-v3');
      formData.append('response_format', 'text');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.groqApiKey}` },
        body: formData,
      });

      return res.ok ? res.text() : null;
    } catch {
      return null;
    }
  }

  private async solveRecaptchaV2Token(page: Page): Promise<boolean> {
    const sitekey = await page.evaluate((): string | null => {
      const el = document.querySelector('.g-recaptcha[data-sitekey]') as HTMLElement | null;
      if (el) return el.getAttribute('data-sitekey');

      const iframe = document.querySelector(
        'iframe[src*="recaptcha/api2/anchor"]'
      ) as HTMLIFrameElement | null;
      return iframe?.src.match(/[?&]k=([^&]+)/)?.[1] ?? null;
    });

    if (!sitekey) return false;

    const token = await this.submitAndPoll('userrecaptcha', {
      googlekey: sitekey,
      pageurl: page.url(),
    });
    if (!token) return false;

    await page.evaluate((t: string) => {
      const textarea = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement | null;
      if (textarea) {
        textarea.style.display = 'block';
        textarea.value = t;
      }
      try {
        const cfg = (
          window as unknown as {
            ___grecaptcha_cfg?: { clients?: Record<string, { callback?: (t: string) => void }> };
          }
        ).___grecaptcha_cfg;
        if (cfg?.clients) {
          for (const client of Object.values(cfg.clients)) {
            if (typeof client?.callback === 'function') {
              client.callback(t);
              break;
            }
          }
        }
      } catch {
        // best-effort
      }
    }, token);

    return true;
  }

  // ---------------------------------------------------------------------------
  // hCaptcha — audio challenge via Groq (free) → 2captcha token (paid fallback)
  // ---------------------------------------------------------------------------

  async solveHCaptcha(page: Page): Promise<boolean> {
    // Free path: audio challenge transcribed via Groq Whisper
    if (this.groqApiKey) {
      const solved = await this.solveHCaptchaAudio(page);
      if (solved) return true;
    }

    // Paid fallback: 2captcha token injection
    if (this.twoCaptchaKey) {
      return this.solveHCaptchaToken(page);
    }

    return false;
  }

  /**
   * Free hCaptcha solver using the audio accessibility challenge.
   *
   * hCaptcha loads its checkbox and challenge in a single iframe (unlike
   * reCAPTCHA which splits them across anchor/bframe). After clicking the
   * checkbox, if a challenge is required an audio tab appears inside the same
   * iframe. We click it, fetch the audio, transcribe with Groq, and submit.
   */
  private async solveHCaptchaAudio(page: Page): Promise<boolean> {
    try {
      // Find the hCaptcha widget iframe
      const hcFrame = page.frames().find(
        (f) =>
          f.url().includes('hcaptcha.com') &&
          (f.url().includes('/captcha/v1') || f.url().includes('newassets.hcaptcha.com'))
      );
      if (!hcFrame) return false;

      // Click the checkbox to trigger the challenge
      const checkbox = await hcFrame.$('#checkbox, [id*="checkbox"], [role="checkbox"]');
      if (!checkbox || !(await checkbox.isVisible())) return false;
      await checkbox.click();
      await page.waitForTimeout(2000);

      // Check if it auto-passed (hCaptcha sometimes does this with good fingerprinting)
      const autoPassed = await page.evaluate((): boolean => {
        const el = document.querySelector('[name="h-captcha-response"]') as HTMLTextAreaElement | null;
        return !!el?.value;
      });
      if (autoPassed) return true;

      // Look for the audio/speaker tab button within the iframe
      const audioBtn = await hcFrame.$(
        'button[data-type="audio"], .challenge-switch-button[aria-label*="audio" i], button[aria-label*="audio" i], .audio-tab'
      );
      if (!audioBtn || !(await audioBtn.isVisible())) return false;
      await audioBtn.click();
      await page.waitForTimeout(1000);

      // Get audio URL — hCaptcha uses an <audio> element or a data attribute
      const audioUrl = await hcFrame.evaluate((): string | null => {
        const audio = document.querySelector('audio') as HTMLAudioElement | null;
        if (audio?.src) return audio.src;

        const source = document.querySelector('audio source') as HTMLSourceElement | null;
        if (source?.src) return source.src;

        // Some versions store it in a data attribute
        const el = document.querySelector('[data-audio-src]') as HTMLElement | null;
        return el?.getAttribute('data-audio-src') ?? null;
      });

      if (!audioUrl) return false;

      // Download and transcribe
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) return false;
      const audioBuffer = await audioRes.arrayBuffer();

      const transcription = await this.transcribeWithGroq(audioBuffer);
      if (!transcription) return false;

      // Type transcription into the answer field
      const answerInput = await hcFrame.$(
        'input.answer-input, input[type="text"], #challenge-audio-text-input, [placeholder*="answer" i]'
      );
      if (!answerInput) return false;

      await answerInput.click();
      await answerInput.fill(transcription.toLowerCase().trim());
      await page.waitForTimeout(300);

      // Submit
      const submitBtn = await hcFrame.$(
        'button[type="submit"], .button-submit, [data-type="submit"]'
      );
      if (!submitBtn) return false;
      await submitBtn.click();
      await page.waitForTimeout(2000);

      // Confirm token was issued
      const token = await page.evaluate(
        (): string =>
          (document.querySelector('[name="h-captcha-response"]') as HTMLTextAreaElement | null)?.value ?? ''
      );
      return token.length > 0;
    } catch {
      return false;
    }
  }

  private async solveHCaptchaToken(page: Page): Promise<boolean> {
    const sitekey = await page.evaluate((): string | null => {
      const el = document.querySelector('[data-sitekey]') as HTMLElement | null;
      return el?.getAttribute('data-sitekey') ?? null;
    });

    if (!sitekey) return false;

    const token = await this.submitAndPoll('hcaptcha', { sitekey, pageurl: page.url() });
    if (!token) return false;

    await page.evaluate((t: string) => {
      for (const name of ['h-captcha-response', 'g-recaptcha-response']) {
        const el = document.querySelector(`[name="${name}"]`) as HTMLTextAreaElement | null;
        if (el) el.value = t;
      }
      try {
        const hc = (
          window as unknown as {
            hcaptcha?: { widgets?: Record<string, { s?: { callback?: (t: string) => void } }> };
          }
        ).hcaptcha;
        if (hc?.widgets) {
          const first = Object.values(hc.widgets)[0];
          if (typeof first?.s?.callback === 'function') first.s.callback(t);
        }
      } catch {
        // best-effort
      }
    }, token);

    return true;
  }

  // ---------------------------------------------------------------------------
  // reCAPTCHA v3 — score-based; stealth handles most cases, token as fallback
  // ---------------------------------------------------------------------------

  async solveRecaptchaV3(page: Page): Promise<boolean> {
    if (!this.twoCaptchaKey) return false;

    const { sitekey, action } = await page.evaluate(
      (): { sitekey: string | null; action: string } => {
        const scripts = Array.from(
          document.querySelectorAll('script[src*="recaptcha/api.js?render="]')
        ) as HTMLScriptElement[];
        const sitekey = scripts[0]?.src?.match(/render=([^&]+)/)?.[1] ?? null;
        const el = document.querySelector('[data-action]') as HTMLElement | null;
        return { sitekey, action: el?.getAttribute('data-action') ?? 'submit' };
      }
    );

    if (!sitekey) return false;

    const token = await this.submitAndPoll('userrecaptcha', {
      googlekey: sitekey,
      pageurl: page.url(),
      version: 'v3',
      action,
      min_score: '0.3',
    });
    if (!token) return false;

    await page.evaluate((t: string) => {
      const el = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement | null;
      if (el) el.value = t;
    }, token);

    return true;
  }

  // ---------------------------------------------------------------------------
  // 2captcha polling (used by hCaptcha and reCAPTCHA v3 token paths)
  // ---------------------------------------------------------------------------

  private async submitAndPoll(
    method: string,
    params: Record<string, string>
  ): Promise<string | null> {
    if (!this.twoCaptchaKey) return null;

    const submitParams = new URLSearchParams({ key: this.twoCaptchaKey, method, ...params });
    const submitRes = await fetch(`${TWOCAPTCHA_IN_URL}?${submitParams}`);
    const submitText = await submitRes.text();
    if (!submitText.startsWith('OK|')) return null;

    const requestId = submitText.split('|')[1];

    for (let i = 0; i < this.maxPollAttempts; i++) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));

      const pollRes = await fetch(
        `${TWOCAPTCHA_RES_URL}?key=${this.twoCaptchaKey}&action=get&id=${requestId}`
      );
      const pollText = await pollRes.text();

      if (pollText === 'CAPCHA_NOT_READY') continue;
      if (pollText.startsWith('OK|')) return pollText.split('|')[1];
      return null;
    }

    return null;
  }
}

/**
 * Returns a solver configured from environment variables.
 * Works with no paid keys — GROQ_API_KEY alone enables free reCAPTCHA v2 solving.
 * Returns null only if no keys at all are configured.
 */
export function createCaptchaSolver(): CaptchaSolver | null {
  const groqApiKey = process.env.GROQ_API_KEY;
  const twoCaptchaKey = process.env.TWOCAPTCHA_API_KEY;

  if (!groqApiKey && !twoCaptchaKey) return null;

  return new CaptchaSolver({ groqApiKey, twoCaptchaKey });
}
