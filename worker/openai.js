// OpenAI adapter. It exposes the same small interface the AI service already uses (`run(model, params)`),
// so the planning, judging and budget code is unchanged. It runs only inside the Worker:
// the key comes from the OPENAI_API_KEY secret and is never sent to the browser, logged or returned.

export const DEFAULT_MODEL = "gpt-4o-mini";
// Cost accounting unit: 1 unit = US$0.00001. Rates are US$ per million tokens and can be overridden with Worker vars.
const USD_PER_UNIT = 0.00001;
export const DEFAULT_RATES = { inputPerMTok: 0.15, outputPerMTok: 0.60 };
const REASONING_MODEL = /^(o\d|gpt-5)/i;

export function ratesFor(env = {}) {
  const num = (value, fallback) => { const n = Number(value); return Number.isFinite(n) && n >= 0 && value !== "" && value != null ? n : fallback; };
  return { inputPerMTok: num(env.OPENAI_INPUT_USD_PER_MTOK, DEFAULT_RATES.inputPerMTok), outputPerMTok: num(env.OPENAI_OUTPUT_USD_PER_MTOK, DEFAULT_RATES.outputPerMTok) };
}
// Cost units per token, used both for the pre-call upper bound and for the measured cost.
export const unitsPerToken = (env = {}) => { const r = ratesFor(env); return { input: r.inputPerMTok / 1e6 / USD_PER_UNIT, output: r.outputPerMTok / 1e6 / USD_PER_UNIT }; };

export function openAIConfigured(env) { return typeof env?.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim().length > 0; }

// Build the request body. The backend alone decides the model and limits; callers cannot pass arbitrary fields.
export function buildRequest(model, params, env = {}) {
  const chosen = String(env.OPENAI_MODEL || model || DEFAULT_MODEL);
  const body = { model: chosen, messages: params.messages, store: false };
  if (!Array.isArray(body.messages) || !body.messages.length) throw new Error("OpenAI request has no messages");
  const limit = Math.min(Math.max(1, Math.floor(Number(params.max_tokens) || 1000)), 4000);
  if (REASONING_MODEL.test(chosen)) body.max_completion_tokens = limit * 4; // reasoning tokens count against the limit
  else { body.max_tokens = limit; body.temperature = 0; }
  const schema = params.response_format?.json_schema;
  if (schema) body.response_format = { type: "json_schema", json_schema: { name: "result", strict: false, schema } };
  return body;
}

export function createOpenAI(env, fetchImpl = (...args) => fetch(...args)) {
  return {
    async run(model, params) {
      if (!openAIConfigured(env)) throw Object.assign(new Error("OpenAI is not configured"), { reason: "ai_binding_unavailable" });
      const body = buildRequest(model, params, env);
      let response;
      try {
        response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
          method: "POST", redirect: "manual", signal: AbortSignal.timeout(45000),
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.OPENAI_API_KEY.trim() },
          body: JSON.stringify(body)
        });
      } catch (error) { throw new Error("OpenAI request failed to connect (" + String(error?.name || "Error").slice(0, 40) + ")"); }
      // A redirect is never followed (the key must only go to api.openai.com); with redirect "manual" it arrives here as a non-OK status.
      if (!response.ok) {
        // Report the status only. The provider's error text can echo parts of the key.
        throw new Error("OpenAI returned HTTP " + response.status);
      }
      const data = await response.json();
      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== "string" || choice?.finish_reason === "length") throw new Error("OpenAI reply was empty or truncated");
      const rate = unitsPerToken(env), usage = data.usage || {};
      const prompt = Number(usage.prompt_tokens), completion = Number(usage.completion_tokens);
      const measured = Number.isFinite(prompt) && Number.isFinite(completion);
      return { response: content, ...(measured ? { usage: { neurons: Math.ceil(prompt * rate.input + completion * rate.output), promptTokens: prompt, completionTokens: completion } } : {}) };
    }
  };
}
