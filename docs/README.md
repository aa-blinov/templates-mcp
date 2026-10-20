# Documentation

The documents in this folder are the ones a fork of this template has to
read. Pick the door for your role, or read them in the order below.

| Document | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | The layers of the server, the path a request takes through them, the decisions that cost something and the places a change goes wrong. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The orientation the project wrote for itself: the layers, the reasons for the picks and the hot spots, with the dates it was last reviewed. |
| [ADDING-TOOLS.md](ADDING-TOOLS.md) | How to add a tool: where the file goes, the two registrations that have to be kept in step, and a tool walked through end to end. |
| [AGENT.md](AGENT.md) | A pointer to the skill set, for an assistant that is about to work on this repository. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | The production deploy: the image, the compose stack, the secrets, the rollback. |
| [RUNBOOK.md](RUNBOOK.md) | Incident response. What to check, in what order, and what to do about it. |
| [REVERSE-PROXY.md](REVERSE-PROXY.md) | The TLS terminator to use, and the three other ways to do it. |
| [SECURITY.md](SECURITY.md) | The threat model, the disclosure process and the rotation procedure. |
| [SECURITY-AUDIT.md](SECURITY-AUDIT.md) | The audits already done, one per dependency that touches a credential. |
| [OAUTH-DESIGN.md](OAUTH-DESIGN.md) | The normative design of the per-user OAuth: the threat model, the token store contract and the event taxonomy. |
| [FEEDBACK.md](FEEDBACK.md) | The feedback channel, the `bx24mcp_submit_feedback` tool and the GitHub side of it. |
| [EVALS.md](EVALS.md) | The automated tool-selection evals: what they cover and how to add a case. |
| [MANUAL-TEST-PHRASES.md](MANUAL-TEST-PHRASES.md) | The natural-language phrases to paste into an assistant by hand, and what to watch for. |
| [screenshots/README.md](screenshots/README.md) | Why the folder holds no picture of the interface. |
| [../README.md](../README.md) | The front door: the three shapes, the 31 tools and the configuration. |
| [../PROJECT-BRIEF.md](../PROJECT-BRIEF.md) | The specification the implementation is held to. |

## Reading order

New here: [../README.md](../README.md), then
[architecture.md](architecture.md). The README gives you the three shapes
and the tools, the architecture gives you the layers behind them.

About to add a tool: [ADDING-TOOLS.md](ADDING-TOOLS.md), then
[architecture.md](architecture.md). The walkthrough has the procedure and
the architecture has the layers it drops into.

Running the service: [DEPLOYMENT.md](DEPLOYMENT.md) for the setup and
[RUNBOOK.md](RUNBOOK.md) for the middle of the night.
