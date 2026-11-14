# Safehouse for Paseo

Safehouse limits what an agent can access on your Mac.
This plugin runs Paseo agents through [Agent Safehouse](https://github.com/eugene1g/agent-safehouse), which uses the native macOS sandbox, `sandbox-exec`.
The limits apply to the agent process and its child processes.
The sandbox reduces the damage that a mistaken command can cause outside the workspace.
For example, an agent can edit project files while the sandbox denies access to files outside the permitted locations.
The policy defines the exact limits. Network access is part of the default policy.

The Mac that runs the Paseo daemon must have Paseo and Agent Safehouse installed.
If Safehouse is missing, the plugin shows installation guidance for that Mac.

## Start an agent

1. Open the **Safehouse** panel.
2. Select **Refresh providers**.
3. Select your workspace, provider, and model in the normal Paseo picker.
4. On Paseo 0.16, select **On** or **Off** beside the lock in the composer.
5. Start an agent.

Each new draft starts with Safehouse On, including the first agent in a workspace.
Off starts that agent without Safehouse.
An Off choice stays Off if submission fails. The next new draft starts On.
The default policy permits writes in the workspace.
It includes built-in system, toolchain, temporary-directory, network, and harness access.
Extra directory grants and optional capabilities start empty.
The plugin protects policy files and its enforcement state.

New Claude and Codex agents run normal commands without harness approval prompts inside Safehouse.
Claude uses `bypassPermissions`. Codex uses Full Access with approvals disabled.
Pi has no selectable permission mode. Its built-in tools already run without this approval flow.
Safehouse still enforces the process limits. Extensions and custom hooks can ask questions or apply their own controls.

On Paseo 0.15, the workspace header controls Safehouse for future agents.
Callers without a composer choice use the saved workspace default.
The Safehouse panel contains that default on both versions.
Explicit Safehouse providers always use the sandbox.
Existing agents keep their provider and stored permission settings.

## View an agent's access

On Paseo 0.16, a Safehouse session has a lock in its composer.
The lock opens the Safehouse panel for that session's workspace.
Its status describes the policy prepared for the session.
It also identifies a changed policy or a missing launch record.
Hover over the lock or use keyboard focus to see the status and panel action.

On narrow screens, Paseo places plugin controls in the model menu.
The status pill remains visible while the inline control is unavailable.
Older Paseo versions also use the status pill.

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
