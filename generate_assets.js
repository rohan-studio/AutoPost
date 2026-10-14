const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { EdgeTTS } = require('@andresaya/edge-tts');

// Fast, resilient image downloader with parallel execution and strict 15s timeout
async function fetchSceneImage(prompt, destPath, index) {
  const cleanPrompt = prompt.replace(/[^\w\s,.-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  const encoded = encodeURIComponent(cleanPrompt + ", cinematic lighting, 8k, vertical 9:16");

  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1080&height=1920&nologo=true&model=turbo`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': 'https://pollinations.ai/',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
  };

  if (process.env.POLLINATIONS_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
  }

  // Fast 15-second attempt for Pollinations AI
  try {
    console.error(`[Scene ${index + 1}] Requesting AI image...`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // Strict 15s timeout
    const res = await fetch(pollinationsUrl, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('image')) {
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > 5000) {
          fs.writeFileSync(destPath, buffer);
          console.error(`[Scene ${index + 1}] Successfully generated AI visual (${buffer.length} bytes)`);
          return;
        }
      }
    }
  } catch (err) {
    console.error(`[Scene ${index + 1}] Fast AI attempt timed out or failed: ${err.message}`);
  }

  // Instant high-res aesthetic vertical image fallback so video NEVER stalls
  console.error(`[Scene ${index + 1}] Using instant vertical fallback visual...`);
  try {
    const fallbackRes = await fetch(`https://picsum.photos/1080/1920?random=${Date.now() + index}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const buffer = Buffer.from(await fallbackRes.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    console.error(`[Scene ${index + 1}] Saved visual (${buffer.length} bytes)`);
  } catch (fallbackErr) {
    console.error(`[Scene ${index + 1}] Fallback error: ${fallbackErr.message}`);
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
    if (Array.isArray(data) && data.length > 0) data = data[0];
    if (data.video && typeof data.video === 'object') data = data.video;
    if (data.short && typeof data.short === 'object') data = data.short;
  } catch (err) {
    console.error(JSON.stringify({ error: "Invalid JSON input", details: err.message }));
    process.exit(1);
  }

  const title = (data.title || data.headline || "Fascinating Fact You Did Not Know #shorts").trim();
  const description = (data.description || data.summary || "Subscribe for more daily facts! #shorts #facts").trim();

  // Robustly extract voiceover script from any common key
  let scriptText = (
    data.script ||
    data.voiceover ||
    data.narration ||
    data.speech ||
    data.text ||
    data.content ||
    data.voiceover_script ||
    ""
  ).toString().trim();

  // If script key was missing or empty, ensure Edge-TTS never fails with "The text is empty"
  if (!scriptText || scriptText.length < 5) {
    console.error("Notice: script key was empty, using title as voiceover...");
    scriptText = `${title}. This is an unbelievable fact that will blow your mind!`;
  }

  // Robustly extract scenes
  let rawScenes = data.scenes || data.visuals || data.prompts || data.scene_prompts || data.images || [];
  if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
    rawScenes = [title, "A dramatic cinematic moment"];
  }
  const scenes = rawScenes.slice(0, 4).map(s => (typeof s === 'string' ? s : (s.prompt || s.description || JSON.stringify(s))));

  const tmpDir = "/tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const audioPath = path.join(tmpDir, "voice.mp3");
  const finalVideoPath = path.join(tmpDir, "final_short.mp4");

  // 1. Generate Voiceover using Edge-TTS
  console.error("Generating natural voiceover with Edge-TTS...");
  const tts = new EdgeTTS({ voice: "en-US-ChristopherNeural" });
  await tts.synthesize(scriptText);
  await tts.toFile(audioPath);

  // 2. Generate Scene Visuals IN PARALLEL (All images download simultaneously in ~3-5 seconds!)
  console.error(`Generating ${scenes.length} scene visuals in parallel...`);
  await Promise.all(
    scenes.map((prompt, i) => fetchSceneImage(prompt, path.join(tmpDir, `scene_${i + 1}.jpg`), i))
  );

  // 3. Measure audio duration with ffprobe
  console.error("Measuring audio duration...");
  const durationOutput = execSync(`/usr/local/bin/ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${audioPath}`);
  const duration = parseFloat(durationOutput.toString().trim()) || 15.0;
  const numScenes = scenes.length;
  const perImageDuration = Math.max(duration / numScenes, 1.5);

  // 4. Create FFmpeg concat list
  const concatPath = path.join(tmpDir, "inputs.txt");
  let concatContent = "";
  for (let i = 1; i <= numScenes; i++) {
    const sceneFile = path.join(tmpDir, `scene_${i}.jpg`);
    if (fs.existsSync(sceneFile)) {
      concatContent += `file '${sceneFile}'\nduration ${perImageDuration}\n`;
    }
  }
  // Repeat last frame to avoid ffmpeg cutting off early
  concatContent += `file '${path.join(tmpDir, `scene_${numScenes}.jpg`)}'\n`;
  fs.writeFileSync(concatPath, concatContent);

  // 5. Render 1080x1920 Short using FFmpeg ULTRAFAST preset
  console.error(`Rendering ${duration.toFixed(1)}s video with FFmpeg (ultrafast)...`);
  const ffmpegCmd = `/usr/local/bin/ffmpeg -y -f concat -safe 0 -i ${concatPath} -i ${audioPath} -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -c:v libx264 -preset ultrafast -tune stillimage -crf 26 -c:a aac -b:a 128k -threads 2 -shortest ${finalVideoPath}`;
  execSync(ffmpegCmd, { stdio: 'pipe' });
  console.error("Video rendering complete!");

  // 6. Return Clean JSON output for n8n
  console.log(JSON.stringify({
    status: "success",
    video_path: finalVideoPath,
    title,
    description,
    duration: Math.round(duration)
  }));
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message, stack: err.stack }));
  process.exit(1);
});
