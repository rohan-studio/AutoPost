import os
import sys
import json
import urllib.parse
import urllib.request
import subprocess

def run_cmd(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed: {cmd}\nError: {result.stderr}")
    return result.stdout

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No JSON payload provided"}))
        sys.exit(1)

    raw_input = sys.argv[1]
    data = json.loads(raw_input)

    title = data.get("title", "Fascinating Fact You Did Not Know #shorts")
    description = data.get("description", "Subscribe for more daily facts! #shorts #facts")
    script_text = data.get("script", "")
    scenes = data.get("scenes", [])

    os.makedirs("/tmp", exist_ok=True)
    audio_path = "/tmp/voice.mp3"
    output_video_path = "/tmp/final_short.mp4"

    # 1. Generate Voiceover using Edge-TTS (100% Free)
    clean_script = script_text.replace('"', '\\"')
    print(f"Generating voiceover with Edge-TTS...")
    tts_cmd = f'edge-tts --text "{clean_script}" --write-media {audio_path} --voice en-US-ChristopherNeural'
    run_cmd(tts_cmd)

    # 2. Download Images from Pollinations.ai (100% Free, Flux/SDXL)
    print("Downloading scene images from Pollinations.ai...")
    for idx, scene_prompt in enumerate(scenes[:4], start=1):
        enhanced_prompt = f"{scene_prompt}, 9:16 vertical aspect ratio, dramatic lighting, 8k, hyperrealistic"
        encoded = urllib.parse.quote(enhanced_prompt)
        url = f"https://image.pollinations.ai/prompt/{encoded}?width=1080&height=1920&nologo=true"
        dest = f"/tmp/scene_{idx}.jpg"
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as resp, open(dest, 'wb') as out_f:
            out_f.write(resp.read())
        print(f"Saved {dest}")

    # 3. Assemble Video with FFmpeg
    print("Assembling video with FFmpeg...")
    assemble_cmd = f"python3 /home/node/assemble.py /tmp {audio_path} {output_video_path}"
    run_cmd(assemble_cmd)

    # Output JSON for n8n
    result = {
        "status": "success",
        "video_path": output_video_path,
        "title": title,
        "description": description
    }
    print(json.dumps(result))

if __name__ == "__main__":
    main()
