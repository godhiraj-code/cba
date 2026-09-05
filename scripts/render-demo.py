"""Render asserted executions with architecture motion, synthetic narration and captions.
Usage: python scripts/render-demo.py assets/demo-transcript.json assets/starlight-demo.mp4
Optional authoring dependencies: Pillow and FFmpeg with libflite.
"""
import json, math, os, shutil, subprocess, sys, textwrap, wave
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
W,H,FPS=1920,1080,24
BG,PANEL,TEXT,MUTED,ACCENT='#101b27','#192936','#edf2f1','#acbdc9','#a2e2c5'
NARRATION=[
'Starlight is a general purpose agent platform. You provide the goal and boundaries. Your agents provide the implementation. Follow real executions through routing, verification, failure, cancellation, and a remote agent.',
'We begin with three real orders. Their amounts are twelve hundred, thirty five hundred, and eight hundred cents. The correct total is fifty five hundred cents. This deterministic example needs no model or API key.',
'Two agents register different capabilities. The order analyst handles structured data. The report writer creates documents. Each has capacity for one execution. Their claims let the coordinator select the appropriate agent for each step.',
'The mission describes an outcome and two ordered steps. First summarize the data, then write the verified summary. A shared maximum row constraint applies to both steps. The platform passes earlier results to the next agent.',
'Now execute the mission. The coordinator selects the analyst, which computes the total and independently verifies it. The writer then creates a real Markdown file and reads it back. Both steps complete, with agent identity, attempts, and evidence recorded.',
'Inspection reads the saved report. The output file contains three orders and fifty five hundred cents. A completed status is useful because we can follow it back to a concrete artifact and its evidence.',
'Now change only the row limit to one. The same source contains three rows. The analyst rejects the input. The mission fails, the CLI exits with code one, and the writer never starts. We assert that no output file was created.',
'An agent can also claim success incorrectly. Here it returns nine thousand nine hundred ninety nine as the total. The independent verifier expects fifty five hundred and rejects the claim. The platform retains the evidence and does not start the writer.',
'Next, cancel a running mission. The worker observes its abort signal, and the platform prevents the second step from starting. This is cooperative cancellation. It cannot forcibly stop arbitrary code or undo external effects.',
'The same platform also routes to remote Sentinels. Here a token authenticated agent connects over a real local WebSocket and counts four words. This capture uses one process with a real socket. The repository also includes a separate multi process proof.',
'Restore the valid input and start a fresh run. Both agents complete and verify the artifact again. The run has a new identifier. This demonstrates recovery by correcting the input, not durable resume or an automatic rollback.',
'Start with the included example, inspect the reports, then supply your own agents. Tools, models, and planning belong inside those agents. Starlight coordinates their execution. This alpha uses trusted code and in memory history, with clear outcomes and inspectable evidence.'
]
INSIGHTS=[
('A shared contract','Agents own the implementation.\nThe platform owns coordination.','GOAL → EVIDENCE'),
('3 source records','1200 + 3500 + 800\nInteger arithmetic. Real input.','5500 CENTS'),
('Domain ownership','Analyst → structured data\nWriter → documents\nOne active execution each.','2 AGENTS'),
('A bounded mission','Step 1: summarize\nStep 2: write\nShared constraint: maxRows 1000','2 INTENTS'),
('Verified handoff','Only a verified result moves forward.\nBoth agents attach evidence.','COMPLETED'),
('A concrete artifact','# Order summary\nOrders: 3\nTotal (cents): 5500','FILE VERIFIED'),
('Stop at the boundary','Three rows exceed the limit of one.\nNo writer. No output artifact.','FAILED'),
('Reject false success','Claim: 9999 cents\nExpected: 5500 cents\nVerification returns false.','REJECTED'),
('A deliberate stop','Caller cancels → worker observes abort\nThe next step never starts.','CANCELLED'),
('Same intent contract','Platform → Hub ↔ Sentinel\nToken authentication\nReal local WebSocket','4 WORDS'),
('A fresh execution','Restore the valid constraint.\nCreate a new run and artifact.\nVerify the result again.','COMPLETED'),
('Bring your own agents','Deterministic code, tools, or models.\nExplicit missions. Observable results.','START BUILDING')
]
@lru_cache(maxsize=64)
def font(size,mono=False,bold=False):
    win=('consolab' if bold else 'consola') if mono else ('segoeuib' if bold else 'segoeui')
    linux=('DejaVuSansMono' if mono else 'DejaVuSans')+('-Bold' if bold else '')
    for file in [Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts'/(win+'.ttf'),Path('/usr/share/fonts/truetype/dejavu')/(linux+'.ttf')]:
        if file.exists(): return ImageFont.truetype(str(file),size)
    return ImageFont.load_default(size=size)
def wrapped(d,text,x,y,width,size=26,fill=TEXT,mono=False,bold=False,leading=1.4):
    for paragraph in text.split('\n'):
        line=''
        for word in paragraph.split():
            candidate=(line+' '+word).strip()
            if d.textlength(candidate,font=font(size,mono,bold))>width and line:
                d.text((x,y),line,font=font(size,mono,bold),fill=fill);y+=int(size*leading);line=word
            else: line=candidate
        d.text((x,y),line,font=font(size,mono,bold),fill=fill);y+=int(size*leading)
    return y
def frame(scene,elapsed,index,position,duration):
    im=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(im)
    accent='#f3a98c' if index in (6,7) else '#e8cc83' if index==8 else ACCENT
    for angle in range(0,180,45):
        dx,dy=16*math.cos(math.radians(angle)),16*math.sin(math.radians(angle))
        d.line((87-dx,60-dy,87+dx,60+dy),fill=ACCENT,width=3)
    d.text((115,35),'starlight',font=font(36,bold=True),fill=ACCENT)
    d.text((1450,48),'EXECUTION WALKTHROUGH',font=font(17,bold=True),fill=MUTED)
    title=scene['title'].split(' / ',1)[-1];size=55
    while d.textlength(title,font=font(size,bold=True))>1770:size-=1
    d.text((70,112),title,font=font(size,bold=True),fill=TEXT)
    d.text((73,189),scene['caption'],font=font(25),fill=MUTED)
    for n,label in enumerate(['MISSION','ROUTE TO AGENT','VERIFY OUTCOME','RECORD RESULT']):
        x=70+n*458;current=int(elapsed/2.5)%4==n
        d.rounded_rectangle((x,251,x+395,312),8,fill=PANEL,outline=accent if current else '#3b4b55',width=2)
        d.text((x+23,269),f'0{n+1}  {label}',font=font(18,True,True),fill=accent if current else MUTED)
        if n<3:d.text((x+415,261),'→',font=font(32),fill=accent)
    d.rounded_rectangle((70,353,1210,910),12,fill=PANEL)
    d.text((97,375),'CAPTURED RESULTS / FORMATTED FOR READABILITY',font=font(15,True),fill=MUTED)
    y=wrapped(d,scene['command'],97,414,1080,23,accent,True,True,1.25)+24
    lines=[]
    for line in scene['lines']:lines.extend(textwrap.wrap(line,width=77,replace_whitespace=False,drop_whitespace=False) or [''])
    size=min(25,max(18,int((882-y)/max(len(lines),1)/1.26)))
    for line in lines[:min(len(lines),max(1,int(elapsed*6)))]:
        d.text((99,y),line,font=font(size,True),fill=TEXT);y+=int(size*1.26)
    x=1252;d.text((x,366),'WHY IT MATTERS',font=font(16,bold=True),fill=accent)
    heading,body,metric=INSIGHTS[index]
    y=wrapped(d,heading,x,416,570,39,bold=True)
    wrapped(d,body,x,y+25,560,28,MUTED,leading=1.65)
    d.rounded_rectangle((x,762,1850,884),8,fill='#23392f' if index not in (6,7,8) else '#40302b')
    d.text((x+24,795),metric,font=font(37,bold=True),fill=accent)
    d.rectangle((70,1043,1850,1047),fill='#33434e')
    d.rectangle((70,1043,70+int(1780*position/duration),1047),fill=accent)
    d.text((70,940),f'{index+1:02d} / 12',font=font(22,True),fill=accent)
    wrapped(d,'Real execution records. Explanatory animation and synthetic narration.\nReproduce: npm run demo:walkthrough',235,933,1560,24,MUTED,leading=1.6)
    return im
def timestamp(seconds):
    m=round(seconds*1000)
    return f'{m//3600000:02d}:{m//60000%60:02d}:{m//1000%60:02d}.{m%1000:03d}'
def main():
    source,target=[Path(p).resolve() for p in sys.argv[1:3]]
    data=json.loads(source.read_text(encoding='utf8'))
    assert all(data['assertions'].values()) and len(data['scenes'])==len(NARRATION)
    exe=shutil.which('ffmpeg')
    if not exe:raise RuntimeError('FFmpeg with libflite is required')
    work=source.parent.parent/'.starlight'/'media-render';work.mkdir(parents=True,exist_ok=True)
    captions=['WEBVTT',''];offset=0
    for i,(scene,narration) in enumerate(zip(data['scenes'],NARRATION)):
        (work/f'voice-{i}.txt').write_text(narration,encoding='utf8')
        subprocess.run([exe,'-y','-v','error','-f','lavfi','-i',f'flite=textfile=voice-{i}.txt:voice=slt',f'voice-{i}.wav'],cwd=work,check=True)
        with wave.open(str(work/f'voice-{i}.wav')) as audio:length=audio.getnframes()/audio.getframerate()
        scene['seconds']=max(scene['seconds'],math.ceil(length+2));scene['narration']=narration
        spoken=0
        for sentence in narration.split('. '):
            end=spoken+length*(len(sentence)+2)/(len(narration)+2)
            captions.extend([f'{timestamp(offset+spoken)} --> {timestamp(offset+min(end,length))}','\n'.join(textwrap.wrap(sentence.rstrip('.')+'.',width=88)),'']);spoken=end
        subprocess.run([exe,'-y','-v','error','-i',f'voice-{i}.wav','-af',f'apad,atrim=duration={scene["seconds"]}','-ar','48000','-ac','2',f'padded-{i}.wav'],cwd=work,check=True)
        offset+=scene['seconds']
    (work/'audio-list.txt').write_text('\n'.join(f"file 'padded-{i}.wav'" for i in range(len(NARRATION))),encoding='utf8')
    subprocess.run([exe,'-y','-v','error','-f','concat','-safe','0','-i','audio-list.txt','-c','copy','narration.wav'],cwd=work,check=True)
    target.with_name('demo-captions.vtt').write_text('\n'.join(captions),encoding='utf8')
    data['format']='Animated walkthrough of asserted CLI and SDK executions; synthetic narration'
    data['media']={'seconds':offset,'width':W,'height':H,'fps':FPS,'narration':'synthetic / libflite slt'}
    source.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    command=[exe,'-y','-hide_banner','-loglevel','error','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','-','-i',str(work/'narration.wav'),'-c:a','aac','-b:a','128k','-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart','-shortest',str(target)]
    process=subprocess.Popen(command,stdin=subprocess.PIPE);position=0
    try:
        for i,scene in enumerate(data['scenes']):
            for tick in range(scene['seconds']*FPS):
                picture=frame(scene,tick/FPS,i,position+tick/FPS,offset);process.stdin.write(picture.tobytes())
            picture.save(work/f'chapter-{i+1:02d}.png')
            if i==4:picture.save(target.with_name('demo-poster.png'))
            position+=scene['seconds'];print(f'Rendered chapter {i+1}/12',flush=True)
    finally:process.stdin.close()
    if process.wait()!=0:raise RuntimeError('FFmpeg failed')
    print(json.dumps({'video':str(target),'seconds':offset,'bytes':target.stat().st_size}))
if __name__=='__main__':main()
