# $0 Automated Faceless YouTube Shorts Generator

This repository contains everything needed to run an automated faceless YouTube Shorts pipeline for **$0 / month** using **n8n**, **Render**, **Neon.tech**, **Google Gemini**, **Edge-TTS**, and **Pollinations.ai**.

---

## Files Included:
- `Dockerfile`: Multi-stage Dockerfile bundling static FFmpeg and `msedge-tts` directly into n8n.
- `package.json`: Node dependencies (`msedge-tts`).
- `generate_assets.js`: Pure Node.js script to generate Edge-TTS voiceovers, download Pollinations.ai images, and assemble vertical 1080x1920 videos with FFmpeg.
- `render.yaml`: Blueprint to deploy directly to Render.
- `workflow_youtube_shorts.json`: Complete workflow to import into n8n.

---

## Deployment Steps:
1. Pushed to GitHub repository.
2. Render builds the Docker image cleanly without relying on Linux package managers.
3. Keep the service awake using cron-job.org / UptimeRobot.
4. In n8n, import `workflow_youtube_shorts.json`, paste your Gemini API key, and connect YouTube.
