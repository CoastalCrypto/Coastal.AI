<p align="center">
  <img src="assets/banner.png" alt="Coastal.AI" width="100%"/>
</p>

<p align="center">
  <strong>A private, self-hosted AI Agent OS — intelligent agents, scheduled tasks, custom tools, and a full web UI. Your data never leaves your hardware.</strong>
</p>

<p align="center">
  <a href="#-choose-your-path">Choose Your Path</a> ·
  <a href="#-desktop-app">Desktop App</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-first-boot-walkthrough">Walkthrough</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-coastalos--standalone-os">CoastalOS</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#%EF%B8%8F-configuration">Configuration</a> ·
  <a href="#-api-reference">API</a>
</p>

---

## Two products, one engine

This repo builds **two products** over one shared engine — see [`PRODUCTS.md`](PRODUCTS.md).

| | Desktop App | Coastal.AI OS |
|---|---|---|
| Path | `apps/desktop/` | `os/` (`kiosk/` ISO + `node/` BC-250 image) |
| Engine | embedded as a local sidecar | installed via the apt lane |
| Release | tag `desktop-v*` | tag `os-v*` |

The **engine** is the `packages/` pnpm/turbo workspace (`core`, `web`, `daemon`, `architect`, the A2A multi-agent layer, optional verticals). Both products are surfaces over it.

---

## What is Coastal.AI?

Coastal.AI is an open-source **AI Agent Operating System** that runs entirely on your own hardware. No cloud subscription, no API keys, no data leaving your machine.

It gives you a private command center for AI: chat with intelligent agents that know your organisation, schedule them to run automatically, build custom tools they can call, and push results to Telegram, Discord, or Slack — all through a clean web interface.

**Who is this for?**
- Anyone who wants a private, local alternative to cloud AI services
- Teams that want shared AI agents with role-based access control
- Developers who want to build and automate with AI tools
- Power users who want AI running on their own hardware 24/7

---

## 🗺 Choose Your Path

Coastal.AI runs several ways. Pick the one that fits your situation:

---

### Path 1 — Desktop app *(recommended for most people)*

Download a native installer, double-click, done. Everything is bundled — **no Node, no Python, no terminal, no setup scripts.** Runs on Windows, macOS (Intel + Apple Silicon), and Linux.

**Best for:** anyone who just wants to run the app

