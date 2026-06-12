from __future__ import annotations

import json
import sys
import threading
import types
from pathlib import Path

import pytest
from flask import Flask


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

sys.modules.setdefault("giturlparse", types.SimpleNamespace(parse=lambda *args, **kwargs: None))


class _DummyObserver:
    def __init__(self):
        self._alive = False

    def is_alive(self):
        return self._alive

    def start(self):
        self._alive = True

    def stop(self):
        self._alive = False

    def join(self, *args, **kwargs):
        return None

    def unschedule_all(self):
        return None

    def schedule(self, *args, **kwargs):
        return None


watchdog = types.ModuleType("watchdog")
watchdog.observers = types.SimpleNamespace(Observer=_DummyObserver)
watchdog.events = types.SimpleNamespace(FileSystemEventHandler=object)
sys.modules.setdefault("watchdog", watchdog)
sys.modules.setdefault("watchdog.observers", watchdog.observers)
sys.modules.setdefault("watchdog.events", watchdog.events)


def _prepare_a0_tree(monkeypatch, tmp_path: Path):
    from helpers import files, plugins

    monkeypatch.setattr(files, "_base_dir", str(tmp_path))
    monkeypatch.setattr(
        plugins,
        "call_plugin_hook",
        lambda plugin_name, hook_name, default=None, **kwargs: default,
    )

    plugin_dir = tmp_path / "plugins" / "_model_config"
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "plugin.yaml").write_text(
        "name: _model_config\nper_project_config: true\nper_agent_config: true\n",
        encoding="utf-8",
    )
    (plugin_dir / "default_presets.yaml").write_text(
        """
- name: Default Balance
  chat:
    provider: openrouter
    name: default-chat
  utility:
    provider: openrouter
    name: default-utility
""".lstrip(),
        encoding="utf-8",
    )
    (plugin_dir / "default_config.yaml").write_text(
        """
allow_chat_override: true
chat_model:
  provider: openrouter
  name: configured-chat
utility_model:
  provider: openrouter
  name: configured-utility
embedding_model:
  provider: huggingface
  name: configured-embedding
""".lstrip(),
        encoding="utf-8",
    )
    (tmp_path / "usr" / "projects").mkdir(parents=True)


def test_global_presets_keep_legacy_default_and_save_behavior(monkeypatch, tmp_path):
    _prepare_a0_tree(monkeypatch, tmp_path)

    from plugins._model_config.helpers import model_config

    assert model_config.get_presets()[0]["name"] == "Default Balance"

    model_config.save_presets(
        [
            {
                "name": "Global One",
                "scope": "project",
                "project_name": "ignored",
                "chat": {"provider": "openai", "name": "gpt-test", "_kwargs_text": ""},
            }
        ]
    )

    presets = model_config.get_presets()
    assert presets == [
        {"name": "Global One", "chat": {"provider": "openai", "name": "gpt-test"}}
    ]

    saved_path = tmp_path / "usr" / "plugins" / "_model_config" / "presets.yaml"
    assert "scope:" not in saved_path.read_text(encoding="utf-8")

    model_config.save_presets([])
    assert model_config.get_presets() == []

    assert model_config.reset_presets()[0]["name"] == "Default Balance"


def test_project_presets_are_separate_and_resolve_by_scope(monkeypatch, tmp_path):
    _prepare_a0_tree(monkeypatch, tmp_path)

    from helpers import projects
    from plugins._model_config.helpers import model_config

    projects.create_project("demo", {"title": "Demo"})
    model_config.save_presets(
        [{"name": "Shared", "chat": {"provider": "global", "name": "chat"}}]
    )
    model_config.save_presets(
        [{"name": "Shared", "chat": {"provider": "project", "name": "chat"}}],
        project_name="demo",
    )

    assert model_config.get_presets()[0]["chat"]["provider"] == "global"
    assert model_config.get_project_presets("demo")[0]["chat"]["provider"] == "project"

    combined = model_config.get_combined_presets("demo")
    assert [(item["scope"], item["project_name"], item["name"]) for item in combined] == [
        ("global", "", "Shared"),
        ("project", "demo", "Shared"),
    ]
    assert model_config.resolve_preset("Shared", scope="global")["chat"]["provider"] == "global"
    assert (
        model_config.resolve_preset("Shared", scope="project", project_name="demo")["chat"]["provider"]
        == "project"
    )


def test_bundled_utility_presets_inherit_advanced_settings():
    import yaml

    presets_path = PROJECT_ROOT / "plugins" / "_model_config" / "default_presets.yaml"
    presets = yaml.safe_load(presets_path.read_text(encoding="utf-8"))

    for preset in presets:
        utility = preset.get("utility") or {}
        assert "ctx_length" not in utility
        assert "ctx_input" not in utility


