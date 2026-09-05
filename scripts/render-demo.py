"""Render the captured Starlight CLI walkthrough, not a fabricated application UI.

Usage: python scripts/render-demo.py assets/demo-transcript.json assets/starlight-demo.mp4
Requires Pillow and ffmpeg. These are optional media-authoring tools, not runtime dependencies.
"""
import json
import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, FPS = 1600, 900, 20
BG, PANEL, TEXT, MUTED, ACCENT = '#0b111b', '#111d2c', '#e7edf6', '#9cafc9', '#6fe6bf'


def font(size, bold=False):
    candidates = [
        Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / ('consolab.ttf' if bold else 'consola.ttf'),
        Path('/usr/share/fonts/truetype/dejavu/DejaVuSansMono' + ('-Bold' if bold else '') + '.ttf'),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default(size=size)


def frame(scene, elapsed, total, index, count):
    canvas = Image.new('RGB', (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(canvas)
    draw.text((64, 36), 'STARLIGHT', font=font(29, True), fill=ACCENT)
    draw.text((1260, 42), 'AGENT PLATFORM', font=font(18), fill=MUTED)
    draw.text((64, 105), scene['title'], font=font(38, True), fill=TEXT)
    draw.text((64, 164), scene['caption'], font=font(22), fill=MUTED)
    draw.rounded_rectangle((64, 220, 1536, 790), radius=18, fill=PANEL, outline='#26364e', width=2)
    draw.text((92, 240), 'ACTUAL CLI RESULTS / formatted for readability', font=font(17), fill=MUTED)
    command_lines = textwrap.wrap('$ ' + scene['command'], width=100)
    y = 281
    for line in command_lines:
        draw.text((92, y), line, font=font(23, True), fill=ACCENT)
        y += 29
    y += 16
    lines = []
    for line in scene['lines']:
        lines.extend(textwrap.wrap(line, width=104, replace_whitespace=False, drop_whitespace=False) or [''])
    size = 24 if len(lines) <= 14 else 21
    line_height = 29 if len(lines) <= 14 else 25
    visible = min(len(lines), max(0, int((elapsed - 0.5) * 10)))
    for line in lines[:visible]:
        draw.text((92, y), line, font=font(size), fill=TEXT)
        y += line_height
    draw.text((64, 820), 'Goals -> agents -> verified outcomes', font=font(22), fill=TEXT)
    draw.text((64, 858), 'Recorded outputs; playback paced for reading. No synthetic results.', font=font(17), fill=MUTED)
    draw.text((1440, 826), f'{index + 1}/{count}', font=font(22), fill=ACCENT)
    progress = min(1, elapsed / total)
    draw.rectangle((64, 802, 64 + int(1472 * progress), 806), fill=ACCENT)
    return canvas


def main():
    source, target = map(Path, sys.argv[1:3])
    transcript = json.loads(source.read_text(encoding='utf8'))
    assert all(transcript['assertions'].values()), 'Cannot render unverified results'
    executable = shutil.which('ffmpeg')
    if not executable:
        raise RuntimeError('ffmpeg is required')
    target.parent.mkdir(parents=True, exist_ok=True)
    command = [executable, '-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo',
               '-pixel_format', 'rgb24', '-video_size', f'{WIDTH}x{HEIGHT}', '-framerate', str(FPS),
               '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '21',
               '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(target)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for index, scene in enumerate(transcript['scenes']):
            for tick in range(scene['seconds'] * FPS):
                picture = frame(scene, tick / FPS, scene['seconds'], index, len(transcript['scenes']))
                process.stdin.write(picture.tobytes())
            if index in (0, 3, 5):
                picture.save(target.with_name(f'demo-frame-{index + 1}.png'))
            if index == 3:
                picture.save(target.with_name('demo-poster.png'))
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError('ffmpeg failed')
    print(json.dumps({'video': str(target), 'seconds': sum(s['seconds'] for s in transcript['scenes']),
                      'width': WIDTH, 'height': HEIGHT, 'bytes': target.stat().st_size}))


if __name__ == '__main__':
    main()
