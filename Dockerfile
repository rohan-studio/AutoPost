FROM n8nio/n8n:latest

USER root

# Install FFmpeg and Python3 for video rendering and Edge-TTS voiceovers
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    bash

# Install Edge-TTS for 100% free, unlimited, high-quality AI voices
RUN pip install --no-cache-dir --break-system-packages edge-tts

COPY assemble.py /home/node/assemble.py
COPY generate_assets.py /home/node/generate_assets.py
RUN chmod +x /home/node/assemble.py /home/node/generate_assets.py

USER node
