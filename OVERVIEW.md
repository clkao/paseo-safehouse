# Safehouse for Paseo

Safehouse limits what an agent can access on your Mac.
This plugin runs Paseo agents through [Agent Safehouse](https://github.com/eugene1g/agent-safehouse), which uses the native macOS sandbox, `sandbox-exec`.
The limits apply to the agent process and its child processes.
The Mac that runs the Paseo daemon must have Paseo and Agent Safehouse installed.

## Start an agent

1. Open the **Safehouse** panel.
2. Select **Refresh providers**.
3. Select your workspace, provider, and model in the normal Paseo picker.
4. Start an agent.

Safehouse is On by default, including the first launch in a workspace.
The default policy permits writes in the workspace.
It includes built-in system, toolchain, temporary-directory, network, and harness access.
Extra directory grants and optional capabilities start empty.
The plugin protects policy files and its enforcement state.

New Claude and Codex agents run normal commands without harness approval prompts inside Safehouse.
Claude uses `bypassPermissions`. Codex uses Full Access with approvals disabled.
Pi has no selectable permission mode. Its built-in tools already run without this approval flow.
Safehouse still enforces the process limits. Extensions and custom hooks can ask questions or apply their own controls.

The workspace header controls Safehouse for future agents.
A saved Off choice permits ordinary launches. Explicit Safehouse providers always use the sandbox.
Existing agents keep their provider and stored permission settings.

## Change access

An optional `.safehouse` file adds access for a workspace.
Without this file, the default policy applies.

1. Open the **Safehouse** panel.
2. Edit the policy or add access in the fields.
3. Select **Review access**.
4. Select **Save policy**.
5. Reload the selected Safehouse agent.

Reload applies the saved policy and preserves the conversation and provider.
Running agents keep their prepared access until replacement.
Invalid policies block a launch. The plugin does not retry outside Safehouse.

## External tools and daemon access

External MCP services have their own permissions.
An agent can ask these services to act outside its process sandbox.
Each service therefore needs its own access review.

**Allow Paseo daemon access** defaults to Off.
Off blocks direct access to the captured local daemon endpoints and daemon homes.
On gives CLI/API access to the whole daemon after launch or reload.
That authority includes other workspaces, other agents, and operations outside this sandbox.
It is not limited to the current workspace.

If you intend to grant that authority, select **Allow Paseo daemon access**.
Then select **Save daemon access**.
Reload the selected Safehouse agent.
Native Paseo tools remain disabled. External services and proxy routes retain their separate authority.