→ **[Jump to Desktop App](#-desktop-app)**

---

### Path 2 — Install from source on your existing computer

Runs the backend + web UI from the repo via the install script, accessed in your browser. Gives you the full development environment and source.

**Best for:** development, customization, contributing

→ **[Jump to Quick Start](#-quick-start)**

---

### Path 3 — Install as a system service on a Linux server

Installs as a `systemd` service that starts automatically on boot. Ideal for a dedicated machine, home server, or VPS.

**Best for:** always-on setups, team deployments, production use

→ **[Jump to Server Install](#ubuntu--debian--apt-install)**

---

### Path 4 — Boot from USB as a standalone OS (CoastalOS)

Flash a bootable USB drive. Plug it into any UEFI machine and boot — no installation, nothing written to the host disk. CoastalOS is a minimal Linux environment built entirely around Coastal.AI.

**Best for:** dedicated AI appliances, air-gapped setups, taking your AI anywhere

→ **[Jump to CoastalOS](#-coastalos--standalone-os)**

---

## 🖥 Desktop App

The standalone desktop edition — a native window running the full Coastal.AI stack, with the backend **bundled inside the app**. Nothing else to install or configure.

### Install

1. Open the [**Releases**](https://github.com/CoastalCrypto/Coastal.AI/releases) page.
2. Download the installer for your OS:

   | OS | File |
   |----|------|
   | **Windows** | `CoastalAI_<version>_x64-setup.exe` |
   | **macOS (Apple Silicon)** | `CoastalAI_<version>_aarch64.dmg` |
   | **macOS (Intel)** | `CoastalAI_<version>_x64.dmg` |
   | **Linux** | `CoastalAI_<version>_amd64.AppImage` or `.deb` |

3. Run it. On first launch the app starts its **own backend on a private local port** — no ports to pick, no services to start.

> **Unsigned for now:** your OS may warn on first run (Windows SmartScreen → *More info → Run anyway*; macOS → right-click → *Open*). Code-signing is on the roadmap.

### Requirements

- For **local** model inference, install [**Ollama**](https://ollama.com) — the in-app setup wizard checks for it and helps you pull a model. Prefer the cloud? Claude / Gemini / OpenAI work with an API key instead.

### Build it yourself

Cross-platform installers are produced by CI on a `desktop-v*` tag (`.github/workflows/desktop-release.yml`). To build locally:

```bash
pnpm install
pnpm --filter @coastal-ai/core build
pnpm --filter @coastal-ai/core bundle:sidecar   # bundles the Node backend + native deps
pnpm --filter @coastal-ai/desktop build         # → src-tauri/target/release/bundle/
```

For the architecture and the dev workflow (`pnpm --filter @coastal-ai/desktop dev`), see **[`packages/desktop/README.md`](packages/desktop/README.md)**.

---

## ✨ Features

| Feature | What it does |
|---------|-------------|
| **Chat** | Talk to AI agents that know your organisation, remember past conversations, and can use tools |
| **Persistent Sessions** | Chat history survives page navigation — your conversation stays intact as you move around the UI |
| **Agent Voice** | Each agent speaks responses aloud — choose from browser voices or the built-in VibeVoice engine |
| **Hardware-Aware Tiers** | On boot, Coastal.AI probes your VRAM and RAM to automatically assign a performance tier (Lite, Standard, or Apex) and optimize model selection |
| **Ollama Auto-Scan** | On startup, Coastal.AI scans your local Ollama install, imports every model it finds, and auto-assigns them to routing domains — no manual configuration needed |
| **Model Routing** | Messages are automatically routed to the right model (high / medium / low priority) based on domain (COO, CFO, CTO, general) — hot-reloads if you change the registry |
| **Ollama Pull** | Pull any model from the Ollama library directly from the Models page with live progress |
| **HuggingFace Install** | Download and quantize HuggingFace models (Q4, Q5, Q8) directly from the web UI |
| **Skills Library** | Save reusable prompt templates with fill-in variables, triggered with `/command` shortcuts in chat |
| **Skill Packs** | Bundle, export, and import curated sets of skills and agents via the Skill Pack API — the foundation of the local AI marketplace |
| **Scheduled Agents** | Set agents to run automatically on a cron schedule — daily briefings, alerts, reports |
| **Multi-Agent Swarm** | Send complex tasks to a team of specialist agents (COO, CFO, CTO) that work in parallel |
| **Pipeline Builder** | Chain agents in sequence — each agent's output becomes the next agent's input. Save pipelines to a library and reload them instantly |
| **Live Pipeline Execution** | Watch pipelines run in real time — stage threads stream every tool call live, with a progress timeline and status badges |
| **Live Steering** | Type a message into the steer bar during any pipeline run and it's injected into the active agent on its next reasoning step |
| **Pipeline Loop-Back** | Configure loop-back arrows on any stage — the runner re-executes a stage until a condition is met, up to a configurable iteration cap |
| **Pipeline Run History** | Browse past pipeline runs from the 🕐 Runs panel, replay their live execution view, and see status badge, duration, and timestamp at a glance |
| **Chat Voice Playback** | Each chat pane has a per-pane 🔊/🔇 toggle — replies are read aloud via the browser speech engine (muted by default; prevents multi-pane collision) |
| **Chat Retry** | Hover the last assistant reply and click ↺ retry to re-send the previous prompt without retyping |
| **Live Dashboard** | Real-time event feed with expandable detail panels — click any tool call, stage, or pipeline event to see the full JSON payload inline |
| **Analytics** | Tool call stats, success rates, cost tracking, 7-day trends |
| **Custom Tools** | Write JavaScript tools in the browser — agents call them automatically |
| **Output Channels** | Push agent messages to Telegram, Discord, Slack, or Zapier |
| **Dynamic MCP Host** | Connect Coastal.AI to any Model Context Protocol (MCP) server — instantly give agents access to Google Drive, Postgres, Slack, and more |
| **High-Performance Data** | Ultra-fast local analysis of million-row CSV/JSON datasets via the CFO agent, powered by the Rust-based Polars engine |
| **Multi-User Auth** | Username + password login with three roles: admin, operator, viewer |
| **Self-Build Loop** | The system can read its own code, propose improvements, and open pull requests |
| **Architect Preferences** *(v1.6)* | Seven preference knobs (plan verbosity, auto-approve threshold, test strictness, gate policy, tone, iteration patience, risk posture) control how the architect behaves per cycle |
| **Knowledge Graph** *(v1.7)* | Notes substrate with wikilinks + auto-detected entity mentions, rendered on the Agent Graph page in Obsidian-style violet with clickable backlinks |
| **Impact Radius** *(v1.7)* | Code-graph scanner emits "who imports this file" into the planner prompt for every change — the architect sees its blast surface before it acts |
| **Design Context** *(v1.7)* | `DESIGN.md` files per package are ingested as atomic section notes; relevant design tokens auto-inject into the planner prompt when UI files are touched |
| **Eval Gate** *(v1.7)* | Versioned planner prompts with structural fixtures (must emit `<plan>` + `<diff>`, target hint must appear, etc.); the building stage soft-fails on regressions |
| **DOM Snapshot Gate** *(v1.7)* | HTTP browser snapshotter persists kind=`dom` notes; gate compares fresh vs. last-OK baseline (status / shrink / new console errors). Opt-in via `CC_ARCHITECT_DOM_URLS` |
| **Hardware Scan** | `GET /api/admin/hardware-scan` returns GPU/RAM/disk + minimum/recommended/optimal model trio; rendered as a Hardware card on the System page |
| **Trading Architect** *(optional)* | Peer package adds market-data providers + RSI/Kronos signal generators that persist as `kind='trade'` notes. Delete the package to remove all financial surface — kernel stays vertical-neutral |
| **Privacy First** | Entirely local inference — no external API keys or cloud accounts required |

---

## 🏗 Architect — Self-Healing System (v1.7.0-dev)

The Architect is Coastal.AI's autonomous improvement daemon. It takes work items, writes plans using your local models, runs them against lint/typecheck/build/test gates, opens PRs, and shows its work. Since v1.6 the architect's behavior is tuned through a 7-knob preference profile; since v1.7 it operates over a unified knowledge graph (code-graph, design context, eval history, DOM snapshots) so every plan sees its impact radius.

### Quick Start

```bash
# Via CLI
coastal-ai architect on                    # start daemon
coastal-ai architect mode hands-off        # set mode
coastal-ai architect ask "Add retry logic" # create work item
coastal-ai architect status                # check status

# Via Web UI
# Navigate to the Architect page in the dashboard
```

### Modes (presets over the user-profile preference knobs)

| Mode | Gate policy | Auto-approve | Test strictness | Use case |
|------|-------------|--------------|-----------------|----------|
| **Hands-on** | every stage | never | must-pass | Review every change before it lands |
| **Hands-off** | plan only | low-risk only | must-pass | Approve plans, auto-handle the rest |
| **Autopilot** | merge only | aggressive | warn (don't block) | Trust the gates, intervene on failure |
| **Custom** | (you choose) | (you choose) | (you choose) | Any combination of the 7 knobs |

Selecting a mode writes its preset values into `user_profile`. Tweak any individual knob in the **Preferences** panel under Settings → Architect and the mode badge flips to **CUSTOM** automatically.

### Preference Knobs (v1.6+)

| Knob | Options |
|------|---------|
| **planVerbosity** | brief / standard / detailed |
| **autoApproveThreshold** | never / low-risk-only / aggressive |
| **testStrictness** | must-pass / warn / advisory |
| **gatePolicy** | every-stage / plan-only / merge-only |
| **tone** | terse / standard / explanatory |
| **iterationPatience** | stop-at-2 / stop-at-5 / stop-at-budget |
| **riskPosture** | conservative / balanced / experimental |

### Unified Knowledge Graph (v1.7)

Every cycle the architect now reads + writes a shared note graph stored in `obsidian.db`. Notes are typed (`code` / `design` / `eval` / `dom` / `visual_diff` / `learning` / `user` / `cycle`) and connected via wikilinks + auto-detected entity mentions. The graph renders on the **Agent Graph** page in violet — toggle **KNOWLEDGE** to fade the agent layer and browse the knowledge layer Obsidian-style with clickable backlinks.

Ingesters that feed the graph on each daemon startup:
- **Code-graph** — scans `packages/*/src` for imports + exports; every file becomes a note, every import becomes an edge. The planner pulls the *impact radius* (who imports the targeted file) into every prompt.
- **Design-context** — parses every `packages/<name>/DESIGN.md` into atomic H2 sections. When a work item touches a UI package, the relevant design tokens get pasted into the planner prompt automatically.
- **Eval gate** — runs structural assertions against the planner prompt's output; failures soft-fail the build with `failureKind='eval'`.
- **DOM snapshot + visual diff** — substrate ready, gate opt-in via `CC_ARCHITECT_DOM_URLS`.

### How It Works

1. **Work items** enter the queue via UI, CLI, `.architect/queue.md`, or `.architect/skills/*.md`
2. **Planning** — LLM generates a plan + unified diff
3. **Building** — applies diff, runs lint/typecheck/build/test (scoped to touched packages)
4. **PR creation** — commits, pushes, opens a PR via `gh`
5. **Polling** — daemon monitors PR status, transitions on merge/close

Failed stages retry with exponential cooldown until the budget is exhausted. Hard failures (model down, GitHub auth expired) pause the work item for manual intervention.

### Curriculum Mode

When the queue is empty, the Architect can propose its own improvements by scanning for stale TODOs, churn hotspots, and lint warnings. Proposals are always low-priority and require full human approval.

### Time-Travel Snapshots

Before every build, the Architect captures a workspace snapshot in a shadow git repo. If something goes wrong, you can restore any prior state to a recovery branch.

---

## 🔒 Privacy & Data

Coastal.AI is built around a single principle: **your data never leaves your hardware.**

| Component | Where it runs | Data sent externally? |
|-----------|--------------|----------------------|
| Language models | Ollama / vLLM / AirLLM — on your machine | ❌ Never |
| Conversation memory | SQLite in `./data/` — on your machine | ❌ Never |
| Vector search | Infinity DB — on your machine (optional) | ❌ Never |
| Agent tools | Executed locally in a sandboxed workspace | ❌ Never |
| Mem0 semantic memory | **Cloud service (opt-in only)** | ⚠️ Only if you enable it |

### Cloud Features (Opt-In Only)

Some optional features send data to external services. **None are enabled by default.** Each requires your explicit consent before activating:

- **Mem0** — Sends conversation summaries to [Mem0's cloud API](https://mem0.ai) for long-term semantic memory. Requires setting `MEM0_API_KEY` AND granting consent in **Settings → Cloud Features**.

> You will be shown a clear warning and asked to confirm before any data leaves your device.

---

## 🛡 Sandbox Mode

Coastal.AI agents can run shell commands, write files, and execute code. The **trust level** controls how much isolation they have:

| Level | What it means | When to use |
|-------|--------------|-------------|
| `trusted` *(default)* | Agents run in your user account — same access as you | Local single-user installs, development |
| `sandboxed` | Agents run in a Linux namespace with overlayfs isolation | Linux servers, multi-user setups, production |
| `autonomous` | Agents run without approval gates | Advanced automation only |

### Default: Trusted

The default trust level is `trusted`. This means:
- ✅ All data stays on your device
- ✅ No network calls to external services
- ⚠️ Agents have the same filesystem access as your user account

### Enabling Sandbox (Linux only)

To enable full sandbox isolation on Linux:

```bash
# Option 1: environment variable
CC_TRUST_LEVEL=sandboxed node packages/core/dist/main.js

# Option 2: persistent file (survives restarts)
echo "sandboxed" > ./data/.trust-level
```

> Sandbox mode uses Linux `unshare` + overlayfs. It is not available on macOS or Windows (falls back to `trusted` automatically).

---

## 🚀 Quick Start

### Before you begin — what you need

| Requirement | Why |
|-------------|-----|
| Mac, Linux, or Windows | All three are fully supported |
| Terminal / command line | To run the install script |
| ~3 GB free disk space | For the AI model and app |
| Internet connection | For first-time setup only — downloads the AI model |

> **New to terminals?**
> - **Mac:** Press `Cmd + Space`, type "Terminal", press Enter
> - **Linux:** Press `Ctrl + Alt + T`
> - **Windows:** Press `Win + R`, type "powershell", press Enter

---

### Step 1 — Run the installer

> **⚠️ Antivirus & Firewall notice**
>
> Coastal.AI downloads Node.js, Ollama, and an AI model (~2 GB) during setup. Your antivirus or firewall may flag or block these downloads — this is a false positive. The installer only pulls software from official sources (nodejs.org, ollama.com, HuggingFace).
>
> **Windows users:** Windows Defender SmartScreen may show a warning when you run the script. Click **"More info" → "Run anyway"** to proceed. If your antivirus quarantines the installer, add your Downloads folder as a temporary exception, then re-run.
>
> **Mac users:** Gatekeeper may block Ollama on first launch with *"cannot be opened because the developer cannot be verified"*. Go to **System Settings → Privacy & Security** and click **"Open Anyway"** next to the blocked item.
>
> **Firewall:** If your firewall blocks outbound connections, you'll need to allow `nodejs.org`, `ollama.com`, and `huggingface.co` during the initial setup. Once installed, Coastal.AI runs entirely offline — no ongoing internet access is required.

---

**Mac / Linux** — open Terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/CoastalCrypto/Coastal.AI/master/install.sh | bash
```

**Windows** — open **PowerShell** (regular or Administrator) and paste:

```powershell
iex (irm https://raw.githubusercontent.com/CoastalCrypto/Coastal.AI/master/install-windows.ps1)
```

For detailed Windows setup and troubleshooting, see [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md).

---

The installer will automatically:
- Check prerequisites (Git, Node.js, Ollama)
- Download the AI model (~2 GB — takes a few minutes on first run)
- Install Coastal.AI and its dependencies
- Start both the Core API and Web UI

When complete, you'll see:

```
✓ COASTAL.AI INSTALLED SUCCESSFULLY

Next steps:
  1. Start services:
     .\coastal-ai.ps1 start   # PowerShell
     coastal-ai.cmd start      # Command Prompt

  2. Open in browser:
     http://127.0.0.1:5173
```

Your browser will open automatically. If it doesn't, go to **http://127.0.0.1:5173** manually.

---

### Step 2 — Start services

After installation:

**Mac / Linux:**
```bash
bash $HOME/coastal-ai/install.sh
```

**Windows (PowerShell):**
```powershell
$env:USERPROFILE\coastal-ai\coastal-ai.ps1 start
```

Or create a shortcut and click it whenever you want to start Coastal.AI.

See [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md) for detailed service management commands.

---

### Step 3 — Create your admin account

The first time you open Coastal.AI you'll see a setup screen. Choose a username and password — this creates your admin account.

> Write down your password somewhere safe. There is no "forgot password" recovery built in yet.

---

### Step 4 — Set up your persona

After logging in, the **Persona Setup** wizard will appear. Fill in:

- **Agent name** — what you want your AI assistant to call itself (e.g. "Aria")
- **Your name** — so the agent addresses you personally
- **Organization name** — your company or project name
- **Organization description** — 2–3 sentences about what your org does

This is saved once and injected into every agent in the system. You can change it anytime in **Settings**.

---

That's it. You're up and running.

---

## 🧪 Sandbox Testing

Coastal.AI includes **ephemeral sandbox environments** for development and CI/CD testing. Spin up a fresh, isolated instance in seconds, test it, and tear it down — no accumulated state, no leftover bugs.

Perfect for:
- Testing new features in isolation
- Reproducing bugs in clean state
- Integration testing
- CI/CD validation
- Parallel test runs

**Quick start:**
```bash
npm run test:sandbox:start          # Start fresh sandbox
npm run test:sandbox:stop           # Stop and clean
npm run test:sandbox:logs           # View sandbox logs
```

Access the sandbox at `http://localhost:5174`. Results saved to `test-artifacts/` for inspection.

**Detailed guide:** See [Sandbox Testing Guide](docs/TEST-SANDBOX.md) and [CI/CD Integration](docs/CI-CD-SANDBOX.md).

---

## 🗺 First Boot Walkthrough

Here's a quick tour of the main areas:

### Chat

<p align="center">
  <img src="docs/screenshots/chat.png" alt="Chat interface" width="80%"/>
</p>

The main chat window. Type a message and press Enter. The agent responds with its name and voice (if configured).

**Tips:**
- Type `/` to browse your saved skills (prompt shortcuts)
- The agent remembers previous conversations in the same session
- Upload files (text, CSV, JSON) with the paperclip button

---

### Dashboard

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="80%"/>
</p>

The **Dashboard** shows a live feed of everything happening — every tool call, session, and agent action in real time.

The top section shows your **Scheduled Jobs** (cron tasks). You can:
- Create a new scheduled task (e.g. "every day at 9am, summarize the news")
- Run any job immediately with the Play button
- Pause or delete jobs

---

### Agents

<p align="center">
  <img src="docs/screenshots/agents.png" alt="Agent editor" width="80%"/>
</p>

The **Agents** page lets you create and configure each AI agent. For each agent you can set:
- Name, role, and personality
- Which AI model it uses
- Its **voice** — pick from browser voices or the built-in VibeVoice engine
- Trust tier (sandboxed / trusted / autonomous)

Click **Preview** next to any voice to hear a sample before saving.

---

### Meet the Agents

<p align="center">
  <img src="docs/screenshots/agent-characters.png" alt="Coastal.AI built-in agent characters" width="90%"/>
</p>

Coastal.AI ships with **9 built-in specialist agents**, each with its own domain, personality, and illustrated character. Click any character in the left sidebar of the Chat page to switch into a conversation with that agent.

| Character | Role | Domain |
|-----------|------|--------|
| 🤖 **General Assistant** | Your everyday AI companion — answers questions, drafts text, runs tools, and routes tasks to the right specialist. | General |
| 💰 **CFO** | Chief Financial Officer. Tracks ledgers, models cash flow, analyses crypto positions, and spots financial risks. | Finance |
| 🖥️ **CTO** | Chief Technology Officer. Reviews architecture, evaluates tech choices, reads logs, and drives engineering decisions. | Tech |
| ⚙️ **COO** | Chief Operating Officer. Coordinates workflows, schedules operations, monitors KPIs, and keeps the business running smoothly. | Operations |
| 🗺️ **Product Manager** | Owns the roadmap. Writes specs, prioritises features, tracks milestones, and keeps the team focused on what ships next. | Product |
| 🔥 **Front-End Wizard** | UI/UX engineer. Writes components, reviews designs, debugs layouts, and turns Figma frames into production code. | Frontend |
| 🐙 **UX Architect** | Maps user flows, runs heuristic reviews, designs information architecture, and champions accessible experiences. | UX |
| 🔍 **QA Lead** | Hunts bugs, writes test plans, reviews edge cases, and won't let anything ship until it's been properly tortured. | QA |
| 🔌 **System Integrator** | Wires services together — APIs, webhooks, databases, message queues, and anything else that needs to talk to anything else. | Systems |

Each agent uses the same underlying model but has a tailored system prompt that shapes its reasoning, vocabulary, and priorities. You can create additional custom agents on the **Agents** page.

---

### Skills

<p align="center">
  <img src="docs/screenshots/skills.png" alt="Skills library" width="80%"/>
</p>

**Skills** are reusable prompt templates. Create one with variable slots like `{{topic}}` and `{{audience}}`, then call it from chat with `/skill-name`. A fill-in panel appears for the variables before the prompt is sent.

Example skill — *Blog Post Outline*:
```
Write a blog post outline about {{topic}} targeted at {{audience}}.
Use {{sections}} sections. Tone: {{tone}}.
```

---

### Analytics

<p align="center">
  <img src="docs/screenshots/analytics.png" alt="Analytics" width="80%"/>
</p>

The **Analytics** page shows usage stats across all agents: total sessions, tool call success rates, average response time, cost breakdown, and a 7-day activity chart.

---

### Tools

<p align="center">
  <img src="docs/screenshots/tools.png" alt="Custom tool builder" width="80%"/>
</p>

The **Tools** page lets you write custom JavaScript tools that agents can call. Write the function body, define its parameters, test it with sample input — all from the browser. No restart required.

---

### Pipeline Builder

The **Pipeline** page lets you chain agents together. Each agent's output becomes the next agent's input — build arbitrarily long sequences and save them to your library.

**Building a pipeline:**
1. Click **+ Add Stage** and select an agent for each step
2. Optionally add a **↩ loop-back** on any stage — set a condition string and max iterations; the runner re-runs that stage until the output contains the condition text
3. Give it a name and click **Save** to store it in the library
4. Enter an initial prompt and click **▶ Run Pipeline**

The page immediately navigates to the **Live Execution View**.

---

### Live Pipeline Execution

Once a pipeline starts, you're taken to a live view with three sections:

- **Timeline** — a horizontal row of stage dots (done ✓ / active pulse / waiting ○) that updates as each stage completes
- **Stage threads** — each stage is a collapsible card. The active stage is expanded and shows every tool call streaming in real time, with function name, arguments, and result. Done stages collapse automatically.
- **Steer bar** — type any message and hit **Send** to inject it into the active agent's next reasoning step. Steered messages appear inline in amber so you can see exactly where your input landed.

Click **Abort** at any time to cancel the run, or **← Back** when it completes to return to the builder.

---

### Channels

<p align="center">
  <img src="docs/screenshots/channels.png" alt="Output channels" width="80%"/>
</p>

**Channels** push agent messages out to external services. Add a Telegram bot, Discord webhook, Slack webhook, or Zapier hook — then agents can send messages there automatically, or you can broadcast manually.

---

## 💿 CoastalOS — Standalone OS

> **This is Path 4.** CoastalOS boots from a USB drive as a complete, self-contained operating system — no existing OS required on the host machine.

CoastalOS is a dedicated Linux image that runs Coastal.AI as a complete operating system. Boot from a USB drive — no installation required, nothing written to your machine's disk.

<p align="center">
  <img src="docs/screenshots/coastalos-desktop.png" alt="CoastalOS desktop" width="80%"/>
</p>

### What you need

- USB drive **8 GB or larger** (all data on it will be erased)
- Latest ISO from the [Releases page](https://github.com/CoastalCrypto/Coastal.AI/releases)

---

### Writing the ISO to USB

**Easiest method (all platforms) — Balena Etcher:**

1. Download [Balena Etcher](https://etcher.balena.io) and open it
2. Click **Flash from file** → select the `.iso` file
3. Click **Select target** → select your USB drive
4. Click **Flash** and wait (~5 minutes)

That's all. Eject the drive when done.

---

**Mac (Terminal method):**

```bash
# Step 1: Find your USB drive name (look for "external" in the list)
diskutil list

# Step 2: Unmount it (replace disk2 with your drive)
diskutil unmountDisk /dev/disk2

# Step 3: Write the ISO (replace disk2 and the filename)
sudo dd if=~/Downloads/coastalos-1.0.0.iso of=/dev/rdisk2 bs=4m status=progress

# Step 4: Eject
diskutil eject /dev/disk2
```

> Use `/dev/rdisk2` (with the `r`) — it's faster than `/dev/disk2`.

---

**Linux (Terminal method):**

```bash
# Step 1: Find your USB drive (look for your drive size)
lsblk

# Step 2: Write the ISO (replace sdb and the filename)
sudo dd if=~/Downloads/coastalos-1.0.0.iso of=/dev/sdb bs=4M status=progress oflag=sync
```

> Double-check the drive letter (`sdb`, `sdc`, etc.) — writing to the wrong device will erase it.

---

### Booting from USB

1. Plug the USB drive into the computer you want to run CoastalOS on
2. Restart the computer
3. When the logo appears, press the boot menu key:
   - **Most PCs:** `F12`, `F11`, or `F9`
   - **HP:** `F9`
   - **Dell:** `F12`
   - **Lenovo:** `F12`
   - **Mac:** Hold `Option ⌥` immediately after the chime
4. Select your USB drive from the list
5. CoastalOS boots in ~30–60 seconds and opens the interface fullscreen

**Notes:**
- Your data (memory, persona, users) is stored on the USB — take it anywhere
- The AI model (~2 GB) is downloaded on first boot — internet required
- Requires UEFI firmware (most machines from 2012 onward)

---

## 🔧 Stopping and Starting

### If you installed with the install script

**Mac / Linux:**
```bash
# Stop
kill $(cat /tmp/coastal-ai-core.pid /tmp/coastal-ai-web.pid) 2>/dev/null

# Start again
bash $HOME/coastal-ai/install.sh
```

**Windows (PowerShell):**
```powershell
# Stop
$env:USERPROFILE\coastal-ai\coastal-ai.ps1 stop

# Start
$env:USERPROFILE\coastal-ai\coastal-ai.ps1 start

# Check status
$env:USERPROFILE\coastal-ai\coastal-ai.ps1 status
```

See [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md) for all service management commands.

### If you installed via APT (Ubuntu/Debian)

```bash
sudo systemctl stop Coastal.AI
sudo systemctl start Coastal.AI
sudo systemctl status Coastal.AI   # check it's running
```

---

## 🛠 Troubleshooting

| Problem | What to try |
|---------|-------------|
| Browser didn't open | Go to `http://127.0.0.1:5173` manually |
| "Port already in use" | Run `kill $(cat /tmp/coastal-ai-core.pid)` then restart |
| First response is very slow | Normal — the AI model loads into memory on first use (~30s) |
| Agent not responding | Check logs: `tail -f /tmp/coastal-ai-core.log` |
| Forgot your password | Delete `./data/users.db` and re-run setup (this resets all users) |
| Install script failed | Make sure you have `curl` installed: `which curl` |

---

## Ubuntu / Debian — APT install

For servers and production setups, install as a system service:

```bash
curl -fsSL https://CoastalCrypto.github.io/Coastal.AI/setup.sh | sudo bash
```

This adds the signed APT repository and installs `Coastal.AI` as a systemd service that starts automatically on boot.

---

## 🎭 Agent Persona

Set once in the **Settings** page — applied to all agents.

| Field | Description | Example |
|-------|-------------|---------|
| Agent Name | What your assistant calls itself | `Aria` |
| Agent Role | One-line role description | `Executive Assistant` |
| Personality | Free-text traits | `Professional, concise, proactive` |
| Org Name | Your organization | `Acme Corp` |
| Org Context | 2–4 sentences about your org | `We build fintech software...` |
| Owner Name | Your name — agents address you by this | `Jordan` |

---

## 🤖 Scheduled Agents (Cron Jobs)

Agents can run automatically on a schedule without any user input. Configure them from the **Dashboard**.

**Example schedules:**

| What you type | When it runs |
|---------------|-------------|
| `0 8 * * 1-5` | Weekdays at 8:00 AM |
| `0 */2 * * *` | Every 2 hours |
| `0 9 * * 1` | Every Monday at 9 AM |
| `30 17 * * 5` | Every Friday at 5:30 PM |

> Not familiar with cron syntax? Use [crontab.guru](https://crontab.guru) to build schedules visually.

---

## 🐝 Multi-Agent Swarm

For complex tasks, Coastal.AI can coordinate multiple specialist agents in parallel. Send a task to the team and get a synthesized result from the COO, CFO, and CTO agents working together.

```bash
curl -X POST http://localhost:4747/api/team/run \
  -H "Content-Type: application/json" \
  -d '{"task": "Analyze Q2 financials and prepare a board summary"}'
```

---

## 📣 Output Channels

Push agent messages to external services. Set up in the **Channels** tab.

| Channel | What you need |
|---------|--------------|
| **Telegram** | A Telegram bot token + your chat ID |
| **Discord** | A webhook URL from your server settings |
| **Slack** | A webhook URL from your workspace |
| **Zapier** | A catch-hook URL from your Zap |

All config is stored encrypted. You can test each channel individually or broadcast a message to all enabled channels at once.

---

## 🏗 Architecture

Coastal.AI runs as three cooperating processes:

```
┌────────────────────────────────────────────────────────────────────┐
│  coastal-server  (packages/core :4747)                             │
│                                                                    │
│  UserStore (multi-user auth, scrypt, role-based sessions)          │
│  PersonaManager ──► AgentSession (soul template interpolation)     │
│                                                                    │
│  CascadeRouter ──► DomainClassifier ──► AgentRegistry             │
│       │                                      │                    │
│  TinyRouter (ONNX)              AgenticLoop ◄─┘                    │
│       │                              │                            │
│  ModelRouter                   PermissionGate                     │
│    vLLM → AirLLM → Ollama          │                             │
│                              ToolRegistry (built-in + custom JS)   │
│                                    │                              │
│                              ShellBackend                          │
│                     Namespace / Docker / Local                     │
│                                                                    │
│  EventBus (SSE, 200-event ring buffer)                             │
│  AnalyticsStore (action_log → snapshots)                           │
│  ChannelManager (Telegram / Discord / Slack / Zapier)              │
│  UnifiedMemory + InfinityClient    BossAgent + TeamChannel         │
│                                                                    │
│  /api/auth/*  /api/admin/*  /api/chat  /api/events  /api/analytics│
└──────────────┬─────────────────────────────────────────────────────┘
               │  REST + WebSocket + SSE (:4747)
    ┌──────────┼──────────┐
    │          │          │
┌───┴──────┐ ┌─┴──────────┴──────────────────────┐
│ Web UI   │ │  coastal-daemon                    │
│ React 19 │ │  ProactiveScheduler (NL cron)      │
│ Tailwind │ │  HandRunner (HTTP POST to /api/chat│
│ Vite 6   │ │  VibeVoiceClient (streaming voice) │
└──────────┘ └───────────────────────────────────┘
```

### Package Layout — Core vs. Optional

Coastal.AI is a **kernel + optional verticals** workspace. The kernel
is domain-neutral; verticals plug additional capabilities into it
through a small contract (the kinds-registry plus subpath exports).
You can delete any optional vertical and the kernel keeps working.

**Kernel (always installed):**

| Package | What it does |
|---------|--------------|
| [`packages/core`](packages/core) | Fastify server, SQLite stores, model router, REST/WS API, unified memory + notes substrate |
| [`packages/architect`](packages/architect) | Self-improvement daemon (planning → building → PR → review), gates, learnings (code-graph, design, evals) |
| [`packages/web`](packages/web) | React 19 dashboard — chat, agent graph, settings |
| [`packages/daemon`](packages/daemon) | Scheduled-agent runner (NL-cron) |
| [`packages/desktop`](packages/desktop) | Tauri desktop shell (Win/macOS/Linux) — spawns the core sidecar |

**Optional verticals (delete-safe):**

| Package | Adds | Opt-in marker |
|---------|------|---------------|
| [`packages/trading-architect`](packages/trading-architect) | Market data + signal generators (RSI, Kronos adapter); `kind='trade'` notes | Importing the package registers `'trade'` with the core kinds-registry |
| [`packages/video`](packages/video) | Motion-canvas video pipeline | Standalone build/play scripts |

**The pattern:** new verticals follow trading-architect's lead — a peer
package that imports from `@coastal-ai/core/memory/*`, calls
`registerKind(...)` at module load to extend the note schema, and ships
its own ingester/runner. The kernel never imports a vertical.

**Multi-agent coordination (cluster — optional, delete-safe):**

The layer that turns N single-node installs into one coordinated swarm.
Each package is a peer that rides the same Agent2Agent (A2A) protocol; a
single-node install never imports them. Software-complete today — the
12-node BC-250 cluster deployment is hardware-gated (see the
[Roadmap](#-roadmap)).

| Package | What it does |
|---------|--------------|
| [`packages/coordination`](packages/coordination) | The peer kernel — Ed25519-signed A2A envelopes, TOFU peer registry, a 6-state super-option task board, atomic handoff + zombie reclaim, a dependency resolver, broadcast replication, and pluggable transports (localhost / TCP+mDNS / Telegram) |
| [`packages/llm-client`](packages/llm-client) | Injectable LLM interface + OpenAI-compatible HTTP adapter (llama.cpp / Ollama / OpenAI), SSE streaming |
| [`packages/planner-agent`](packages/planner-agent) | Decomposes a `plan_task` goal into `code_task` + `review_task` subtasks with dependency edges (deterministic or LLM-backed) |
| [`packages/coding-agent`](packages/coding-agent) | Claims `code_task`, drives a model to produce code |
| [`packages/reviewing-agent`](packages/reviewing-agent) | Claims `review_task`, parses VERDICT / SUMMARY / ISSUES from the model |
| [`packages/curator-agent`](packages/curator-agent) | Always-on grading + pruning of the notes substrate (dry-run by default) |
| [`packages/mission-control`](packages/mission-control) | Zero-dependency `node:http` + SSE dashboard for watching the swarm live |
| [`packages/swarm-demos`](packages/swarm-demos) | Runnable end-to-end demos composing the whole stack in one process (no hardware needed) |

### Multi-Agent Coordination (A2A)

Beyond the single-node process model above, Coastal.AI can run as a
**swarm of role-specialized nodes** that coordinate over the Agent2Agent
(A2A) protocol. Each node owns its own SQLite task board; state crosses
the wire as Ed25519-signed broadcasts that peers apply through a
logical-clock-guarded replicator — so no single node is the source of
truth, and a crashed node's claims are reclaimed by a peer.

```
 main / planner ──┐          ┌── coder      (claims code_task)
                  ├── A2A bus ┤
   reviewer ──────┘           └── curator    (grades notes substrate)
        │                           │
        └────────────── mission-control (HTTP + SSE dashboard)
```

- **Transports** — `localhost` (in-process demos), `TCP + mDNS` (LAN
  auto-discovery, the cluster default), and `Telegram` (off-LAN
  fallback). The daemon is transport-agnostic: identical code runs on one
  box or twelve.
- **Task lifecycle** — a 6-state super-option board (queued → claimed →
  blocked → done / failed / cancelled) with atomic handoff and zombie
  reclaim.
- **First deployment target** — a 12-node ASRock BC-250 chassis (see
  [CoastalOS](#-coastalos--standalone-os) and the [Roadmap](#-roadmap)).
  The protocol is identical whether the twelve nodes share a chassis or
  span the planet.

Run the whole stack in one process — no cluster required:

```bash
pnpm --filter @coastal-ai/swarm-demos demo        # 3 nodes, basic replication
pnpm --filter @coastal-ai/swarm-demos demo:full   # planner → coder → reviewer
pnpm --filter @coastal-ai/swarm-demos demo:live   # + live mission-control dashboard
```

### Trust Tiers

| Tier | What agents can do |
|------|-------------------|
| `sandboxed` (default) | Isolated container — can't touch your files or system |
| `trusted` | Host shell access, restricted to the workspace directory |
| `autonomous` | Full unrestricted host shell — use with caution |

### User Roles

| Role | What they can access |
|------|---------------------|
| `admin` | Everything — all pages, user management, models, tools, channels |
| `operator` | Chat, dashboard, analytics — no user or model management |
| `viewer` | Chat and dashboard only |

---

## ⚙️ Configuration

### Environment variables

You can customize behavior by setting these before starting the app (or in a `.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `CC_PORT` | `4747` | API server port |
| `CC_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` to expose on network) |
| `CC_DATA_DIR` | `./data` | Where data is stored (SQLite, persona, etc.) |
| `CC_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama endpoint |
| `CC_DEFAULT_MODEL` | `llama3.2` | AI model to use |
| `CC_TRUST_LEVEL` | `sandboxed` | Agent trust tier |
| `CC_AGENT_WORKDIR` | `./data/workspace` | Agent sandbox folder |
| `CC_VLLM_URL` | `http://127.0.0.1:8000` | vLLM endpoint (optional, auto-probed) |
| `CC_AIRLLM_URL` | `http://127.0.0.1:8002` | AirLLM endpoint (optional, auto-probed) |
| `CC_VIBEVOICE_URL` | `http://127.0.0.1:8001` | VibeVoice TTS (optional, auto-probed) |
| `CC_CORS_ORIGINS` | `localhost:5173` | Allowed origins for the web UI |
| `CC_VRAM_BUDGET_GB` | `24` | GPU VRAM ceiling for model selection |

---

## 🔒 Security

### Protecting a production install

If you're running Coastal.AI on a server (not just locally), follow these steps:

- [ ] Put it behind a reverse proxy (nginx or Caddy) with HTTPS/TLS
- [ ] Set `CC_CORS_ORIGINS` to your actual domain
- [ ] Set `CC_HOST` to `127.0.0.1` (don't expose the API port directly)
- [ ] Put `CC_DATA_DIR` on encrypted storage
- [ ] Start with `sandboxed` trust tier
- [ ] Set a strong admin password

### API authentication

```bash
# Create admin account (first boot only)
curl -X POST http://localhost:4747/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}'

# Login — returns a session token
curl -X POST http://localhost:4747/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}'

# Use the token on admin endpoints
curl http://localhost:4747/api/admin/channels \
  -H "x-admin-session: <your-session-token>"
```

Session tokens are HMAC-SHA256 signed with a 7-day TTL. Passwords are stored with scrypt (N=32768, r=8, p=1).

---

## 📡 API Reference

### Auth

```
GET  /api/auth/setup               → { needsSetup: boolean }
POST /api/auth/setup               { username, password } → { sessionToken, user }
POST /api/auth/login               { username, password } → { sessionToken, user }
GET  /api/auth/me                  → { user }
```

### Chat

```
POST /api/chat
  { "message": "...", "sessionId": "optional-uuid" }
  → { sessionId, reply, domain, model }

POST /api/chat/stream              (SSE streaming)
  event: domain   data: { domain }
  event: token    data: { token }
  event: reply    data: { reply }
  event: done     data: { sessionId, domain }
  event: error    data: { message }
```

### Skills

```
GET    /api/skills                 → [skill]  (enabled only)
GET    /api/admin/skills           → [skill]  (all)
POST   /api/admin/skills           { name, description, prompt, agentId? }
PATCH  /api/admin/skills/:id       { description?, prompt?, enabled? }
DELETE /api/admin/skills/:id
```

### Scheduled Jobs (Cron)

```
GET    /api/admin/crons            → [job]
POST   /api/admin/crons            { name, schedule, agentId, task }
PATCH  /api/admin/crons/:id        { name?, schedule?, agentId?, task?, enabled? }
DELETE /api/admin/crons/:id
POST   /api/admin/crons/:id/trigger  → { output }
```

### Agents

```
GET    /api/admin/agents           → [agent]
POST   /api/admin/agents           { name, role, soul, model?, voice?, trust? }
PATCH  /api/admin/agents/:id       { name?, role?, soul?, model?, voice?, trust? }
DELETE /api/admin/agents/:id
```

### Analytics

```
GET /api/analytics
  → { totalToolCalls, totalSessions, avgDurationMs, overallSuccessRate,
      topTools, last7Days, decisionBreakdown }
```

### Custom Tools

```
GET    /api/admin/tools            → [tool]
POST   /api/admin/tools            { name, description, parameters, implBody }
PATCH  /api/admin/tools/:id        { name?, description?, parameters?, implBody?, enabled? }
DELETE /api/admin/tools/:id
POST   /api/admin/tools/test       { implBody, parameters?, args? } → { output, success }
```

### Output Channels

```
GET    /api/admin/channels         → [channel]
POST   /api/admin/channels         { type, name, config }
PATCH  /api/admin/channels/:id     { name?, config?, enabled? }
DELETE /api/admin/channels/:id
POST   /api/admin/channels/:id/test   → { success }
POST   /api/admin/channels/broadcast  { message } → [{ id, name, success }]
```

### Users

```
GET    /api/admin/users            → [user]
POST   /api/admin/users            { username, password, role? }
PATCH  /api/admin/users/:id        { username?, password?, role? }
DELETE /api/admin/users/:id
```

### Team (multi-agent swarm)

```
POST /api/team/run
  { "task": "..." }
  → { reply, subtaskCount, subtasks: [{ subtaskId, reply }] }
```

### Pipeline

```
# Saved pipeline definitions
GET    /api/admin/pipelines                → [pipeline]
POST   /api/admin/pipelines               { name, stages } → pipeline
GET    /api/admin/pipelines/:id           → pipeline
PATCH  /api/admin/pipelines/:id           { name?, stages? }
DELETE /api/admin/pipelines/:id

# Execution
POST   /api/pipeline/run/async            { stages, input } → { runId }
GET    /api/pipeline/run/:runId           → { status, stageIdx }
GET    /api/pipeline/run/:runId/events    (SSE stream — see event types below)
POST   /api/pipeline/run/:runId/steer     { message } → 204
DELETE /api/pipeline/run/:runId           (abort)
```

**SSE event types** emitted on `/events`:

| Event | Key payload fields |
|-------|--------------------|
| `pipeline_start` | `runId, stageCount` |
| `stage_start` | `stageIdx, agentId, agentName, iteration` |
| `tool_call_start` | `stageIdx, toolName, args` |
| `tool_call_end` | `stageIdx, toolName, result, durationMs` |
| `stage_steer` | `stageIdx, message` |
| `loop_iteration` | `fromStageIdx, toStageIdx, iteration, condition` |
| `stage_end` | `stageIdx, output, durationMs` |
| `pipeline_done` | `runId, finalOutput, totalDurationMs` |
| `pipeline_error` | `stageIdx, error` |

---

### System

```
GET  /api/system/stats             → { cpu, mem, disk, gpu, models, uptime }
GET  /api/version                  → { version, commit }
GET  /api/voices                   → [{ id, name, provider }]
POST /api/admin/tts                { voice, text } → audio/wav
GET  /api/admin/logs?service=...&lines=100
POST /api/admin/update             (async: git pull → build → restart)
```

## 📖 Usage Examples

### 🛠 System Self-Repair
If the system becomes inconsistent due to multi-source updates, use the self-repair utility:

```bash
# In the packages/core directory
pnpm repair
```
*This validates your filesystem and syncs your agent registry.*

### 🚀 Data Analysis (CFO Agent)
Analyze large financial datasets using the high-performance Polars tool.

**Prompt for CFO Agent:**
> "Analyze `ledgers.csv`. Provide a summary of transactions by category."

*The agent will automatically call `analyze_dataset` using the Rust-based Polars engine for high-speed processing.*

### 🔌 Dynamic MCP Marketplace
Connect custom tools (e.g., Postgres, Google Drive) without code changes.

1. Add a server via API:
```bash
curl -X POST http://localhost:4747/api/admin/mcp \
  -H "Content-Type: application/json" \
  -d '{"id": "sql-server", "name": "Postgres", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres", "postgres://user:pass@localhost/db"], "enabled": true}'
```
2. Restart or reload the system — your agent now sees new tools with the `sql-server_` prefix.

### 📦 Skill Packs (Bundling)
Package your custom agent configurations and prompts for easy sharing.

**Export:**
```bash
curl -X POST http://localhost:4747/api/admin/skill-packs/export \
  -H "Content-Type: application/json" \
  -d '{"metadata": {"id": "finance-pack", "name": "CFO Pack", "author": "John"}, "skillIds": ["tax-calc", "q2-forecasting"]}'
```
*Saves your configuration as a shareable JSON file.*

---


```bash
pnpm test                          # all packages
pnpm --filter core test
pnpm --filter daemon test
MOCK_NAMESPACE=1 pnpm test         # skip Linux namespace tests on Mac/CI
```

---

## 📂 Project Structure

```
Coastal.AI/
├── packages/
│   ├── core/                      # Fastify API server (:4747)
│   │   └── src/
│   │       ├── users/             # Multi-user auth, scrypt, session tokens
│   │       ├── channels/          # Telegram / Discord / Slack / Zapier
│   │       ├── tools/custom/      # In-browser JS sandbox tool loader
│   │       ├── events/            # SSE ring buffer
│   │       ├── analytics/         # Action log + snapshots
│   │       ├── persona/           # Persona manager
│   │       ├── agents/            # AgenticLoop, BossAgent, MetaAgent, TeamChannel
│   │       ├── pipeline/          # PipelineStore, AsyncPipelineRunner, SteerQueue
│   │       ├── cron/              # Scheduled job store + croner scheduler
│   │       ├── skills/            # Skill template store
│   │       ├── models/            # ModelRouter, AirLLM, vLLM clients
│   │       ├── memory/            # UnifiedMemory + Infinity vector DB
│   │       ├── voice/             # VibeVoice TTS client
│   │       └── api/routes/        # All HTTP routes
│   ├── web/                       # React 19 + Tailwind + Vite 6
│   │   └── src/
│   │       ├── pages/             # Chat, Dashboard, Analytics, Skills, Tools, Agents, Pipeline, PipelineRun...
│   │       ├── components/        # NavBar, AgentEditor
│   │       ├── context/           # AuthContext
│   │       └── hooks/             # useEventStream, usePipelineRun
│   ├── daemon/                    # Proactive scheduler + voice
│   ├── architect/                 # Self-build loop: Planner, Patcher, Validator
│   ├── desktop/                   # Tauri desktop shell (Win/macOS/Linux)
│   ├── coordination/              # A2A peer kernel — task board, identity, transports, replication
│   ├── llm-client/                # Injectable LLM client (llama.cpp / Ollama / OpenAI)
│   ├── planner-agent/             # plan_task → code + review decomposition
│   ├── coding-agent/              # code_task worker
│   ├── reviewing-agent/           # review_task worker
│   ├── curator-agent/             # notes-substrate grader / pruner
│   ├── mission-control/           # swarm dashboard (node:http + SSE)
│   └── swarm-demos/               # runnable end-to-end multi-agent demos
├── os/                            # Coastal.AI OS product (two editions + shared base)
│   ├── base/                      # shared: VERSION, apt lane, systemd units
│   ├── kiosk/                     # desktop USB ISO edition (live-build + VibeVoice)
│   └── node/                      # BC-250 cluster-node image (Ubuntu 24.04 + inference stack)
├── packaging/                     # .deb build + APT repo publish scripts
├── agents/                        # Per-agent runtime config (cfo / coo / cto / general)
└── .github/workflows/             # CI: test suite, .deb build, ISO build, APT publish
```

---

## 🗺 Roadmap

| Phase | Status | What shipped |
|-------|--------|-------------|
| Foundation | ✅ | CascadeRouter, LosslessMemory, model quant pipeline, web portal |
| APEX OS | ✅ | ShellBackend tiers, trust system, Agent Hands, daemon |
| CoastalOS | ✅ | Voice pipeline, architect self-build, Electron kiosk |
| ClawOS Native | ✅ | NamespaceBackend, VllmClient, ISO build + CI |
| ClawTeam | ✅ | AirLLM, Infinity, VibeVoice, BossAgent swarm, MetaAgent, persona |
| v1.0.0 Launch | ✅ | APT repo, SSE streaming, signed packages, security audit |
| v1.1.0 | ✅ | Live dashboard, analytics, custom tool builder, output channels, multi-user auth |
| v1.2.0 | ✅ | Skills library, cron scheduler, agent voice, version update banner, Electron auto-updater |
| **v1.3.0** | ✅ | Pipeline builder — save/load pipelines, live SSE execution view, live steering, loop-back stages |
| **v1.4.0** | ✅ | UX polish — pipeline run history & replay, per-pane chat voice, chat retry button, expandable dashboard events, empty states with CTAs, credential eye-toggle, nav-away warning |
| **v1.5.0** | ✅ | Self-healing architect daemon; kernel + optional-vertical split (delete-safe verticals) |
| **v1.6.0** | ✅ | Architect preference profile — 7 behavior knobs + mode presets (hands-on / hands-off / autopilot) |
| **v1.7.0** | 🚧 | Unified knowledge graph (code-graph, design context, eval gate, DOM snapshots) + impact-radius planning |
| **Multi-Agent OS** | 🚧 | A2A coordination layer, role-agent peers (planner / coder / reviewer / curator), `llm-client`, mission control, swarm demos — **software-complete**; 12-node BC-250 cluster bring-up is hardware-gated |
| **Desktop App** | ✅ | Standalone Tauri shell (`packages/desktop`) for Windows / macOS / Linux — bundles the core sidecar, no Node/pnpm needed; cross-platform CI release (NSIS / DMG / `.deb`). Supersedes the retired Electron kiosk. |

---

## 🙏 Open Source

| Project | How we use it |
|---------|--------------|
| **[Ollama](https://github.com/ollama/ollama)** | Local inference engine |
| **[Fastify](https://github.com/fastify/fastify)** | HTTP/WebSocket server |
| **[vLLM](https://github.com/vllm-project/vllm)** | GPU-accelerated inference |
| **[AirLLM](https://github.com/lyogavin/airllm)** | Layer-streaming for large models on small VRAM |
| **[Infinity](https://github.com/infiniflow/infinity)** | Hybrid vector database |
| **[Mem0](https://github.com/mem0ai/mem0)** | Personalized memory layer |
| **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** | Synchronous SQLite driver |
| **[croner](https://github.com/hexagon/croner)** | Zero-dependency cron scheduler |

---

## 🤝 Contributing

1. Fork the repo
2. `git checkout -b feat/your-feature`
3. `pnpm test` — keep all tests green
4. Open a pull request

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