@pytest.mark.asyncio
async def test_model_presets_api_returns_global_or_combined_by_project(monkeypatch, tmp_path):
    _prepare_a0_tree(monkeypatch, tmp_path)

    from helpers import projects
    from plugins._model_config.api.model_presets import ModelPresets
    from plugins._model_config.helpers import model_config

    projects.create_project("demo", {"title": "Demo"})
    model_config.save_presets(
        [{"name": "Global", "chat": {"provider": "global", "name": "chat"}}]
    )
    model_config.save_presets(
        [{"name": "Project", "chat": {"provider": "project", "name": "chat"}}],
        project_name="demo",
    )

    handler = ModelPresets(Flask(__name__), threading.Lock())
    global_response = await handler.process({"action": "get"}, None)
    assert global_response["presets"] == [
        {"name": "Global", "chat": {"provider": "global", "name": "chat"}}
    ]
    assert "scope" not in global_response["presets"][0]

    project_response = await handler.process({"action": "get", "project_name": "demo"}, None)
    assert [(p["scope"], p["name"]) for p in project_response["presets"]] == [
        ("global", "Global"),
        ("project", "Project"),
    ]


def test_project_save_copies_selected_preset_to_scoped_model_config(monkeypatch, tmp_path):
    _prepare_a0_tree(monkeypatch, tmp_path)

    from helpers import projects
    from plugins._model_config.helpers import model_config

    model_config.save_presets(
        [
            {
                "name": "Research",
                "chat": {"provider": "anthropic", "name": "claude-research"},
                "utility": {"provider": "openai", "name": "utility-research"},
            }
        ]
    )

    projects.create_project(
        "demo",
        {
            "title": "Demo",
            "llm": {
                "selected_preset": {"scope": "global", "name": "Research"},
            },
        },
    )

    config_path = (
        tmp_path
        / "usr"
        / "projects"
        / "demo"
        / ".a0proj"
        / "plugins"
        / "_model_config"
        / "config.json"
    )
    config = json.loads(config_path.read_text(encoding="utf-8"))
    assert config["chat_model"]["name"] == "claude-research"
    assert config["utility_model"]["name"] == "utility-research"
    assert config["embedding_model"]["name"] == "configured-embedding"

    project_json = (
        tmp_path / "usr" / "projects" / "demo" / ".a0proj" / "project.json"
    ).read_text(encoding="utf-8")
    assert "llm" not in project_json
    assert "_model_config" not in project_json


def test_preset_application_deep_merges_model_slots(monkeypatch, tmp_path):
    _prepare_a0_tree(monkeypatch, tmp_path)

    from plugins._model_config.helpers import model_config

    base_config = {
        "allow_chat_override": True,
        "chat_model": {
            "provider": "openrouter",
            "name": "configured-chat",
            "ctx_length": 200000,
            "ctx_history": 0.5,
            "kwargs": {"temperature": 0.2, "routing": {"order": ["a", "b"]}},
        },
        "utility_model": {
            "provider": "openrouter",
            "name": "configured-utility",
            "ctx_length": 200000,
            "ctx_input": 0.4,
            "kwargs": {"temperature": 0.1, "routing": {"order": ["fast"]}},
        },
        "embedding_model": {
            "provider": "huggingface",
            "name": "configured-embedding",
            "kwargs": {"device": "cpu", "batch_size": 16},
        },
    }
    preset = {
        "name": "Research",
        "chat": {
            "provider": "anthropic",
            "name": "claude-research",
            "kwargs": {"routing": {"priority": "quality"}},
        },
        "utility": {
            "provider": "openrouter",
            "name": "utility-research",
            "kwargs": {"routing": {"timeout": 30}},
        },
        "embedding": {
            "provider": "openai",
            "name": "text-embedding-3-large",
        },
    }

    config = model_config.build_config_from_preset(preset, base_config)

    assert config["chat_model"]["name"] == "claude-research"
    assert config["chat_model"]["ctx_length"] == 200000
    assert config["chat_model"]["kwargs"] == {
        "temperature": 0.2,
        "routing": {"order": ["a", "b"], "priority": "quality"},
    }
    assert config["utility_model"]["name"] == "utility-research"
    assert config["utility_model"]["ctx_length"] == 200000
    assert config["utility_model"]["ctx_input"] == 0.4
    assert config["utility_model"]["kwargs"] == {
        "temperature": 0.1,
        "routing": {"order": ["fast"], "timeout": 30},
    }
    assert config["embedding_model"]["name"] == "text-embedding-3-large"
    assert config["embedding_model"]["kwargs"] == {"device": "cpu", "batch_size": 16}


