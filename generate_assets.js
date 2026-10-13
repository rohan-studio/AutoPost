const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Download with retry and timeout support
async function downloadFile(url, destPath, headers = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000); // 90s timeout
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', ...headers }
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
      console.error(`Downloaded: ${destPath}`);
      return;
    } catch (err) {
      console.error(`Attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 4000 * attempt));
    }
  }
}

// Generate image via Hugging Face Inference API (free tier)
async function generateImage(prompt, destPath, hfToken, retries = 3) {
  const models = [
    'stabilityai/stable-diffusion-xl-base-1.0',
    'black-forest-labs/FLUX.1-schnell',
    'stabilityai/stable-diffusion-2-1'
  ];

  for (const model of models) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.error(`Generating image with ${model}, attempt ${attempt}...`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);

        const res = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: `${prompt}, 9:16 vertical aspect ratio, dramatic lighting, cinematic, 8k`,
            parameters: { width: 1080, height: 1920 }
          })
        });
        clearTimeout(timeout);

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${errText.substring(0, 120)}`);
        }

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('image')) {
          throw new Error(`Expected image, got: ${contentType}`);
        }

        const arrayBuffer = await res.arrayBuffer();
        fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
        console.error(`Image saved: ${destPath}`);
        return;
      } catch (err) {
        console.error(`Model ${model} attempt ${attempt}/${retries} failed: ${err.message}`);
        if (attempt < retries) await new Promise(r => setTimeout(r, 5000 * attempt));
      }
    }
  }
  throw new Error('All image generation models failed after retries');
}

async function main() {
  // Get HF_TOKEN from environment
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    console.error(JSON.stringify({ error: "HF_TOKEN environment variable is not set. Add it in Render dashboard." }));
    process.exit(1);
  }

  // Read JSON payload from /tmp/input.json or argv or stdin
  let jsonString = '';
  if (fs.existsSync('/tmp/input.json')) {
    jsonString = fs.readFileSync('/tmp/input.json', 'utf8').trim();
  } else if (process.argv[2]) {
    jsonString = process.argv[2];
    try {
      const decoded = Buffer.from(jsonString, 'base64').toString('utf-8');
      if (decoded.trim().startsWith('{')) jsonString = decoded;
    } catch (_) {}
  }

  let data;
  try {
    data = JSON.parse(jsonString);
  } catch (err) {
    console.error(JSON.stringify({ error: "Invalid JSON input", details: err.message }));
    process.exit(1);
  }

  const title = data.title || "Fascinating Fact You Did Not Know #shorts";
  const description = data.description || "Subscribe for more daily facts! #shorts #facts";
  const scriptText = data.script || "";
  const scenes = data.scenes || [];

  const tmpDir = "/tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const audioPath = path.join(tmpDir, "voice.mp3");
  const finalVideoPath = path.join(tmpDir, "final_short.mp4");

  // 1. Generate Voiceover using Edge-TTS (100% free, unlimited)
  console.error("Generating voiceover...");
  const tts = new MsEdgeTTS();
  await tts.setMetadata("en-US-ChristopherNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioFilePath } = await tts.toFile(tmpDir, scriptText);
  if (audioFilePath && audioFilePath !== audioPath) {
    fs.copyFileSync(audioFilePath, audioPath);
  }

  // 2. Generate Images via Hugging Face Inference API (free tier, 1000 req/day)
  console.error("Generating scene images...");
  for (let i = 0; i < Math.min(scenes.length, 4); i++) {
    const dest = path.join(tmpDir, `scene_${i + 1}.jpg`);
    await generateImage(scenes[i], dest, hfToken);
  }

  // 3. Measure audio duration with ffprobe
  console.error("Measuring audio duration...");
  const durationOutput = execSync(`/usr/local/bin/ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${audioPath}`);
  const duration = parseFloat(durationOutput.toString().trim()) || 30.0;
  const perImageDuration = Math.max(duration / 4.0, 2.0);

  // 4. Create ffmpeg concat list
  const concatPath = path.join(tmpDir, "inputs.txt");
  let concatContent = "";
  for (let i = 1; i <= 4; i++) {
    const sceneFile = path.join(tmpDir, `scene_${i}.jpg`);
    if (fs.existsSync(sceneFile)) {
      concatContent += `file '${sceneFile}'\nduration ${perImageDuration}\n`;
    }
  }
  concatContent += `file '${path.join(tmpDir, "scene_4.jpg")}'\n`;
  fs.writeFileSync(concatPath, concatContent);

  // 5. Render video with FFmpeg
  console.error("Assembling video...");
  const ffmpegCmd = `/usr/local/bin/ffmpeg -y -f concat -safe 0 -i ${concatPath} -i ${audioPath} -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -c:v libx264 -preset fast -pix_fmt yuv420p -c:a aac -b:a 192k -shortest ${finalVideoPath}`;
  execSync(ffmpegCmd, { stdio: 'pipe' });

  // 6. Output result JSON for n8n
  console.log(JSON.stringify({
    status: "success",
    video_path: finalVideoPath,
    title,
    description
  }));
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message, stack: err.stack }));
  process.exit(1);
});
