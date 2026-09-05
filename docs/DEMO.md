# Verified demo walkthrough

[Watch the video](../assets/starlight-demo.mp4) · [Poster](../assets/demo-poster.png) ·
[Captured transcript](../assets/demo-transcript.json)

This 63-second, 1600×900 H.264 video is a captioned rendering of actual CLI results. Playback is
paced for reading; it is not a graphical-product screen recording or a runtime-duration claim.
It has no audio. Source data, results, and expected failures come from real executions.

| Time | Demonstration |
| --- | --- |
| 00:00 | Three source orders with integer cent amounts |
| 00:10 | Two agents and their capacities |
| 00:19 | Two mission steps and a maximum-row constraint |
| 00:29 | Successful routing, attempts, evidence, and verified total |
| 00:41 | Saved run inspection and actual Markdown artifact |
| 00:51 | A failed constraint stops the writer and creates no output file |

The successful run produces **3 orders / 5500 cents**. The analyst re-reads the source and checks
the sum with integer arithmetic. The writer reads back its file. A second run sets `maxRows: 1`
against three rows and verifies a failed report, exit code 1, one started step, and no output file.

## Reproduce execution

From a checkout with Node.js 22 or newer:

```bash
npm ci
npm run demo
npm run demo:walkthrough
```

The walkthrough asserts its results and prints a readable summary. Each run uses a fresh
directory under `.starlight/demo-video/`. The agents and mission are in
[`examples/data-report/`](../examples/data-report/).

## Recreate the media

The optional renderer requires Python, Pillow, and FFmpeg; none is required by the agent runtime.

```bash
node scripts/demo-walkthrough.js --record=assets/demo-transcript.json
python scripts/render-demo.py assets/demo-transcript.json assets/starlight-demo.mp4
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of json assets/starlight-demo.mp4
ffmpeg -v error -i assets/starlight-demo.mp4 -f null -
```

The renderer writes a poster and three inspection frames. The video is decoded without errors,
and source/success/failure frames are visually inspected for clipping and legibility. Only the
poster, transcript, and video are versioned; inspection frames are local diagnostics.
