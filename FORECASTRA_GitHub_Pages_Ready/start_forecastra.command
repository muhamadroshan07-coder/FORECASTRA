#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required. Install Node.js first."
  read -r -p "Press Return to close..."
  exit 1
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env. Add your API keys, then restart this launcher."
fi
(open http://localhost:3000 >/dev/null 2>&1 &) || true
npm start
