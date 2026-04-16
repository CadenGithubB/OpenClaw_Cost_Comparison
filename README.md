# OpenClaw Cost Comparison

A simple tool that shows you what your self-hosted LLM usage would have cost if you were paying for cloud API access instead.

Built for people running [OpenClaw](https://github.com/open-claw) with Ollama who are curious whether self-hosting is actually saving them money.

**Live site:** [cadengithubb.github.io/OpenClaw_Cost_Comparison](https://cadengithubb.github.io/OpenClaw_Cost_Comparison/)

## What it does

You paste your OpenClaw usage export (JSON) into the page and it breaks down:

- How many tokens each of your local models used
- What that usage would cost through the cheapest hosted API equivalents (DeepInfra, OpenRouter, Google AI Studio, etc.)
- What it would cost on popular closed-source models (GPT-4o, Claude, Gemini, etc.)
- Your actual self-hosting cost factoring in hardware and electricity

## Features

- **Model role assignment** - Tag models as Primary, Heartbeat, Background, etc. to see per-role cost breakdowns and filter the comparison tables to just the models you care about.
- **Hardware cost tracking** - Enter your hardware cost as a lump sum or amortized over months. Electricity costs are calculated separately.
- **Closed-source comparison builder** - Add specific closed-source models to compare against rather than seeing all of them at once. Each can be scoped to a specific role's token volume.
- **Per-million-token rates** - The API cost table shows both the provider's rate per million tokens and your total cost for that model.

## Privacy

Everything runs in your browser. No data is sent anywhere. The JSON never leaves your machine.

## Model mappings

The tool maps local Ollama model names to their closest hosted equivalents:

| Local Model | API Equivalent | Provider |
|---|---|---|
| gemma4:31b | Gemma 4 31B | Google AI Studio |
| qwen2.5:7b-instruct | Qwen2.5 7B | DeepInfra |
| qwen3:32b | Qwen3 32B | OpenRouter |
| qwen3.5:35b-a3b | Qwen3.5 35B-A3B | OpenRouter |

Some models don't have exact hosted equivalents, so the tool uses the nearest available size and notes this in the table.

Pricing data was last updated April 2026. Rates change frequently so always verify with the provider before making decisions based on these numbers.

## Running locally

It's a single HTML file with no dependencies. Any static file server works:

```
python3 -m http.server 8080
```

Then open http://localhost:8080.

## License

Do whatever you want with it.
