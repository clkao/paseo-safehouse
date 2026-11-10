# Paseo Safehouse

Run [Paseo](https://github.com/getpaseo/paseo) agents inside [Agent Safehouse](https://github.com/eugene1g/agent-safehouse) on macOS.
Use a workspace’s `.safehouse` policy to control file access while keeping Paseo’s normal model picker and conversations.

Beta candidate. Tested with Paseo 0.15.3 and Safehouse 0.12.0, using Pi, Claude, and Codex.

## Install

Install Paseo and Agent Safehouse on the daemon host, then install this plugin:

```sh
paseo plugin install https://github.com/clkao/paseo-safehouse
```

Open the **Safehouse** panel and select **Refresh providers**.
This beta targets clean installations. Older Safehouse plugins can have conflicting provider IDs.

## Use

1. Open a workspace with `.safehouse`, or create a policy in the **Safehouse** panel.
2. Use the workspace header to turn automatic Safehouse routing on or off for new agents.
3. Select your usual provider and model, then start an agent.
4. To change access, select **Review access**, edit the policy, and select **Save policy**.
5. Reload an existing Safehouse agent to apply the saved policy.

The agent pill shows its Safehouse status. Reload preserves the conversation and provider.
The workspace toggle does not change existing agents. Explicit Safehouse providers always remain sandboxed.

Safehouse restricts the agent process and its children. The Paseo daemon and additional MCP services retain their own authority.
Extensions that load files outside readable locations need explicit policy grants.
Each launch or reload reads the policy again; protection across separate sessions is outside this beta’s scope.
See the [design](docs/design.md) for boundary details and limitations.

## Development

Use a separate Paseo daemon for tests.

```sh
npm ci
npm run typecheck
npm test
```

The macOS tests require an installed Safehouse binary.
See [implementation status](docs/implementation.md) and the [development workflow](docs/dev/README.md) for evidence and remaining acceptance checks.

## License

[MIT](LICENSE)
