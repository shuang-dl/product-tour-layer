// A small animated GIF encoder, written here so the extension needs no outside code.
// TourGif.encode(frames, { delayMs }) -> Uint8Array. frames: ImageData objects, all the same size.
// Each frame gets its own 256-colour palette: the most common colours in it (to 5 bits per channel), which suits
// app screenshots (mostly flat colours) far better than a fixed palette.
(function () {
  'use strict';
  if (window.TourGif) return;

  function palette(data) {
    const counts = new Uint32Array(32768);
    for (let i = 0; i < data.length; i += 4) counts[((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)]++;
    const used = [];
    for (let k = 0; k < 32768; k++) if (counts[k]) used.push(k);
    used.sort((a, b) => counts[b] - counts[a]);
    const top = used.slice(0, 256);
    const rgb = top.map((k) => [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4]);
    // Every 5-bit colour maps to its nearest palette entry (computed once per colour that occurs).
    const nearest = new Int16Array(32768).fill(-1);
    const lookup = (k) => {
      if (nearest[k] >= 0) return nearest[k];
      const r = ((k >> 10) & 31) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4;
      let best = 0, bestD = Infinity;
      for (let p = 0; p < rgb.length; p++) {
        const d = (rgb[p][0] - r) ** 2 + (rgb[p][1] - g) ** 2 + (rgb[p][2] - b) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      }
      return (nearest[k] = best);
    };
    const indices = new Uint8Array(data.length / 4);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      indices[j] = lookup(((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3));
    }
    while (rgb.length < 256) rgb.push([0, 0, 0]);
    return { rgb, indices };
  }

  // GIF's LZW compression, written out in sub-blocks of up to 255 bytes.
  function lzw(indices, out) {
    const min = 8;
    const clear = 1 << min;
    const eoi = clear + 1;
    let size = min + 1;
    let next = eoi + 1;
    let dict = new Map();
    let bits = 0;
    let nbits = 0;
    const block = [];
    const flush = () => {
      out.push(block.length, ...block);
      block.length = 0;
    };
    const emit = (code) => {
      bits |= code << nbits;
      nbits += size;
      while (nbits >= 8) {
        block.push(bits & 255);
        bits >>>= 8;
        nbits -= 8;
        if (block.length === 255) flush();
      }
    };
    out.push(min);
    emit(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = prefix * 256 + k;
      const code = dict.get(key);
      if (code !== undefined) {
        prefix = code;
        continue;
      }
      emit(prefix);
      if (next === 4096) {
        emit(clear);
        dict = new Map();
        size = min + 1;
        next = eoi + 1;
      } else {
        if (next >= 1 << size) size++;
        dict.set(key, next++);
      }
      prefix = k;
    }
    emit(prefix);
    emit(eoi);
    if (nbits > 0) block.push(bits & 255);
    if (block.length) flush();
    out.push(0);
  }

  function encode(frames, { delayMs = 2500 } = {}) {
    const { width, height } = frames[0];
    const out = [];
    const u16 = (v) => out.push(v & 255, (v >> 8) & 255);
    out.push(...[...'GIF89a'].map((c) => c.charCodeAt(0)));
    u16(width);
    u16(height);
    out.push(0, 0, 0); // no global colour table; each frame has its own
    out.push(0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0); // loop forever
    const delay = Math.round(delayMs / 10);
    for (const frame of frames) {
      const { rgb, indices } = palette(frame.data);
      out.push(0x21, 0xf9, 4, 0x04, delay & 255, (delay >> 8) & 255, 0, 0); // frame delay, keep the frame shown
      out.push(0x2c);
      u16(0);
      u16(0);
      u16(width);
      u16(height);
      out.push(0x87); // a 256-colour local palette
      for (const c of rgb) out.push(c[0], c[1], c[2]);
      lzw(indices, out);
    }
    out.push(0x3b);
    return Uint8Array.from(out);
  }

  window.TourGif = { encode };
})();
