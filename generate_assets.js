const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { EdgeTTS } = require('@andresaya/edge-tts');

// Fast, resilient image downloader with true 9:16 vertical dimensions (720x1280) so images never stretch
async function fetchSceneImage(prompt, destPath, index) {
  const cleanPrompt = prompt.replace(/[^\w\s,.-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  const encoded = encodeURIComponent(cleanPrompt + ", cinematic lighting, 8k, vertical 9:16 portrait");

  // 720x1280 matches true 9:16 vertical and fits within 1024x1024 AI latent budget without stretching
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encoded}?width=720&height=1280&nologo=true&model=turbo`;

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
    console.error(`[Scene ${index + 1}] Requesting AI visual...`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
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

// Select background music suited to the topic
function selectBgmTrack(topic, title) {
  const combined = ((topic || "") + " " + (title || "")).toLowerCase();
  const bgmDirs = [
    path.join(__dirname, 'assets', 'bgm'),
    path.join('/home/node', 'assets', 'bgm'),
    path.join(__dirname, 'bgm')
  ];

  for (const bgmBase of bgmDirs) {
    if (fs.existsSync(bgmBase)) {
      if (combined.includes('secret') || combined.includes('mystery') || combined.includes('dark') || combined.includes('conspiracy') || combined.includes('history') || combined.includes('crime')) {
        const p = path.join(bgmBase, 'mystery.mp3');
        if (fs.existsSync(p)) return p;
      }
      if (combined.includes('space') || combined.includes('universe') || combined.includes('future') || combined.includes('epic') || combined.includes('science')) {
        const p = path.join(bgmBase, 'epic.mp3');
        if (fs.existsSync(p)) return p;
      }
      const p = path.join(bgmBase, 'curiosity.mp3');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

// Build professional FFmpeg command with Ken Burns zoom/pan motion, smooth crossfades, and ducked BGM
function buildDynamicFFmpegCommand(scenes, audioPath, bgmPath, audioDuration, finalVideoPath) {
  const ffmpegBin = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg';
  const N = scenes.length;
  const T = 0.5; // 0.5s smooth crossfade transition

  // If only 1 scene, apply Ken Burns without xfade
  if (N === 1) {
    const frames = Math.ceil(audioDuration * 25);
    let filter = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,zoompan=z='min(zoom+0.0012,1.15)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=25[vout]`;
    let inputs = [`-loop 1 -t ${audioDuration.toFixed(2)} -i "${scenes[0]}"`, `-i "${audioPath}"`];
    let audioMap = `-map 1:a`;

    if (bgmPath && fs.existsSync(bgmPath)) {
      inputs.push(`-stream_loop -1 -i "${bgmPath}"`);
      filter += `; [1:a]volume=1.0[voice]; [2:a]volume=0.15[bgm]; [voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
      audioMap = `-map "[aout]"`;
    }

    return `${ffmpegBin} -y ${inputs.join(" ")} -filter_complex "${filter}" -map "[vout]" ${audioMap} -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 128k -t ${audioDuration.toFixed(2)} "${finalVideoPath}"`;
  }

  // N >= 2 scenes with alternating Ken Burns (zoom-in / zoom-out) and crossfade
  const S = (audioDuration + (N - 1) * T) / N;
  const framesPerScene = Math.ceil(S * 25);

  let inputs = [];
  scenes.forEach(scenePath => {
    inputs.push(`-loop 1 -t ${S.toFixed(2)} -i "${scenePath}"`);
  });

  inputs.push(`-i "${audioPath}"`);
  const voiceIndex = N;

  const hasBgm = bgmPath && fs.existsSync(bgmPath);
  let bgmIndex = -1;
  if (hasBgm) {
    inputs.push(`-stream_loop -1 -i "${bgmPath}"`);
    bgmIndex = N + 1;
  }

  let filters = [];
  for (let i = 0; i < N; i++) {
    const zoomExpr = (i % 2 === 0)
      ? "min(zoom+0.0012,1.15)"
      : "if(lte(zoom,1.0),1.15,max(1.001,zoom-0.0012))";
    filters.push(`[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,zoompan=z='${zoomExpr}':d=${framesPerScene}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=25[v${i}]`);
  }

  let lastV = "v0";
  for (let k = 0; k < N - 1; k++) {
    const nextV = `v${k + 1}`;
    const outV = (k === N - 2) ? "vout" : `xf${k}`;
    const offset = ((k + 1) * S - (k + 1) * T).toFixed(2);
    filters.push(`[${lastV}][${nextV}]xfade=transition=fade:duration=${T}:offset=${offset}[${outV}]`);
    lastV = outV;
  }

  let audioMap = "";
  if (hasBgm) {
    filters.push(`[${voiceIndex}:a]volume=1.0[voice]`);
    filters.push(`[${bgmIndex}:a]volume=0.15[bgm]`);
    filters.push(`[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
    audioMap = `-map "[aout]"`;
  } else {
    audioMap = `-map ${voiceIndex}:a`;
  }

  return `${ffmpegBin} -y ${inputs.join(" ")} -filter_complex "${filters.join("; ")}" -map "[vout]" ${audioMap} -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 128k -t ${audioDuration.toFixed(2)} "${finalVideoPath}"`;
}

// Upload to 100% free temporary file host (tmpfiles.org) - no signup required
async function uploadToTmpFiles(filePath) {
  try {
    console.error("Uploading video to temporary download server (tmpfiles.org)...");
    const form = new FormData();
    const buffer = fs.readFileSync(filePath);
    const blob = new Blob([buffer], { type: 'video/mp4' });
    form.append('file', blob, path.basename(filePath));

    const res = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      body: form
    });
    const data = await res.json();
    if (data && data.data && data.data.url) {
      const viewUrl = data.data.url;
      const downloadUrl = viewUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
      console.error(`Temporary download link ready: ${viewUrl}`);
      return { viewUrl, downloadUrl };
    }
  } catch (err) {
    console.error(`Temporary host upload notice: ${err.message}`);
  }
  return null;
}

// Optional: Upload to Cloudinary if user sets Cloudinary credentials in Render
async function uploadToCloudinary(filePath) {
  let cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  let apiKey = process.env.CLOUDINARY_API_KEY;
  let apiSecret = process.env.CLOUDINARY_API_SECRET;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;

  if (process.env.CLOUDINARY_URL) {
    try {
      const u = new URL(process.env.CLOUDINARY_URL);
      cloudName = cloudName || u.hostname;
      apiKey = apiKey || u.username;
      apiSecret = apiSecret || u.password;
    } catch (_) {}
  }

  if (!cloudName || (!uploadPreset && (!apiKey || !apiSecret))) {
    return null;
  }

  try {
    console.error("Uploading video to Cloudinary...");
    const form = new FormData();
    const buffer = fs.readFileSync(filePath);
    const blob = new Blob([buffer], { type: 'video/mp4' });
    form.append('file', blob, path.basename(filePath));

    if (uploadPreset) {
      form.append('upload_preset', uploadPreset);
    } else {
      const timestamp = Math.floor(Date.now() / 1000);
      const str = `timestamp=${timestamp}${apiSecret}`;
      const signature = crypto.createHash('sha1').update(str).digest('hex');
      form.append('api_key', apiKey);
      form.append('timestamp', timestamp.toString());
      form.append('signature', signature);
    }

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
      method: 'POST',
      body: form
    });
    const data = await res.json();
    if (data.secure_url) {
      console.error(`Uploaded to Cloudinary: ${data.secure_url}`);
      return data.secure_url;
    } else {
      console.error(`Cloudinary notice: ${JSON.stringify(data.error || data)}`);
    }
  } catch (err) {
    console.error(`Cloudinary upload failed: ${err.message}`);
  }
  return null;
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

  // Clean old audio if present to avoid duration discrepancies
  if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

  // 1. Generate Voiceover using Edge-TTS
  console.error("Generating natural voiceover with Edge-TTS...");
  const tts = new EdgeTTS({ voice: "en-US-ChristopherNeural" });
  await tts.synthesize(scriptText);
  await tts.toFile(audioPath);

  // 2. Measure audio duration with ffprobe
  console.error("Measuring voiceover audio duration...");
  const ffprobeBin = fs.existsSync('/usr/local/bin/ffprobe') ? '/usr/local/bin/ffprobe' : 'ffprobe';
  const durationOutput = execSync(`${ffprobeBin} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`);
  const audioDuration = parseFloat(durationOutput.toString().trim()) || 15.0;
  console.error(`Audio duration: ${audioDuration.toFixed(2)}s`);

  // 3. Generate Scene Visuals in Parallel
  console.error(`Generating ${scenes.length} scene visuals in parallel...`);
  const sceneFilePaths = [];
  for (let i = 0; i < scenes.length; i++) {
    sceneFilePaths.push(path.join(tmpDir, `scene_${i + 1}.jpg`));
  }
  await Promise.all(
    scenes.map((prompt, i) => fetchSceneImage(prompt, sceneFilePaths[i], i))
  );

  // Filter to valid downloaded images
  const validScenePaths = sceneFilePaths.filter(p => fs.existsSync(p) && fs.statSync(p).size > 1000);
  if (validScenePaths.length === 0) {
    throw new Error("No valid scene visuals could be downloaded or generated.");
  }

  // 4. Select background music matching topic
  const bgmPath = selectBgmTrack(data.topic || "", title);
  if (bgmPath) {
    console.error(`Selected background music: ${path.basename(bgmPath)}`);
  }

  // 5. Render 1080x1920 Short with Ken Burns motion, smooth crossfades, and ducked BGM
  console.error(`Rendering ${audioDuration.toFixed(1)}s Short with smooth transitions & motion...`);
  const ffmpegCmd = buildDynamicFFmpegCommand(validScenePaths, audioPath, bgmPath, audioDuration, finalVideoPath);
  execSync(ffmpegCmd, { stdio: 'pipe' });
  console.error("Video rendering complete!");

  // Also make available in /home/node/final_short.mp4
  try {
    fs.copyFileSync(finalVideoPath, "/home/node/final_short.mp4");
  } catch (_) {}

  // 6. Temporary & Cloudinary uploads for instant viewing / downloading
  let tmpUrls = null;
  let cloudinaryUrl = null;

  try {
    tmpUrls = await uploadToTmpFiles(finalVideoPath);
  } catch (e) {
    console.error("tmpfiles notice: " + e.message);
  }

  try {
    cloudinaryUrl = await uploadToCloudinary(finalVideoPath);
  } catch (e) {
    console.error("cloudinary notice: " + e.message);
  }

  // 7. Return Clean JSON output for n8n
  console.log(JSON.stringify({
    status: "success",
    video_path: finalVideoPath,
    title,
    description,
    duration: Math.round(audioDuration),
    view_url: tmpUrls ? tmpUrls.viewUrl : null,
    download_url: tmpUrls ? tmpUrls.downloadUrl : null,
    cloudinary_url: cloudinaryUrl || null
  }));
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message, stack: err.stack }));
  process.exit(1);
});
