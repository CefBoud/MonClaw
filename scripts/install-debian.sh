#!/usr/bin/env bash
set -eu

# Install base dependencies.
sudo apt update
sudo apt install -y zip unzip git curl

# Install Bun.
curl -fsSL https://bun.com/install | bash

# Clone repo.
git clone https://github.com/CefBoud/MonClaw.git
cd MonClaw

# Add Bun to PATH for this shell.
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Install deps and run setup.
bun install
bun run setup

# Start the dev server.
bun run dev
