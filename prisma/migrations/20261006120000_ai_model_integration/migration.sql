-- An org's own key for an OpenAI-compatible model API (OpenAI, Gemini,
-- OpenRouter, Mistral, Groq, Together, DeepSeek, xAI), used by the AI
-- imports next to the existing Claude integration. Nothing else changes:
-- the key is an OrgSecret like every other integration secret (envelope
-- encrypted, reached only through app.secret_*), the display row is an
-- OrgIntegration with the same policies, and the vendor's address is fixed
-- in code (src/lib/ai/vendors.ts), never stored.

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'OPENAI_COMPATIBLE';
