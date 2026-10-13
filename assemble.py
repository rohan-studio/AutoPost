import os
import sys
import subprocess

def create_short(images_dir, audio_path, output_path):
    """
    Creates a 1080x1920 vertical video from 4 scene images and 1 audio track.
    Applies zoom / smooth slideshow effect and synchronizes with the audio length.
    """
    # 1. Get audio duration
    probe_cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", audio_path
    ]
    duration = float(subprocess.check_output(probe_cmd).strip())
    
    # 4 scenes -> duration divided by 4 per image
    per_image = max(duration / 4.0, 2.0)
    
    # 2. Build input list
    concat_file = "/tmp/inputs.txt"
    with open(concat_file, "w") as f:
        for i in range(1, 5):
            img = os.path.join(images_dir, f"scene_{i}.jpg")
            f.write(f"file '{img}'\n")
            f.write(f"duration {per_image}\n")
        # Repeat last frame to avoid truncation
        f.write(f"file '{os.path.join(images_dir, 'scene_4.jpg')}'\n")

    # 3. Render video using FFmpeg
    render_cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0", "-i", concat_file,
        "-i", audio_path,
        "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
        "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        output_path
    ]
    subprocess.run(render_cmd, check=True)
    print(f"Video created successfully at {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python assemble.py <images_dir> <audio_path> <output_path>")
        sys.exit(1)
    create_short(sys.argv[1], sys.argv[2], sys.argv[3])
