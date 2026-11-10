# Paseo Safehouse

[Agent Safehouse](https://github.com/eugene1g/agent-safehouse) limits agent access to files through the native macOS sandbox, `sandbox-exec`.
This plugin applies those limits to [Paseo](https://github.com/getpaseo/paseo) agents through a workspace’s `.safehouse` policy.
You keep the normal model picker and conversations.

## Install

Install Paseo and Agent Safehouse on the Mac that runs the Paseo daemon.
Then install this plugin:

```sh
paseo plugin install https://github.com/clkao/paseo-safehouse
```

Open the **Safehouse** panel.
Select **Refresh providers**.

## Use

1. Open a workspace with a `.safehouse` policy. If no policy exists, create one in the **Safehouse** panel.
2. Use the workspace header to enable or disable Safehouse for new agents.
3. Select your usual provider and model.
4. Start an agent.

To change access:

1. Open the **Safehouse** panel.
2. Select **Review access**.
3. Edit the policy.
4. Select **Save policy**.
5. Reload an existing Safehouse agent to apply the saved policy.

The agent pill shows its Safehouse status. Reload preserves the conversation and provider.
The workspace toggle does not change existing agents. Explicit Safehouse providers always use the sandbox.

## Access limits

Safehouse restricts the agent process and its child processes.
The Paseo daemon and additional MCP services retain their own access permissions.
Extensions need explicit policy grants to read dependencies outside the permitted locations.

Each session uses a fixed access policy. Each new launch or reload resolves the policy paths again.
The [design](docs/design.md) explains the sandbox boundaries and limitations.

## Paseo daemon access is an escape route

With standalone Agent Safehouse, `--add-dirs="$HOME/.paseo"` grants read and write access to the default Paseo daemon home.
For example:

```sh
safehouse --add-dirs="$HOME/.paseo" -- paseo agent ls --home "$HOME/.paseo"
```

For a separate daemon, replace both paths with its daemon home.
The directory contains daemon configuration and local connection credentials.
Daemon access is a sandbox escape route: an agent can ask Paseo to run commands or create agents outside its sandbox.
Only grant this access to an agent that you trust with that authority.

This standalone command does not override the Paseo Safehouse plugin's fixed restrictions.
Plugin-managed agents cannot access the protected daemon home or connect to its configured port, even with an `add-dirs` grant.
The plugin currently has no daemon-access opt-in.

## Development

Use a separate Paseo daemon for tests.

```sh
npm ci
npm run typecheck
npm test
```

The macOS tests require an installed Safehouse binary.
The [validation guide](docs/validation.md) describes the acceptance checks.
The [development workflow](docs/dev/README.md) defines the review process.

## License

[MIT](LICENSE)
