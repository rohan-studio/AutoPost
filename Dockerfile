FROM n8nio/n8n:latest

USER root

# Install FFmpeg, Python3, and Pip on Debian-based n8n base image
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    bash \
    && rm -rf /var/lib/apt/lists/*

# Install Edge-TTS for 100% free, unlimited AI voiceovers
RUN pip3 install --no-cache-dir --break-system-packages edge-tts

COPY assemble.py /home/node/assemble.py
COPY generate_assets.py /home/node/generate_assets.py
RUN chmod +x /home/node/assemble.py /home/node/generate_assets.py

USER node
