# STAGE 1: Standalone static FFmpeg binaries (No OS package manager needed)
FROM mwader/static-ffmpeg:6.0 AS ffmpeg-source

# STAGE 2: Official n8n image
FROM n8nio/n8n:latest

USER root

# Copy static FFmpeg & FFprobe directly into /usr/local/bin
COPY --from=ffmpeg-source /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-source /ffprobe /usr/local/bin/ffprobe
RUN chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

# Set up Node.js dependencies for Edge-TTS and video generation
WORKDIR /home/node
COPY package.json package-lock.json* /home/node/
RUN npm install --omit=dev

# Copy video generator script and assets
COPY generate_assets.js /home/node/generate_assets.js
COPY assets/ /home/node/assets/
RUN chown -R node:node /home/node

USER node
