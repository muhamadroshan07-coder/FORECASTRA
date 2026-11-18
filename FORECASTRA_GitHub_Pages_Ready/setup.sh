#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required. Install it from https://nodejs.org/ and run this script again."
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Found Node.js $(node -v). Please install Node.js 18 or newer."
  exit 1
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env. Add your API keys before using Research AI and optional integrations."
fi
npm install --ignore-scripts --no-audit --no-fund
echo "Setup complete. Run ./start_forecastra.command or npm start."
