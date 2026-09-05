# Execution walkthrough

[Watch with captions and chapter controls](https://starlight-protocol.github.io/starlight/#demo) ·
[Download MP4](../assets/starlight-demo.mp4) · [Captured reports](../assets/demo-transcript.json) ·
[English captions](../assets/demo-captions.vtt)

The **3:20, 1920×1080, 24 fps** walkthrough uses actual CLI and SDK executions, explanatory
architecture animation, and synthetic narration (libflite's `slt` voice). It is a paced technical
walkthrough, not a graphical product recording or a runtime-duration claim. The website's
report explorer is read-only and displays the six captured reports behind the video.

| Time | Demonstration |
| --- | --- |
| 00:00 | Mission, agent, verification, and report responsibilities |
| 00:16 | Three real source orders: 1200 + 3500 + 800 cents |
| 00:31 | Analyst and writer capabilities and execution capacities |
| 00:48 | Two ordered steps with a shared row constraint |
| 01:04 | Routing, independently checked totals, file write and readback |
| 01:22 | Saved report inspection and actual Markdown contents |
| 01:37 | maxRows=1: failure, exit 1, no writer, no output file |
| 01:53 | Incorrect completion claim rejected by the verifier |
| 02:10 | Cancellation observed by a worker; subsequent step prevented |
| 02:26 | Token-authenticated Sentinel over a real local WebSocket |
| 02:44 | Corrected input, fresh run ID, verified artifact |
| 03:00 | Reproduction commands and alpha boundaries |

## What is asserted

The walkthrough executes the production CLI for successful file output, persisted inspection,
constraint failure, and a fresh successful run. It executes the public SDK for a verification
rejection, cooperative cancellation, and authenticated remote transport. Each outcome is asserted
before a transcript can be rendered. No model output or simulated successful tool call is used.

The remote scene uses a real socket within one process. `npm run proof:e2e` separately verifies
an authenticated multi-process Hub/client/Sentinel exchange and replay with one side effect.
Recovery here means a new run after correcting input; it is not crash recovery, durable resume,
or automatic rollback. The verifier checks domain truth; the platform does not infer it.

Workspace path prefixes in the public JSON are normalized to `<workspace>` / `workspace:`.
Run IDs, results, errors, and evidence structure are preserved. The normalized evidence paths
identify local artifacts and are not web download links.

## Reproduce execution

Requires a checkout with Node.js 22 or newer:

```bash
npm ci
npm run demo
npm run demo:walkthrough
npm run proof:e2e
```

Each capture uses a fresh directory under `.starlight/demo-video/`. Running the walkthrough
without `--record` leaves the published recording unchanged. The agents and mission are in
[`examples/data-report/`](../examples/data-report/).

## Recreate the media

Python, Pillow, and FFmpeg with libflite are optional media-authoring tools, not runtime dependencies.

```bash
node scripts/demo-walkthrough.js --record=assets/demo-transcript.json
python scripts/render-demo.py assets/demo-transcript.json assets/starlight-demo.mp4
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,sample_rate -of json assets/starlight-demo.mp4
ffmpeg -v error -i assets/starlight-demo.mp4 -f null -
```

The renderer generates synthetic audio from the narrative, pads each chapter to accommodate it,
and writes matching chapter durations, WebVTT captions, a poster, and inspection frames.
Update the chapter table above if narration timing changes. Inspection frames and intermediate
audio stay under `.starlight/media-render/`; only final deliverables are versioned.

## Verify the public website

```bash
npm run site:build
node scripts/check-site.js https://starlight-protocol.github.io/starlight/
```

The checker compares the live deployment with the current local build. It requires HTTP 200,
the expected homepage title and commit, and the correct MIME types, lengths, and SHA-256 hashes
for all eight public files. An unpushed checkout or an older deployment should fail this check.
See [the website deployment guide](WEBSITE.md) for the publishing workflow.
