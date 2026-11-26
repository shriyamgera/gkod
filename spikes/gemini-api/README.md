# Spike: calling Gemini with a new API key

Checked 26 Nov 2026 with a key created that day in Google AI Studio. The key starts with `AQ.`; AI Studio now only issues keys in this format.

## What works

New keys must use the **Interactions API**. The older `generateContent` call returns 404 for every model, including ones that `GET /v1beta/models` lists:

- Older models (2.5 Flash and earlier) return a 404 that says they are "no longer available to new users".
- Gemini 3.x models return a 404 with an empty body.

```sh
curl https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" -H "content-type: application/json" \
  -d '{"model":"gemini-3.1-flash-lite","system_instruction":"...","input":"Phone stand, 80 mm wide",
       "store":false,"generation_config":{"thinking_level":"low"}}'
```

- The key goes in the `x-goog-api-key` header, never in the URL.
- `store: false` keeps the request off Google's server-side history. The app keeps its own history.
- The answer text is in `steps[]`: take the steps with `type: "model_output"`, then their `content[]` items with `type: "text"`. Steps with `type: "thought"` carry only a signature.
- **Browser calls are allowed.** A CORS preflight from `https://shriyamgera.github.io` returns `access-control-allow-origin` for that origin, with `content-type` and `x-goog-api-key` allowed. The visitor's key can therefore be used straight from the page, with no server.

## Models on the free tier, 26 Nov 2026

| Model | Result | Time for a short OpenSCAD part |
|---|---|---|
| `gemini-3.1-flash-lite` | works | about 1.2 to 1.7 s |
| `gemini-3.5-flash-lite` | works | about 1.7 s for a one-word reply |
| `gemini-3-flash-preview` | works | 26 to 79 s with default thinking; about 3 s with `thinking_level` `low` or `minimal` |
| `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash` | 503 "high demand", every try | none |
| `gemini-3.1-pro-preview` | 429, the free-tier limit is 0 | none |

Test: a system instruction asked for named sizes with customizer ranges, a flat base, and no `minkowski()` or `text()`. Prompts were "Phone stand, 80 mm wide" and "Wall hook for a bag, two screw holes". All four answers from the two working flash models compiled with the pinned OpenSCAD build under `--hardwarnings`, each with 6 to 8 named sizes.

## What this means for the app

- The default model is `gemini-3.1-flash-lite`, because it is fast and works on a new free key.
- A model menu offers `gemini-3-flash-preview` (with `thinking_level: low`) and the 3.8 Flash model.
- On a 503, the app falls back to the next model and says which model answered.
- Model output from this engine is shown to the visitor only. It is never used as training data.
