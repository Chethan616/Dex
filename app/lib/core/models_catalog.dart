// Model catalog for the /model picker — the providers Dex can use as the
// brain and a curated set of current models per provider. Ids are in
// gateway form (`provider/model`) so they drop straight into
// agents.defaults.model.primary via DexSetup.applyBrainModel.
//
// This is a display catalog, not an exhaustive registry; it covers the
// models people actually pick. Unknown-but-valid ids can still be set by
// the agent/config — this just powers the picker UI.

class ModelOption {
  const ModelOption(this.id, this.label);

  /// Gateway-form id, e.g. `anthropic/claude-sonnet-4-6`.
  final String id;
  final String label;
}

class ProviderModels {
  const ProviderModels({
    required this.id,
    required this.name,
    required this.getKeyUrl,
    required this.models,
    this.needsKey = true,
  });

  final String id; // matches auth/provider id (anthropic, google, ...)
  final String name;
  final String getKeyUrl;
  final List<ModelOption> models;

  /// Local providers (Ollama) need no API key.
  final bool needsKey;
}

const List<ProviderModels> kModelCatalog = <ProviderModels>[
  ProviderModels(
    id: 'google',
    name: 'Google Gemini',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    models: <ModelOption>[
      ModelOption('google/gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite (free, fast)'),
      ModelOption('google/gemini-2.5-flash', 'Gemini 2.5 Flash'),
      ModelOption('google/gemini-2.5-pro', 'Gemini 2.5 Pro'),
      ModelOption('google/gemini-2.0-flash', 'Gemini 2.0 Flash'),
    ],
  ),
  ProviderModels(
    id: 'anthropic',
    name: 'Anthropic Claude',
    getKeyUrl: 'https://console.anthropic.com/account/keys',
    models: <ModelOption>[
      ModelOption('anthropic/claude-sonnet-4-6', 'Claude Sonnet 4.6'),
      ModelOption('anthropic/claude-opus-4-1', 'Claude Opus 4.1'),
      ModelOption('anthropic/claude-haiku-4-5', 'Claude Haiku 4.5 (fast)'),
    ],
  ),
  ProviderModels(
    id: 'openai',
    name: 'OpenAI',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    models: <ModelOption>[
      ModelOption('openai/gpt-5.5', 'GPT-5.5'),
      ModelOption('openai/gpt-5.1', 'GPT-5.1'),
      ModelOption('openai/gpt-5-mini', 'GPT-5 mini (fast)'),
    ],
  ),
  ProviderModels(
    id: 'groq',
    name: 'Groq',
    getKeyUrl: 'https://console.groq.com/keys',
    models: <ModelOption>[
      ModelOption('groq/llama-3.3-70b-versatile', 'Llama 3.3 70B (fast, free)'),
      ModelOption('groq/qwen/qwen3-32b', 'Qwen 3 32B'),
    ],
  ),
  ProviderModels(
    id: 'openrouter',
    name: 'OpenRouter',
    getKeyUrl: 'https://openrouter.ai/keys',
    models: <ModelOption>[
      ModelOption('openrouter/anthropic/claude-sonnet-4-6', 'Claude Sonnet 4.6 (via OpenRouter)'),
      ModelOption('openrouter/openai/gpt-5.1', 'GPT-5.1 (via OpenRouter)'),
      ModelOption('openrouter/google/gemini-2.5-flash', 'Gemini 2.5 Flash (via OpenRouter)'),
    ],
  ),
  ProviderModels(
    id: 'mistral',
    name: 'Mistral',
    getKeyUrl: 'https://console.mistral.ai/api-keys',
    models: <ModelOption>[
      ModelOption('mistral/mistral-large-latest', 'Mistral Large'),
      ModelOption('mistral/mistral-small-latest', 'Mistral Small (fast)'),
    ],
  ),
  ProviderModels(
    id: 'xai',
    name: 'xAI Grok',
    getKeyUrl: 'https://console.x.ai',
    models: <ModelOption>[
      ModelOption('xai/grok-4', 'Grok 4'),
      ModelOption('xai/grok-4-fast', 'Grok 4 Fast'),
    ],
  ),
  ProviderModels(
    id: 'ollama',
    name: 'Ollama (local)',
    getKeyUrl: 'https://ollama.com',
    needsKey: false,
    models: <ModelOption>[
      ModelOption('ollama/llama3.3', 'Llama 3.3 (local)'),
      ModelOption('ollama/qwen2.5', 'Qwen 2.5 (local)'),
    ],
  ),
];
