const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Download with retry and timeout support
async function downloadFile(url, destPath, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
      console.error(`Downloaded: ${destPath}`);
      return;
    } catch (err) {
      console.error(`Attempt ${attempt}/${retries} failed for ${url}: ${err.message}`);
      if (attempt === retries) throw new Error(`Failed to download after ${retries} attempts: ${err.message}`);
      await new Promise(r => setTimeout(r, 3000 * attempt)); // exponential wait
    }
  }
}

async function main() {
  // Read from file written by echo|base64 -d pipeline
  let jsonString = '';
  if (fs.existsSync('/tmp/input.json')) {
    jsonString = fs.readFileSync('/tmp/input.json', 'utf8').trim();
  } else if (process.argv[2]) {
    jsonString = process.argv[2];
    // Try base64 decode
    try {
      const decoded = Buffer.from(jsonString, 'base64').toString('utf-8');
      if (decoded.trim().startsWith('{')) jsonString = decoded;
    } catch (_) {}
  } else {
    // Read from stdin
    jsonString = fs.readFileSync('/dev/stdin', 'utf8').trim();
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

  // 1. Generate Voiceover using Edge-TTS
  console.error("Generating voiceover...");
  const tts = new MsEdgeTTS();
  await tts.setMetadata("en-US-ChristopherNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioFilePath } = await tts.toFile(tmpDir, scriptText);
  if (audioFilePath && audioFilePath !== audioPath) {
    fs.copyFileSync(audioFilePath, audioPath);
  }

  // 2. Download Images from Pollinations.ai (9:16 vertical, with retries)
  console.error("Downloading scene images...");
  for (let i = 0; i < Math.min(scenes.length, 4); i++) {
    const prompt = scenes[i];
    const enhancedPrompt = `${prompt}, 9:16 vertical aspect ratio, dramatic lighting, 8k, hyperrealistic`;
    const encoded = encodeURIComponent(enhancedPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1080&height=1920&nologo=true&seed=${Date.now() + i}`;
    const dest = path.join(tmpDir, `scene_${i + 1}.jpg`);
    await downloadFile(imageUrl, dest);
  }

  // 3. Measure audio duration with ffprobe
  console.error("Measuring audio duration...");
  const durationOutput = execSync(`/usr/local/bin/ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${audioPath}`);
  const duration = parseFloat(durationOutput.toString().trim()) || 30.0;
  const perImageDuration = Math.max(duration / 4.0, 2.0);

  // 4. Create concat list for ffmpeg
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

  // 5. Assemble video using ffmpeg
  console.error("Assembling video...");
  const ffmpegCmd = `/usr/local/bin/ffmpeg -y -f concat -safe 0 -i ${concatPath} -i ${audioPath} -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -c:v libx264 -preset fast -pix_fmt yuv420p -c:a aac -b:a 192k -shortest ${finalVideoPath}`;
  execSync(ffmpegCmd, { stdio: 'pipe' });

  // 6. Return JSON for n8n
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
