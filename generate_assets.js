const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Bulletproof image downloader with Pollinations (browser headers) and automatic fallback
async function fetchSceneImage(prompt, destPath, index) {
  // Clean prompt to avoid URL encoding issues
  const cleanPrompt = prompt.replace(/[^\w\s,.-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const encoded = encodeURIComponent(cleanPrompt + ", cinematic lighting, hyperrealistic, 8k");

  const pollinationsUrls = [
    `https://image.pollinations.ai/prompt/${encoded}?width=1080&height=1920&nologo=true&model=turbo`,
    `https://image.pollinations.ai/prompt/${encoded}?width=1080&height=1920&nologo=true`
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': 'https://pollinations.ai/',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
  };

  if (process.env.POLLINATIONS_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
  }

  for (const url of pollinationsUrls) {
    try {
      console.error(`Fetching image for scene ${index + 1}...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('image')) {
          const buffer = Buffer.from(await res.arrayBuffer());
          if (buffer.length > 5000) {
            fs.writeFileSync(destPath, buffer);
            console.error(`Successfully generated scene ${index + 1} (${buffer.length} bytes)`);
            return;
          }
        }
      }
    } catch (err) {
      console.error(`Pollinations attempt failed: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // Graceful fallback: guaranteed 1080x1920 image so pipeline never crashes
  console.error(`Using aesthetic vertical visual for scene ${index + 1}...`);
  try {
    const fallbackRes = await fetch(`https://picsum.photos/1080/1920?random=${Date.now() + index}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const buffer = Buffer.from(await fallbackRes.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    console.error(`Saved visual for scene ${index + 1}`);
  } catch (fallbackErr) {
    console.error(`Fallback failed: ${fallbackErr.message}`);
  }
}

async function main() {
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

  // 1. Generate Voiceover using Edge-TTS (100% Free, Unlimited)
  console.error("Generating natural voiceover with Edge-TTS...");
  const tts = new MsEdgeTTS();
  await tts.setMetadata("en-US-ChristopherNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioFilePath } = await tts.toFile(tmpDir, scriptText);
  if (audioFilePath && audioFilePath !== audioPath) {
    fs.copyFileSync(audioFilePath, audioPath);
  }

  // 2. Generate Scene Visuals (Pollinations AI + Fallback)
  console.error("Generating 4 scene visuals...");
  for (let i = 0; i < Math.min(scenes.length, 4); i++) {
    const dest = path.join(tmpDir, `scene_${i + 1}.jpg`);
    await fetchSceneImage(scenes[i], dest, i);
    // Pause briefly to respect rate limits
    await new Promise(r => setTimeout(r, 1000));
  }

  // 3. Measure audio duration with ffprobe
  console.error("Measuring audio duration...");
  const durationOutput = execSync(`/usr/local/bin/ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${audioPath}`);
  const duration = parseFloat(durationOutput.toString().trim()) || 30.0;
  const perImageDuration = Math.max(duration / 4.0, 2.0);

  // 4. Create FFmpeg concat list
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

  // 5. Render 1080x1920 Short using FFmpeg
  console.error("Rendering final 1080x1920 video with FFmpeg...");
  const ffmpegCmd = `/usr/local/bin/ffmpeg -y -f concat -safe 0 -i ${concatPath} -i ${audioPath} -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -c:v libx264 -preset fast -pix_fmt yuv420p -c:a aac -b:a 192k -shortest ${finalVideoPath}`;
  execSync(ffmpegCmd, { stdio: 'pipe' });

  // 6. Return Clean JSON output for n8n
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
