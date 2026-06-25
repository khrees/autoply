import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { configRepository } from '../db/repositories/config';
import { credentialStore } from '../db/repositories/secure-credentials';
import type { AIProviderType } from '../types';
import { readFile } from 'fs/promises';

export interface VerificationResult {
  submitted: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  errors?: string[];
}

const VISION_MODELS: Partial<Record<AIProviderType, string>> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-5-20250929',
  google: 'gemini-2.0-flash',
};

async function createVisionModel(provider: AIProviderType) {
  const modelId = VISION_MODELS[provider];
  if (!modelId) {
    throw new Error(`Vision not supported for provider: ${provider}`);
  }

  // Resolve API key the same way the main provider does: env > keychain > config
  let apiKey: string | null = null;
  if (provider === 'openai') apiKey = process.env.OPENAI_API_KEY ?? null;
  if (provider === 'anthropic') apiKey = process.env.ANTHROPIC_API_KEY ?? null;
  if (provider === 'google') apiKey = process.env.GOOGLE_API_KEY ?? null;

  if (!apiKey) {
    apiKey = await credentialStore.getApiKey(provider as 'openai' | 'anthropic' | 'google');
  }

  if (!apiKey) {
    const config = configRepository.loadAppConfig();
    apiKey = config.ai.apiKey ?? null;
  }

  if (!apiKey) {
    throw new Error(
      `Missing API key for ${provider}. Set the environment variable or store securely.`
    );
  }

  switch (provider) {
    case 'openai': {
      const openai = createOpenAI({ apiKey });
      return openai(modelId);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(modelId);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(modelId);
    }
    default:
      throw new Error(`Vision not supported for provider: ${provider}`);
  }
}

export async function verifySubmissionScreenshot(
  screenshotPath: string
): Promise<VerificationResult> {
  const config = configRepository.loadAppConfig();
  const provider = config.ai.provider;

  // Check if vision is supported
  if (!VISION_MODELS[provider]) {
    // Fallback: assume not submitted if we can't verify
    return {
      submitted: false,
      confidence: 'low',
      reason: `Vision verification not available for ${provider}. Cannot confirm submission.`,
    };
  }

  try {
    const imageBuffer = await readFile(screenshotPath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = screenshotPath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    const model = await createVisionModel(provider);

    const result = await generateText({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: `data:${mimeType};base64,${base64Image}`,
            },
            {
              type: 'text',
              text: `Analyze this screenshot of a job application form submission page.

Determine if the application was SUCCESSFULLY SUBMITTED or NOT.

Look for:
- SUCCESS indicators: "Thank you", "Application submitted", "We received your application", confirmation messages, success banners, green checkmarks
- FAILURE indicators: Form still visible with empty fields, error messages, validation errors (red text, "required", "please fill"), the submit button still visible and clickable
- Focus on confirmation state only. Do NOT infer or invent the applicant's name, email, phone number, or other personal details.
- If personal details are not clearly legible in the screenshot, omit them from your reasoning.

Respond in JSON format:
{
  "submitted": true/false,
  "confidence": "high" | "medium" | "low",
  "reason": "Brief explanation of what you see",
  "errors": ["list of any visible error messages"] // optional
}

Be conservative: if unsure, say submitted: false.`,
            },
          ],
        },
      ],
      temperature: 0.1,
    });

    // Parse the JSON response
    const text = result.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        submitted: false,
        confidence: 'low',
        reason: 'Could not parse verification response',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as VerificationResult;
    return {
      submitted: Boolean(parsed.submitted),
      confidence: parsed.confidence || 'medium',
      reason: parsed.reason || 'Unknown',
      errors: parsed.errors,
    };
  } catch (error) {
    return {
      submitted: false,
      confidence: 'low',
      reason: `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
