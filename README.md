# Antigravity Web 📱

A reactive web interface for monitoring and controlling your [Antigravity](https://antigravity.google) AI sessions remotely.

## What It Does

Connect to your Antigravity IDE from your browser via Chrome DevTools Protocol (CDP). View conversation history, send messages, and control your AI sessions without being at your desk.

## Supported Features ✅

- **Real-time conversation mirroring** — See AI responses as they stream
- **Send messages** — Type and submit prompts from your browser
- **Stop generation** — Halt AI responses mid-stream
- **View conversation history** — Browse and switch between conversations
- **Expand/collapse thinking blocks** — Toggle AI reasoning visibility
- **View artifacts** — Open implementation plans, walkthroughs, and other artifacts
- **Model & mode switching** — Change between Gemini/Claude/GPT and Fast/Planning modes
- **Quota display** — View usage limits via [ag-quota](https://open-vsx.org/extension/henrikdev/ag-quota) extension

## Not Supported ❌

- **Code files** — Cannot view or edit code files
- **Terminal access** — No terminal control
- **Voice input** — No speech-to-text support
- **Multi-session** — One IDE connection at a time

## Quick Start

1. **Start the server:**
   ```bash
   # macOS/Linux
   ./start.sh

   # Windows
   start.bat
   ```

2. **Launch Antigravity with debugging enabled:**
   ```bash
   antigravity . --remote-debugging-port=9000
   ```

3. **Open the URL shown in terminal on your browser** (within same network, or via tailscale)

## Related Projects 🙏

This project exists alongside other community-built Antigravity mobile tools:

- [antigravity_phone_chat](https://github.com/krishnakanthb13/antigravity_phone_chat) by @krishnakanthb13 — Original phone chat implementation
- [AntigravityMobile](https://github.com/Almoksha/AntigravityMobile) by @Almoksha — Alternative mobile client
- [Antigravity-Shit-Chat](https://github.com/gherghett/Antigravity-Shit-Chat) by @gherghett — The project this was originally forked from
- [ag_bridge](https://github.com/Mario4272/ag_bridge) by @Mario4272 — Bridge implementation

## About This Code 🤖

**Full transparency:** All code in this repository was written by AI. I ([@kiawin](https://github.com/kiawin)) serve as the supervisor — reviewing, testing, and guiding the AI's development, but not writing the code myself.

## Disclaimer

This project is provided as-is, without any warranty. Use at your own risk.

The author is not responsible for any damage or loss of data that may occur as a result of using this project.

This repository is opinionated and may not be suitable for everyone. It is recommended to use it as a reference for building your own Antigravity web interface.

## License

[GNU GPL v3](LICENSE)
