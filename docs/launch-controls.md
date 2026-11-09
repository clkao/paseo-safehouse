# Safehouse controls in the new-agent form

Status: design draft. The launch controls described here are not implemented.

The new-agent form must show whether the next agent will use Safehouse.
The user can disable Safehouse for that agent before launch. The workspace policy remains intact.

## User experience

The existing provider and model controls remain in Paseo’s new-agent form.
A Safehouse section appears beside the launch controls:

```text
Use Safehouse                         [on]
Workspace policy active
Review access
```

| Workspace state              | Initial selection | Behavior                                                                                         |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| Existing valid policy        | On                | Launch through Safehouse without a separate review step                                          |
| Invalid policy               | On                | Show the error and require a valid policy before sandboxed launch                                |
| No policy                    | Off               | Turning on opens policy setup                                                                    |
| Policy removed               | Off               | New drafts use the ordinary provider; existing sandboxed agents still require a policy to resume |
| Unsupported host or provider | Unavailable       | Explain the limitation; never silently launch outside Safehouse                                  |

When the user selects Off, the section says **Safehouse off for this agent**.
This preserves the provider’s native permission mode. Codex Full Access applies automatically only when Safehouse is on.
The control describes the Safehouse boundary; Off does not imply that the provider has no native sandbox.

Each draft owns its selection. A new draft starts from its workspace policy, not the last draft’s selection.
A workspace change resets the decision. A provider change recalculates availability.
Policy changes refresh the displayed access. Valid policies apply automatically to the next process.
Existing agents retain their launch configuration. Resume preserves that agent’s choice.

## Ownership

Paseo owns the new-agent form, submission, and native process adapters.
The existing Safehouse plugin owns policy review, the Safehouse control, and provider routing.

The current plugin API exposes workspace panels, header buttons, and composer pills for existing agents.
It does not expose controls inside the new-agent form.
Meeting this design requires an extension to Paseo’s plugin API and draft submission path.

## Minimum Paseo extension

1. Add a plugin contribution slot to the existing draft form.
   Give the contribution the host, workspace, provider, draft identity, and its own draft values.
2. Let the contribution display readiness and block submission while its required setup is incomplete.
   Keep its values separate from provider settings and global launch preferences.
3. Carry namespaced plugin values through the create request to the creation hook.
   Persist the selected values with the agent for inspection and resume.
4. Reject a submission that requires an unavailable plugin.
   An enabled sandbox selection must not disappear during submission or plugin reload.

API names and field placement remain design decisions. The extension is generic; Paseo does not interpret `.safehouse` or sandbox policy.
UI validation provides feedback. The server-side hook remains responsible for launch enforcement.

## Safehouse plugin changes

The contribution uses the existing status, preview, save, and setup operations.
It shows review or setup within the launch flow and retains the draft prompt, provider, and model.

The creation hook handles three inputs:

| Choice      | Server behavior                                                      |
| ----------- | -------------------------------------------------------------------- |
| On          | Verify the provider and current policy, then route through Safehouse |
| Off         | Use the ordinary provider and record the explicit per-agent decision |
| Unspecified | Apply workspace detection, preserving existing CLI and API behavior  |

The hook checks current policy at submission, even if the form previously showed a valid policy.
Explicit Safehouse provider variants remain sandboxed. The ordinary provider picker is the supported path for the per-agent toggle.
The opening hook prepares the protected snapshot for sandboxed agents.

An Off choice is a human launch decision, not a permission available to future sandboxed orchestration clients.
A future broker must reject requests that weaken its own sandbox authority.

## Acceptance

1. A workspace with a valid policy shows Safehouse On before an agent exists.
2. On produces a real sandboxed tool call; Off preserves the ordinary provider and its mode.
3. Two simultaneous drafts retain independent choices. Off does not change the workspace policy or another draft.
4. An invalid policy or unavailable plugin blocks an On submission.
5. Policy setup and review preserve the draft and return to the same launch form.
6. Resume retains the selected launch boundary. Existing agents remain unchanged.
7. Desktop and compact layouts show the effective state beside the launch controls.

## Alternatives considered

A plugin-owned launch panel can use existing APIs, but it duplicates Paseo’s provider controls and creates a separate launch flow.
The native form extension keeps the sandbox decision beside the controls the user already uses.

## Source basis

The inspection used Paseo 0.15.2, revision `e896c05b0`.

- [Client contribution API](../../paseo-safehouse-core/packages/plugin/src/client/contracts.ts): current UI extension points.
- [Draft submission](../../paseo-safehouse-core/packages/app/src/composer/draft/create-agent-request.ts): native create request path.
- [Current routing](../server/service.ts): workspace policy loading and provider selection.
