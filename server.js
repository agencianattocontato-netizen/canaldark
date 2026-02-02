const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '50mb' }));

app.get('/', (req, res) => {
  res.json({ 
    status: 'FFmpeg Video API Online', 
    version: '1.0.0',
    endpoints: {
      'POST /create-video': 'Create video from images + audio + srt'
    }
  });
});

app.post('/create-video', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { images, audio, srt, title = 'EMERGENCY BROADCAST' } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid "images" array' });
    }
    if (!audio) {
      return res.status(400).json({ error: 'Missing "audio" URL' });
    }
    if (!srt) {
      return res.status(400).json({ error: 'Missing "srt" URL' });
    }

    console.log(`[START] Processing ${images.length} images`);

    const workDir = `/tmp/video_${Date.now()}`;
    fs.mkdirSync(workDir, { recursive: true });

    const downloadFile = (url, dest) => {
      return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(dest);
        
        protocol.get(url, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            file.close();
            fs.unlinkSync(dest);
            downloadFile(response.headers.location, dest).then(resolve).catch(reject);
            return;
          }
          
          if (response.statusCode !== 200) {
            file.close();
            fs.unlinkSync(dest);
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }
          
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', reject);
      });
    };

    console.log('[1/8] Downloading images...');
    for (let i = 0; i < images.length; i++) {
      await downloadFile(images[i], path.join(workDir, `img_${String(i).padStart(3, '0')}.jpg`));
      console.log(`  ${i + 1}/${images.length}`);
    }

    console.log('[2/8] Downloading audio...');
    await downloadFile(audio, path.join(workDir, 'audio.mp3'));

    console.log('[3/8] Downloading subtitles...');
    await downloadFile(srt, path.join(workDir, 'legendas.srt'));

    console.log('[4/8] Creating title screen...');
    const titleSafe = title.replace(/'/g, "'\\''");
    execSync(`ffmpeg -y -f lavfi -i color=c=black:s=1920x1080:d=4 -vf "drawtext=text='⚠️ ${titleSafe} ⚠️':fontsize=80:fontcolor=red:x=(w-text_w)/2:y=(h-text_h)/2:borderw=4:bordercolor=black" -c:v libx264 -preset ultrafast -pix_fmt yuv420p ${workDir}/title.mp4`);

    console.log('[5/8] Creating slideshow...');
    const imageList = images.map((_, i) => `file 'img_${String(i).padStart(3, '0')}.jpg'\nduration 8`).join('\n') + `\nfile 'img_${String(images.length - 1).padStart(3, '0')}.jpg'`;
    fs.writeFileSync(path.join(workDir, 'images.txt'), imageList);
    execSync(`ffmpeg -y -f concat -safe 0 -i ${workDir}/images.txt -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fade=t=in:st=0:d=1" -c:v libx264 -preset medium -pix_fmt yuv420p ${workDir}/slideshow.mp4`);

    console.log('[6/8] Concatenating...');
    fs.writeFileSync(path.join(workDir, 'concat.txt'), `file 'title.mp4'\nfile 'slideshow.mp4'`);
    execSync(`ffmpeg -y -f concat -safe 0 -i ${workDir}/concat.txt -c copy ${workDir}/video_sem_audio.mp4`);

    console.log('[7/8] Adding audio + subtitles...');
    const srtPath = path.join(workDir, 'legendas.srt').replace(/\\/g, '/').replace(/:/g, '\\\\:');
    execSync(`ffmpeg -y -i ${workDir}/video_sem_audio.mp4 -i ${workDir}/audio.mp3 -vf "subtitles='${srtPath}':force_style='FontName=Arial Black,FontSize=28,PrimaryColour=&HFF3333&,OutlineColour=&H000000&,BackColour=&H80000000&,Outline=2,Shadow=2,Alignment=2,MarginV=80'" -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 192k -shortest ${workDir}/video_final.mp4`);

    console.log('[8/8] Encoding to base64...');
    const videoBuffer = fs.readFileSync(`${workDir}/video_final.mp4`);
    const videoBase64 = videoBuffer.toString('base64');
    const videoSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);

    console.log('[CLEANUP] Removing temp files...');
    execSync(`rm -rf ${workDir}`);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[DONE] Video created in ${totalTime}s (${videoSizeMB} MB)`);

    res.json({
      success: true,
      video_base64: videoBase64,
      size_mb: videoSizeMB,
      processing_time_seconds: parseFloat(totalTime),
      images_count: images.length
    });

  } catch (error) {
    console.error('[ERROR]', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎬 FFmpeg Video API running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
});
