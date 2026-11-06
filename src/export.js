// Export a tour as a video or an animated GIF, recorded while someone plays it on DoorLoop.
// The tours page links to a tour with ?export=video or ?export=gif. A card offers Start recording (sharing a tab
// needs a click); then the person plays the tour as usual, and when it ends (Done or ×) the file downloads.
// A video records the whole run; a GIF gets one frame per step. Nothing is clicked for them.
(function () {
  'use strict';
  if (window.TourExport) return;

  const FRAME_SETTLE_MS = 800; // let a step's highlight and box settle before taking its GIF frame
  const GIF_WIDTH = 1000;
  const GIF_DELAY_MS = 2500;

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    (children || []).forEach((c) => node.append(c));
    return node;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Let Chrome pick the H.264 profile and level for the size it records: forcing one meant for small videos
  // (avc1.42E01E, up to about 720x576) made full-window recordings unplayable.
  function videoType() {
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  }

  // kind: 'video' or 'gif'
  function offer(tourId, kind) {
    const tour = window.TourLayer.tours.find((t) => t.id === tourId);
    const card = el('div', { className: 'tour-export-card', role: 'dialog' });
    const style = el('style', {
      textContent: `
      .tour-export-card { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483000; width: min(440px, calc(100vw - 32px));
        background: #0b1f44; color: #fff; border-radius: 12px; padding: 16px 18px; box-shadow: 0 12px 40px rgba(0,0,0,.35); font: 14px/1.5 system-ui, sans-serif; }
      .tour-export-card strong { display: block; font-size: 15px; margin-bottom: 4px; }
      .tour-export-card p { margin: 0 0 12px; opacity: .9; }
      .tour-export-card p.note { color: #d8f34a; font-weight: 600; }
      .tour-export-card p.note:empty { display: none; }
      .tour-export-card .row { display: flex; gap: 8px; justify-content: flex-end; }
      .tour-export-card button { font: inherit; border-radius: 8px; padding: 6px 14px; cursor: pointer; border: 1px solid rgba(255,255,255,.4); background: none; color: inherit; }
      .tour-export-card button.go { background: #d8f34a; color: #0b1f44; border-color: #d8f34a; font-weight: 600; }`,
    });
    document.head.append(style);
    const close = () => {
      card.remove();
      style.remove();
    };
    if (!tour) {
      card.append(el('strong', { textContent: 'Tour not found' }), el('p', { textContent: `There's no tour "${tourId}" here.` }),
        el('div', { className: 'row' }, [el('button', { textContent: 'Close', onclick: close })]));
      return document.body.append(card);
    }
    if (kind === 'video' && !videoType()) {
      card.append(el('strong', { textContent: "Video recording isn't available" }), el('p', { textContent: "This browser can't record video. Try the GIF export." }),
        el('div', { className: 'row' }, [el('button', { textContent: 'Close', onclick: close })]));
      return document.body.append(card);
    }
    const what = kind === 'gif' ? 'the GIF (one frame per step)' : 'the video';
    const note = el('p', { className: 'note' });
    card.append(
      el('strong', { textContent: `Export “${tour.title}” as ${kind === 'gif' ? 'a GIF' : 'a video'}` }),
      el('p', { textContent: `Click Start recording and choose this tab when Chrome asks. Then play the tour as usual; when it ends (Done or ×), ${what} downloads. This card isn't recorded.` }),
      note,
      el('div', { className: 'row' }, [
        el('button', { textContent: 'Cancel', onclick: close }),
        el('button', { className: 'go', textContent: 'Start recording', onclick: () => start(tour, kind, close, note) }),
      ])
    );
    document.body.append(card);
  }

  async function start(tour, kind, close, note) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        // At most 1080p: big enough to read, and keeps files small (a Retina window is close to 3000 px wide).
        video: { displaySurface: 'browser', frameRate: 30, width: { max: 1920 }, height: { max: 1080 } },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      });
    } catch (e) {
      // Cancelled, or the browser refused: say so, and keep the card so they can try again.
      note.textContent = e && e.name === 'NotAllowedError' ? 'Recording needs this tab to be shared. Click Start recording to try again.' : `Recording didn't start (${e && e.message}).`;
      return;
    }
    close();
    const recording = kind === 'gif' ? gifRecorder(stream) : videoRecorder(stream);
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      removeEventListener('tourlayer:step', onStep);
      removeEventListener('tourlayer:end', onEnd);
      const blob = await recording.stop();
      stream.getTracks().forEach((t) => t.stop());
      if (blob) download(blob, `${tour.id}.${recording.ext}`);
    };
    const onStep = (e) => e.detail.tourId === tour.id && recording.step && recording.step(e.detail.index);
    const onEnd = (e) => e.detail.tourId === tour.id && setTimeout(finish, kind === 'video' ? 600 : 0);
    addEventListener('tourlayer:step', onStep);
    addEventListener('tourlayer:end', onEnd);
    stream.getVideoTracks()[0].addEventListener('ended', finish); // "Stop sharing" in Chrome's bar
    window.TourLayer.start(tour.id);
  }

  // The tab's picture changes size while recording (e.g. Chrome shows its "sharing this tab" bar right after the
  // share starts). A recorder fed the tab directly then switches frame size mid-file, which players reject as bad
  // data. So draw the tab onto a canvas of one fixed size (taken once that bar is up) and record the canvas.
  const SETTLE_MS = 700;
  function videoRecorder(stream) {
    const type = videoType();
    const video = el('video', { muted: true, playsInline: true });
    video.srcObject = stream;
    video.play();
    const chunks = [];
    let recorder = null;
    let drawing = 0;
    const started = new Promise((resolve) => setTimeout(() => {
      const even = (n) => Math.max(2, Math.round(n / 2) * 2);
      const canvas = el('canvas', { width: even(video.videoWidth || 1280), height: even(video.videoHeight || 720) });
      const ctx = canvas.getContext('2d');
      const draw = () => {
        const w = video.videoWidth, h = video.videoHeight;
        if (w && h) {
          // Fit the current frame inside the fixed size, centred on white.
          const scale = Math.min(canvas.width / w, canvas.height / h);
          const dw = w * scale, dh = h * scale;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(video, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
        }
        drawing = requestAnimationFrame(draw);
      };
      draw();
      recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type });
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.start(1000);
      resolve();
    }, SETTLE_MS));
    return {
      ext: type.startsWith('video/mp4') ? 'mp4' : 'webm',
      stop: async () => {
        await started;
        return new Promise((resolve) => {
          recorder.onstop = () => {
            cancelAnimationFrame(drawing);
            video.pause();
            resolve(new Blob(chunks, { type: type.split(';')[0] }));
          };
          recorder.stop();
        });
      },
    };
  }

  function gifRecorder(stream) {
    const video = el('video', { muted: true, playsInline: true });
    video.srcObject = stream;
    video.play();
    const frames = [];
    let pending = null;
    let canvas = null; // every frame is drawn at the first frame's size, since the tab can change size meanwhile
    const grab = () => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return;
      if (!canvas) {
        const first = Math.min(1, GIF_WIDTH / w);
        canvas = el('canvas', { width: Math.round(w * first), height: Math.round(h * first) });
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const scale = Math.min(canvas.width / w, canvas.height / h);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, (canvas.width - w * scale) / 2, (canvas.height - h * scale) / 2, w * scale, h * scale);
      frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    return {
      ext: 'gif',
      step() {
        clearTimeout(pending);
        pending = setTimeout(grab, FRAME_SETTLE_MS);
      },
      async stop() {
        clearTimeout(pending);
        video.pause();
        if (!frames.length) return null;
        return new Blob([window.TourGif.encode(frames, { delayMs: GIF_DELAY_MS })], { type: 'image/gif' });
      },
    };
  }

  window.TourExport = { offer };
})();
