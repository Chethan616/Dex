# Conch ring-zero setup

```yaml qa-scenario
id: conch-ring-zero-setup
title: Conch ring-zero setup
surface: config
coverage:
  primary:
    - config.conch-setup
  secondary:
    - channels.discord-config
    - agents.create
objective: Verify Conch can bootstrap a fresh OpenClaw config, set the default model, create an agent, configure Discord through a SecretRef, validate config, and leave an audit trail.
successCriteria:
  - Conch reports missing config in an empty state dir.
  - Conch setup writes a workspace and default model.
  - Conch creates a non-main agent with its own workspace and model.
  - Conch enables the Discord plugin before writing Discord channel config.
  - Conch configures Discord through an env SecretRef without persisting the raw token.
  - Config validation passes and audit entries exist for every applied write.
docsRefs:
  - docs/cli/conch.md
  - docs/channels/discord.md
  - docs/help/testing.md
codeRefs:
  - src/conch/operations.ts
  - scripts/e2e/conch-first-run-spec.json
  - scripts/e2e/conch-first-run-docker-client.ts
  - extensions/qa-lab/src/suite-runtime-agent-process.ts
execution:
  kind: flow
  summary: Drive the public Conch CLI in an isolated fresh state dir and verify setup/model/agent/Discord/audit results.
  config:
    specPath: scripts/e2e/conch-first-run-spec.json
```

```yaml qa-flow
steps:
  - name: bootstraps config through Conch CLI
    actions:
      - set: setupSpec
        value:
          expr: "JSON.parse(await fs.readFile(path.join(env.repoRoot, config.specPath), 'utf8'))"
      - set: stateDir
        value:
          expr: "path.join(env.gateway.tempRoot, setupSpec.stateDirName)"
      - set: configPath
        value:
          expr: "path.join(stateDir, 'openclaw.json')"
      - set: defaultWorkspace
        value:
          expr: "path.join(env.gateway.tempRoot, setupSpec.defaultWorkspaceName)"
      - set: agentWorkspace
        value:
          expr: "path.join(env.gateway.tempRoot, setupSpec.agentWorkspaceName)"
      - set: commandVars
        value:
          expr: "({ defaultWorkspace, agentWorkspace, agentId: setupSpec.agentId, model: setupSpec.model, discordEnv: setupSpec.discordEnv })"
      - set: renderCommand
        value:
          lambda:
            params:
              - template
            expr: "String(template).replace(/\\{([A-Za-z0-9_]+)\\}/g, (match, key) => String(commandVars[key] ?? match))"
      - set: conchEnv
        value:
          expr: "({ DEX_STATE_DIR: stateDir, DEX_CONFIG_PATH: configPath, DEX_BUNDLED_PLUGINS_DIR: path.join(env.repoRoot, 'dist', 'extensions'), [setupSpec.discordEnv]: setupSpec.discordToken })"
      - call: fs.rm
        args:
          - ref: stateDir
          - recursive: true
            force: true
      - call: fs.mkdir
        args:
          - ref: stateDir
          - recursive: true
      - call: runQaCli
        saveAs: overviewOutput
        args:
          - ref: env
          - - conch
            - -m
            - overview
          - timeoutMs: 60000
            env:
              ref: conchEnv
      - assert:
          expr: "String(overviewOutput).includes('Config: missing')"
          message:
            expr: "`fresh Conch overview did not report missing config: ${overviewOutput}`"
      - assert:
          expr: 'String(overviewOutput).includes(''Next: run "setup" to create a starter config'')'
          message:
            expr: "`fresh Conch overview did not recommend setup: ${overviewOutput}`"
      - forEach:
          items:
            ref: setupSpec.commands
          item: commandStep
          actions:
            - call: runQaCli
              saveAs: commandOutput
              args:
                - ref: env
                - expr: "['conch', ...(commandStep.approve ? ['--yes'] : []), '-m', renderCommand(commandStep.message)]"
                - timeoutMs: 60000
                  env:
                    ref: conchEnv
            - assert:
                expr: "String(commandOutput).includes(commandStep.expectOutput)"
                message:
                  expr: "`Conch command ${commandStep.id} did not produce ${commandStep.expectOutput}: ${commandOutput}`"
      - set: writtenConfig
        value:
          expr: "JSON.parse(await fs.readFile(configPath, 'utf8'))"
      - set: agent
        value:
          expr: "writtenConfig.agents?.list?.find((candidate) => candidate.id === setupSpec.agentId)"
      - assert:
          expr: "writtenConfig.agents?.defaults?.workspace === defaultWorkspace"
          message:
            expr: "`default workspace mismatch: ${JSON.stringify(writtenConfig.agents?.defaults)}`"
      - assert:
          expr: "writtenConfig.agents?.defaults?.model?.primary === setupSpec.model"
          message:
            expr: "`default model mismatch: ${JSON.stringify(writtenConfig.agents?.defaults?.model)}`"
      - assert:
          expr: "agent?.workspace === agentWorkspace && agent?.model === setupSpec.model"
          message:
            expr: "`agent config mismatch: ${JSON.stringify(agent)}`"
      - assert:
          expr: "writtenConfig.plugins?.allow?.includes('discord') && writtenConfig.plugins?.entries?.discord?.enabled === true"
          message:
            expr: "`Discord plugin was not enabled: ${JSON.stringify(writtenConfig.plugins)}`"
      - assert:
          expr: "writtenConfig.channels?.discord?.enabled === true"
          message:
            expr: "`Discord was not enabled: ${JSON.stringify(writtenConfig.channels?.discord)}`"
      - assert:
          expr: "writtenConfig.channels?.discord?.token?.source === 'env' && writtenConfig.channels?.discord?.token?.id === setupSpec.discordEnv"
          message:
            expr: "`Discord token was not an env SecretRef: ${JSON.stringify(writtenConfig.channels?.discord?.token)}`"
      - assert:
          expr: "!JSON.stringify(writtenConfig.channels?.discord ?? {}).includes(setupSpec.discordToken)"
          message: Conch persisted the raw Discord token.
      - set: auditText
        value:
          expr: "await fs.readFile(path.join(stateDir, 'audit', 'conch.jsonl'), 'utf8')"
      - forEach:
          items:
            ref: setupSpec.auditOperations
          item: operation
          actions:
            - assert:
                expr: 'auditText.includes(`"operation":"${operation}"`)'
                message:
                  expr: "`missing audit entry for ${operation}: ${auditText}`"
    detailsExpr: "`stateDir=${stateDir}\\nconfigPath=${configPath}\\nagent=${JSON.stringify(agent)}\\nDiscord SecretRef=${JSON.stringify(writtenConfig.channels?.discord?.token)}`"
```