def test_preset_application_inherits_optional_slots(monkeypatch, tmp_path):
    _prepare_a0_tree(monkeypatch, tmp_path)

    from plugins._model_config.helpers import model_config

    base_config = {
        "chat_model": {"provider": "openrouter", "name": "configured-chat"},
        "utility_model": {
            "provider": "openrouter",
            "name": "configured-utility",
            "ctx_length": 200000,
        },
        "embedding_model": {
            "provider": "huggingface",
            "name": "configured-embedding",
        },
    }
    preset = {
        "name": "Chat Only",
        "chat": {"provider": "anthropic", "name": "claude-research"},
        "utility": {"ctx_length": 128000},
    }

    config = model_config.build_config_from_preset(preset, base_config)

    assert config["chat_model"]["name"] == "claude-research"
    assert config["utility_model"] == base_config["utility_model"]
    assert config["embedding_model"] == base_config["embedding_model"]


def test_legacy_utility_preset_defaults_do_not_override_tuned_config(monkeypatch, tmp_path):
    _prepare_a0_tree(monkeypatch, tmp_path)

    from plugins._model_config.helpers import model_config

    base_config = {
        "utility_model": {
            "provider": "openrouter",
            "name": "configured-utility",
            "api_base": "https://custom.example/v1",
            "ctx_length": 200000,
            "ctx_input": 0.4,
            "rl_requests": 12,
            "rl_input": 34000,
            "rl_output": 56000,
            "kwargs": {"temperature": 0.1},
        },
    }
    preset = {
        "name": "Legacy Saved Preset",
        "utility": {
            "provider": "openrouter",
            "name": "preset-utility",
            "api_key": "",
            "api_base": "",
            "ctx_length": 128000,
            "ctx_input": 0.7,
            "rl_requests": 0,
            "rl_input": 0,
            "rl_output": 0,
            "kwargs": {},
        },
    }

    config = model_config.build_config_from_preset(
        preset,
        base_config,
        strip_api_key=False,
    )

    utility = config["utility_model"]
    assert utility["name"] == "preset-utility"
    assert utility["api_base"] == ""
    assert "api_key" not in utility
    assert utility["ctx_length"] == 200000
    assert utility["ctx_input"] == 0.4
    assert utility["rl_requests"] == 12
    assert utility["rl_input"] == 34000
    assert utility["rl_output"] == 56000
    assert utility["kwargs"] == {"temperature": 0.1}


def test_preset_override_preserves_configured_utility_context(monkeypatch, tmp_path):
    _prepare_a0_tree(monkeypatch, tmp_path)

    from plugins._model_config.helpers import model_config

    base_config = {
        "allow_chat_override": True,
        "chat_model": {"provider": "openrouter", "name": "configured-chat"},
        "utility_model": {
            "provider": "openrouter",
            "name": "configured-utility",
            "ctx_length": 200000,
            "ctx_input": 0.4,
        },
    }
    preset = {
        "name": "Fast",
        "chat": {"provider": "openrouter", "name": "fast-chat"},
        "utility": {"provider": "openrouter", "name": "fast-utility"},
    }

    class FakeContext:
        def get_data(self, key):
            return {"preset_name": "Fast"} if key == "chat_model_override" else None

    class FakeAgent:
        context = FakeContext()

    monkeypatch.setattr(model_config, "get_config", lambda *args, **kwargs: base_config)
    monkeypatch.setattr(
        model_config,
        "get_preset_by_name",
        lambda name, **kwargs: preset if name == "Fast" else None,
    )

    utility = model_config.get_utility_model_config(FakeAgent())

    assert utility["name"] == "fast-utility"
    assert utility["ctx_length"] == 200000
    assert utility["ctx_input"] == 0.4


def test_project_save_disambiguates_same_name_project_preset(monkeypatch, tmp_path):
    _prepare_a0_tree(monkeypatch, tmp_path)

    from helpers import projects
    from plugins._model_config.helpers import model_config

    model_config.save_presets(
        [{"name": "Shared", "chat": {"provider": "global", "name": "chat"}}]
    )
    projects.create_project(
        "demo",
        {
            "title": "Demo",
            "llm": {
                "selected_preset": {
                    "scope": "project",
                    "project_name": "demo",
                    "name": "Shared",
                },
                "project_presets": [
                    {"name": "Shared", "chat": {"provider": "project", "name": "chat"}}
                ],
            },
        },
    )

    config = json.loads(
        (
            tmp_path
            / "usr"
            / "projects"
            / "demo"
            / ".a0proj"
            / "plugins"
            / "_model_config"
            / "config.json"
        ).read_text(encoding="utf-8")
    )
    assert config["chat_model"]["provider"] == "project"

    presets_yaml = (
        tmp_path
        / "usr"
        / "projects"
        / "demo"
        / ".a0proj"
        / "plugins"
        / "_model_config"
        / "presets.yaml"
    ).read_text(encoding="utf-8")
    assert "scope:" not in presets_yaml
    assert "project_name:" not in presets_yaml
