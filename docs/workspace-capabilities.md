# Workspace capabilities for sandboxed agents

Status: design draft. The broker described here is not implemented.

Sandboxed agents need a controlled way to open workspace tools through Paseo.
The first use case is a Subspace review in a terminal pane within the caller’s workspace.
The agent must not gain general daemon access or access to an unrestricted shell.

## Terminal boundary

A terminal pane displays output and sends input to a process. Paseo normally starts an unrestricted shell for that process.
Workspace ownership determines where the pane appears. It does not restrict the process.

The proposed terminal starts its command through Safehouse:

```text
Paseo terminal manager
  → trusted environment setup
    → Safehouse with the caller’s captured policy snapshot
      → shell or Subspace review command
```

All caller-supplied code starts after Safehouse applies the sandbox.
The pane ends when its process exits. It has no unrestricted shell to return to.
Paseo and the terminal manager remain trusted host processes outside the sandbox.

## Broker ownership

The existing Safehouse plugin hosts a small authenticated service in its server process.
This service is the broker. It checks requests and calls Paseo through the plugin’s existing SDK client.
The agent can reach the broker endpoint while the configured daemon endpoints remain blocked.

Each session credential binds to an agent, workspace, canonical directory, launch policy digest, and permitted operations.
The broker derives authority from that record. A caller-supplied workspace or agent ID cannot change it.
The broker never exposes its Paseo credentials or a general RPC forwarding operation.

## Minimum useful implementation

The first release supports three operations:

| Operation      | Request                                   | Result                                           |
| -------------- | ----------------------------------------- | ------------------------------------------------ |
| Readiness      | Session credential                        | Whether sandboxed terminal creation is permitted |
| Open terminal  | Title, command argument array, request ID | A handle owned by this session                   |
| Close terminal | Owned handle                              | Idempotent cleanup                               |

The broker chooses the workspace, process directory, environment, Safehouse executable, and policy snapshot.
Open requests cannot supply those values. Close requests cannot target arbitrary Paseo terminal IDs.
Retries use the same request ID so a lost response does not create duplicate panes.
Request size and concurrent terminal creation are bounded.

The command array executes inside a fixed sandboxed shell, with each argument passed as data.
The broker does not execute or source a caller’s script on the host.
The first version does not require terminal listing, output capture, or agent-controlled keystrokes.
The user interacts with the TUI through Paseo’s normal terminal pane.

### Authorization

The Safehouse panel offers **Allow sandboxed terminals in this workspace**, initially off.
Capability approval is separate from automatic `.safehouse` trust. It binds broker operations to a launch policy digest in protected plugin state.
Safehouse’s `.safehouse` syntax remains unchanged.

New or reloaded agents receive a session credential after approval.
Every create request checks the capability grant and the caller’s captured policy digest.
A broader workspace policy does not expand an old session’s broker authority; that session requires reload.

Disabling the capability, closing the agent, or reloading the plugin revokes its credentials.
Already running terminals retain their existing OS policy. Human cleanup remains available through Paseo.
After a broker restart, old credentials and handles fail; the broker does not adopt unrelated terminals.

### Transport and environment

Use one loopback HTTP listener in the plugin process with a random port and per-session bearer credentials.
Accept only the defined JSON operations. Reject unauthenticated requests, unexpected fields, and browser-origin requests.
Keep tokens out of command arguments, logs, workspace files, and terminal titles.

The opening hook injects broker credentials and the small client’s location into the harness environment.
Safehouse must explicitly pass only those broker variables through its environment filter.
Existing filtering of daemon credentials and policy overrides remains active.

Paseo’s terminal API accepts a command and arguments but no per-request environment.
The broker therefore uses a trusted `/usr/bin/env -i` prefix with a minimal environment before Safehouse starts.
That prefix contains no session secrets. No caller code runs during environment setup or policy construction.
The terminal does not receive the parent’s broker credential.

## Subspace integration

The current `review-paseo` helper creates a default terminal, then sends its review command as keystrokes.
Its review lifecycle already prepares an executable script, waits for completion, and validates the result.

Add a broker-aware dispatch path to that helper:

1. Detect the broker environment and verify readiness.
2. Send the prepared script as the terminal’s command argument array.
3. Retain Subspace’s existing completion and result handling.
4. Close the owned terminal through the broker.

Broker failure stops this dispatch path. It must not retry through an unrestricted terminal or print a host-execution fallback.
The broker client requires only the three operations above. It does not emulate the full Paseo CLI.

## Browser panes

Paseo exposes browser navigation through its desktop client plugin API.
The browser runs on the client machine, which can differ from the daemon host.
Workspace placement does not isolate cookies, authenticated accounts, network access, or browser automation.

The smallest browser addition is a pending preview request in the Safehouse panel.
The panel shows the destination URL, and the user selects **Open in browser**.
The client uses Paseo’s `navigation.openBrowser` with the request’s bound workspace.
This is a human-authorized browser action, not a browser inside the agent’s Safehouse sandbox.

Automatic browser opening and browser control require a separate capability design for profiles, origins, redirects, and accessible tabs.
Worker orchestration likewise requires child-policy enforcement and ownership checks before it can use this broker.

## Feasibility gates and implementation order

1. Prove terminal execution first on the isolated daemon.
   Create a PTY through the SDK with the trusted environment prefix and Safehouse command.
   Verify workspace access, denied daemon access, policy protection, environment filtering, and process exit behavior.
2. Run a Subspace review script in that PTY.
   Verify scratch files, completion signaling, terminal input, result validation, and cleanup.
3. Add broker authentication, workspace approval, owned handles, and the client.
   Reject forged IDs, other sessions’ handles, stale policies, revoked credentials, and arbitrary daemon operations.
4. Connect the Subspace dispatch path and exercise the complete review journey.

Terminal command-specific Safehouse defaults must not grant access beyond the caller’s launch policy.
That comparison and the live PTY probes are release gates, not assumptions based on workspace identity.
Current port guards cover configured daemon endpoints; alternate proxies or relay paths require separate authorization review.

The proposed minimum uses existing Paseo terminal and plugin APIs.
Implementation still needs the live feasibility gates before this can be claimed as a supported capability.

## Source basis

The inspection used Paseo 0.15.2 (`e896c05b0`), SDK 0.14.0, Safehouse 0.12.0, and Subspace revision `0ed78398`.

- [Terminal SDK](../../paseo-safehouse-core/packages/client/src/terminals/index.ts): explicit command and arguments.
- [PTY launch](../../paseo-safehouse-core/packages/server/src/terminal/terminal.ts): direct process creation on macOS.
- [Subspace dispatch](../../spacedock-subspace/plugins/subspace/skills/r/scripts/review-paseo): existing create, send-keys, and cleanup sequence.
- [Browser navigation](../../paseo-safehouse-core/packages/app/src/plugins/host-navigation-model.ts): desktop-owned browser creation.
