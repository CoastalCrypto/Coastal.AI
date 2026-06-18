#!/bin/bash
set -e

echo "[post-install] Installing Coastal.AI..."

# Install Node.js 22 via NodeSource (packages.list only ships the distro nodejs which may be < 22)
if ! node --version 2>/dev/null | grep -qE '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Install pnpm
npm install -g pnpm@latest

# Install Ollama (always — CPU fallback)
curl -fsSL https://ollama.com/install.sh | sh

# Install piper-tts
pip3 install piper-tts --break-system-packages

# Install openwakeword
pip3 install openwakeword --break-system-packages

# Always-on: Infinity vector DB
curl -L https://github.com/infiniflow/infinity/releases/latest/download/infinity-linux-x86_64 \
  -o /usr/local/bin/infinity && chmod +x /usr/local/bin/infinity
mkdir -p /var/lib/coastal-ai/infinity
chown coastal:coastal /var/lib/coastal-ai/infinity
systemctl enable coastal-infinity.service

# Install vLLM, VibeVoice, and AirLLM only if GPU present (CUDA or ROCm)
if nvidia-smi &>/dev/null 2>&1 || rocm-smi &>/dev/null 2>&1; then
  echo "[post-install] GPU detected — installing vLLM, VibeVoice, AirLLM..."
  pip3 install vllm --break-system-packages || echo "[post-install] vLLM install failed — Ollama fallback active"
  systemctl enable coastal-vllm.service || true
  pip3 install -r /opt/coastal-ai/coastalos/vibevoice/requirements.txt --break-system-packages \
    || echo "[post-install] VibeVoice install failed — whisper-cpp/piper fallback active"
  systemctl enable coastal-vibevoice.service || true
  pip3 install airllm --break-system-packages \
    || echo "[post-install] AirLLM install failed — Ollama fallback active"
  systemctl enable coastal-airllm.service || true
else
  echo "[post-install] No GPU detected — vLLM/VibeVoice/AirLLM skipped, using Ollama"
fi

# Create coastal user and install project
useradd -m -s /bin/bash coastal || true
mkdir -p /opt/coastal-ai /var/lib/coastal-ai/data /var/lib/coastal-ai/workspace

# Clone and build Coastal.AI
REPO_URL="${CC_REPO_URL:-https://github.com/CoastalCrypto/Coastal.AI.git}"
REPO_REF="${CC_REPO_REF:-master}"
if [[ ! -f /opt/coastal-ai/package.json ]]; then
  git clone --depth=1 --branch "$REPO_REF" "$REPO_URL" /opt/coastal-ai
fi
cd /opt/coastal-ai
pnpm install --frozen-lockfile
pnpm build

chown -R coastal:coastal /opt/coastal-ai /var/lib/coastal-ai

# Set up cgroup slice for namespace sandbox
mkdir -p /etc/systemd/system/coastal.slice.d
cat > /etc/systemd/system/coastal.slice.d/limits.conf << 'SLICE_EOF'
[Slice]
MemoryMax=512M
CPUQuota=200%
SLICE_EOF

# Copy labwc config
mkdir -p /home/coastal/.config/labwc
cp /tmp/labwc/rc.xml /home/coastal/.config/labwc/
cp /tmp/labwc/autostart /home/coastal/.config/labwc/
chmod +x /home/coastal/.config/labwc/autostart
chown -R coastal:coastal /home/coastal/.config

# Enable core services
systemctl enable coastal-server.service
systemctl enable coastal-daemon.service
systemctl enable coastal-architect.timer
systemctl enable coastal-shell.service
systemctl enable coastal-web.service

# Set autologin for coastal user
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << 'EOF'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin coastal --noclear %I $TERM
EOF

echo "[post-install] Done."
