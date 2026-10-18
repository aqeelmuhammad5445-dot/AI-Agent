# Orbit Agent

Orbit Agent is a browser-based prototype for a scoped workspace support assistant. It demonstrates a control-room dashboard and transparent agent workflow: request planning, tool selection, results, limitations, and approval previews for consequential actions.

> **Prototype status:** This repository does not connect to a live AI model, account service, knowledge base, workspace, or ticketing system. The assistant uses deterministic planning logic and clearly labeled demo fixtures. It is intended for demonstration and development, not production use.

## Features

- **Agent Chat and Playground** for workspace setup guidance, account-status examples, and support questions.
- **Visible execution flow** showing how requests are planned, which demo tools are selected, and what they return.
- **Runs, Overview, Tools, and Settings** screens for exploring the prototype dashboard and its behavior.
- **Scope and safety behavior** that distinguishes demo information from verified live data, reports unavailable integrations, and previews consequential actions without executing them.
- **Browser-local state** for conversations, history, settings, and feedback using `localStorage`.
- **Responsive dark interface** with interactive dashboard visuals.

## Run locally

No package installation or build step is required. Serve the `prototype` directory with Python 3:

```powershell
cd prototype
python -m http.server 8000 --bind 127.0.0.1
```

Then open [http://localhost:8000](http://localhost:8000) in your browser. Stop the server with `Ctrl+C`.

If Python is unavailable, serve the `prototype` directory with any static HTTP server. Opening `index.html` directly may work, but using HTTP is recommended.

## Try it out

1. Open **Agent Chat** or **Playground**.
2. Ask for workspace setup guidance or a sample account status.
3. Review the execution trace and the demo-source limitations in the response.
4. Explore **Runs**, **Tools**, and **Settings** to see the related prototype screens.

The **Create ticket** action is only an approval-flow preview. It does not create a ticket.

## Demo integrations and limitations

| Capability | Current behavior |
|---|---|
| Knowledge lookup | Returns illustrative help guidance from a local demo fixture. |
| Account status | Returns illustrative sync-status data from a local demo fixture. |
| Workspace verification | Unavailable without a trusted backend and authorization provider. |
| Permission verification | No live permission source is connected. |
| Sync diagnostics | No live diagnostics service is connected; troubleshooting can show generic guidance and unavailable checks. |
| Ticket creation | Preview only; no ticket service or side effect is connected. |
| Language model | Not connected. The current planner and responses are deterministic. |

Do not treat the demo results as real account, workspace, permission, or service health checks. Do not put secrets or sensitive production data into the prototype. Browser-local data is stored in the current browser profile and is not synchronized to a backend.

## Project structure

```text
.
├── database/
│   └── schema.sql             # Proposed persistence schema for a connected system
├── prototype/
│   ├── agent-core.js          # Deterministic request planner and tool/result helpers
│   ├── app.js                 # Browser UI and demo adapters
│   ├── index.html             # Standalone application shell and styles
│   ├── system-prompt.md       # Draft instructions for a future model integration
│   └── test/
│       └── agent-core.test.js # Node.js tests for planner behavior
├── HLD_LLD.md                 # High- and low-level design notes
└── README.md
```

## Run the planner tests

The prototype has no npm manifest or third-party runtime dependencies. To run the built-in tests, install Node.js and run:

```powershell
node --test prototype/test/agent-core.test.js
```

## Architecture notes

The browser app is a static front end. `prototype/agent-core.js` contains the deterministic planner and validated result helpers; `prototype/app.js` wires the UI to demo adapters. The draft design in `HLD_LLD.md` describes a possible connected API, persistence layer, model orchestration, authorization, and approval flow. Those backend components are not implemented or configured in this repository.

To make this a real AI agent, a future implementation needs a trusted backend, a selected model provider, authenticated sessions, authorized tool adapters, server-side validation, and appropriate persistence and privacy controls. Keep provider credentials on the server; never put API keys in browser code.

## License

No license has been selected yet. Add a `LICENSE` file before granting others permission to reuse or distribute this project.
