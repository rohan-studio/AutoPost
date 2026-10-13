# $0 Automated Faceless YouTube Shorts Generator

This repository contains everything needed to run an automated faceless YouTube Shorts pipeline for **$0 / month** using **n8n**, **Render**, **Neon.tech**, **Google Gemini**, **Edge-TTS**, and **Pollinations.ai**.

---

## Files Included:
- `Dockerfile`: Custom n8n image with FFmpeg, Python3, and Edge-TTS pre-installed.
- `assemble.py`: FFmpeg script to synchronize 4 scenes with the generated voiceover into a 1080x1920 Short.
- `generate_assets.py`: Automation script that generates voiceover via Edge-TTS and downloads Flux/SDXL images from Pollinations.ai.
- `render.yaml`: Blueprint to deploy directly to Render.
- `workflow_youtube_shorts.json`: Complete workflow to import into n8n.

---

## Deployment Steps:
1. Push this folder to a GitHub repository (`git init`, `git add .`, `git commit -m "init"`, `git push`).
2. On Render.com, create a **Web Service** connected to your GitHub repo.
3. Add the Neon.tech database environment variables.
4. Keep the service awake using cron-job.org / UptimeRobot.
5. In n8n, import `workflow_youtube_shorts.json`, paste your Gemini API key, and connect YouTube.
