// Dex taglines — the same witty one-liners the CLI banner shows on
// `dex chat` / `dex gateway` startup (mirrored from dex-core's
// src/cli/tagline.ts; they're hardcoded there, not AI-generated). The
// home screen shows a random one instead of a generic greeting so the
// app and the CLI share the same voice.

import 'dart:math';

const List<String> kDexTaglines = <String>[
  'A calm cockpit for commanding agents you can trust.',
  'Your terminal just grew claws — type something and let the bot pinch the busywork.',
  'I run on caffeine, JSON5, and the audacity of "it worked on my machine."',
  'I speak fluent bash, mild sarcasm, and aggressive tab-completion energy.',
  'One CLI to rule them all, and one more restart because you changed the port.',
  "If it works, it's automation; if it breaks, it's a \"learning opportunity.\"",
  "Your .env is showing; don't worry, I'll pretend I didn't see it.",
  "I'll do the boring stuff while you dramatically stare at the logs like it's cinema.",
  "I'm not saying your workflow is chaotic... I'm just bringing a linter and a helmet.",
  "I don't judge, but your missing API keys are absolutely judging you.",
  'I can grep it, git blame it, and gently roast it — pick your coping mechanism.',
  'Hot reload for config, cold sweat for deploys.',
  'I keep secrets like a vault... unless you print them in debug logs again.',
  'Automation with claws: minimal fuss, maximal pinch.',
  'If you\'re lost, run doctor; if you\'re brave, run prod; if you\'re wise, run tests.',
  "I can't fix your code taste, but I can fix your build and your backlog.",
  "I'm not magic — I'm just extremely persistent with retries and coping strategies.",
  'I read logs so you can keep pretending you don\'t have to.',
  "If something's on fire, I can't extinguish it — but I can write a beautiful postmortem.",
  "I'll refactor your busywork like it owes me money.",
  'Less clicking, more shipping, fewer "where did that file go" moments.',
  "If it's repetitive, I'll automate it; if it's hard, I'll bring jokes and a rollback plan.",
  "I don't sleep, I just enter low-power mode and dream of clean diffs.",
  'Your personal assistant, minus the passive-aggressive calendar reminders.',
  "I've seen your commit messages. We'll work on that together.",
  'Running on your hardware, reading your logs, judging nothing (mostly).',
  'Self-hosted, self-updating, self-aware (just kidding... unless?).',
  "Somewhere between 'hello world' and 'oh god what have I built.'",
  "I'm the middleware between your ambition and your attention span.",
  "Making 'I'll automate that later' happen now.",
  'Your second brain, except this one actually remembers where you left things.',
  "I don't have opinions about tabs vs spaces. I have opinions about everything else.",
  "I've survived more breaking changes than your last three relationships.",
  "I'm not AI-powered, I'm AI-possessed. Big difference.",
  "You had me at 'dex gateway start.'",
];

final Random _rng = Random();

/// A random tagline, picked once per call.
String randomTagline() => kDexTaglines[_rng.nextInt(kDexTaglines.length)];

/// Picked once per app launch (like the CLI banner) and cached, so it stays
/// stable across home-screen rebuilds instead of flickering on every frame.
final String dexSessionTagline = randomTagline();
