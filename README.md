# Antigravity Phone Connect 📱

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**Antigravity Phone Connect** is a high-performance, real-time mobile monitor and remote control for your Antigravity AI sessions. It allows you to step away from your desk while keeping full sight and control over your AI's thinking process and generations.

**Note:** This project is a refined fork/extension based on the original [Antigravity Shit-Chat](https://github.com/gherghett/Antigravity-Shit-Chat) by gherghett.

---

## 🚀 Quick Start (Windows)

The easiest way to get started is using the provided automation script.

### 1. Enable Antigravity Debugging
You must launch Antigravity with the remote debugging port enabled. Run this command in your project folder:
```bash
antigravity . --remote-debugging-port=9000
```

### 2. Run the Monitor
Simply double-click **`start_ag_phone_connect.bat`** in this folder.
The script will:
- Verify Node.js is installed.
- Automatically install dependencies (`npm install`) if they are missing.
- Detect and display your **Local IP Address**.
- Start the server on port `3000`.

### 3. Connect Your Phone
1. Ensure your phone is on the **same Wi-Fi network** as your PC.
2. Look at the terminal window opened by the `.bat` file to find your `IPv4 Address`.
3. Open your mobile browser and enter: `http://YOUR_IP:3000`
   *(Example: `http://192.168.1.5:3000`)*

---

## ✨ Features
- **Real-Time Mirroring**: 1-second polling interval for a near-instant sync experience.
- **Remote Control**: Send messages, stop generations, and switch Modes (Fast/Planning) or Models (Gemini/Claude/GPT) directly from your phone.
- **Thought Expansion**: Tap on "Thinking..." or "Thought" blocks on your phone to remotely expand them in the desktop IDE.
- **Smart Sync**: Bi-directional synchronization ensures your phone always shows the current Model and Mode selected on your desktop.
- **Premium Mobile UI**: A sleek, dark-themed interface optimized for touch interaction and long-form reading.
- **Zero-Config**: The launch scripts handle the heavy lifting of environment setup.

---

## 📂 Documentation
For more technical details, check out:
- [**Code Documentation**](CODE_DOCUMENTATION.md) - Architecture, Data Flow, and API.
- [**Design Philosophy**](DESIGN_PHILOSOPHY.md) - Why it was built this way.
- [**Contributing**](CONTRIBUTING.md) - Guidelines for developers.

---

## License
Licensed under the [GNU GPL v3](LICENSE).  
Copyright (C) 2026 **Krishna Kanth B** (@krishnakanthb13)
