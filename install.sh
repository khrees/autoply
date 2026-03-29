#!/bin/bash
set -e

REPO="khrees2412/autoply"
BINARY_NAME="autoply"

# Prefer ~/.local/bin if it's in PATH, otherwise fall back to /usr/local/bin
if echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.local/bin"; then
  INSTALL_DIR="$HOME/.local/bin"
else
  INSTALL_DIR="/usr/local/bin"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Detect OS
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
  darwin) OS="darwin" ;;
  linux) OS="linux" ;;
  mingw*|msys*|cygwin*) OS="windows" ;;
  *) error "Unsupported OS: $OS" ;;
esac

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) error "Unsupported architecture: $ARCH" ;;
esac

# Windows only supports x64
if [ "$OS" = "windows" ]; then
  ARCH="x64"
  BINARY_NAME="autoply.exe"
fi

# macOS Intel fallback warning
if [ "$OS" = "darwin" ] && [ "$ARCH" = "x64" ]; then
  warn "Intel Mac detected. If you have Apple Silicon, make sure you're not running under Rosetta."
fi

# Linux only supports x64 for now
if [ "$OS" = "linux" ] && [ "$ARCH" = "arm64" ]; then
  warn "Linux ARM64 not available yet, trying x64..."
  ARCH="x64"
fi

if [ "$OS" = "windows" ]; then
  ASSET_NAME="autoply-windows-x64.exe"
else
  ASSET_NAME="autoply-${OS}-${ARCH}"
fi

info "Detected: $OS-$ARCH"
info "Downloading $ASSET_NAME..."

# Get latest release download URL
DOWNLOAD_URL="https://github.com/$REPO/releases/download/nightly/$ASSET_NAME"

# Download to temp
TMP_FILE=$(mktemp)
if ! curl -fL --http1.1 --progress-bar "$DOWNLOAD_URL" -o "$TMP_FILE"; then
  error "Failed to download from $DOWNLOAD_URL"
fi

chmod +x "$TMP_FILE"

# Install
info "Installing to $INSTALL_DIR..."
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP_FILE" "$INSTALL_DIR/$BINARY_NAME"
else
  warn "Elevated permissions required to install to $INSTALL_DIR"
  sudo mv "$TMP_FILE" "$INSTALL_DIR/$BINARY_NAME"
fi

# Verify installation
if command -v autoply &> /dev/null; then
  echo ""
  info "Successfully installed autoply!"
  echo ""
  echo "  Next steps:"
  echo "    1. Run 'autoply init' to set up your profile"
  echo "    2. Run 'autoply --help' for all commands"
  echo ""
else
  warn "Installed but 'autoply' not found in PATH. You may need to add $INSTALL_DIR to your PATH."
fi
