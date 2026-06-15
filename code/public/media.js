// MediaHub Thumbnail & Decoder

// make thumbnail from image
export async function makeImg(file) {
    try {
        const bmp = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const ratio = bmp.width / bmp.height;
        if (ratio >= 0.6666 && ratio <= 1.5) {
            if (bmp.width >= bmp.height) { canvas.width = 256; canvas.height = Math.round(256 / ratio); }
            else { canvas.height = 256; canvas.width = Math.round(256 * ratio); }
            ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        } else {
            const size = Math.min(bmp.width, bmp.height);
            canvas.width = 256; canvas.height = 256;
            ctx.drawImage(bmp, 0, 0, size, size, 0, 0, 256, 256);
        }
        bmp.close(); return new Promise(r => canvas.toBlob(r, "image/jpeg", 0.7));
    } catch (e) { return null; }
}

// make thumbnail from video
export function makeVid(file) {
    return new Promise((resolve) => {
        const video = document.createElement("video");
        video.preload = "metadata"; video.muted = true; video.playsInline = true;
        video.src = URL.createObjectURL(file);
        video.onloadeddata = () => video.currentTime = 1;
        video.onseeked = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            const ratio = video.videoWidth / video.videoHeight;
            if (video.videoWidth >= video.videoHeight) { canvas.width = 256; canvas.height = Math.round(256 / ratio); }
            else { canvas.height = 256; canvas.width = Math.round(256 * ratio); }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((b) => { URL.revokeObjectURL(video.src); resolve(b); }, "image/jpeg", 0.7);
        };
        video.onerror = () => { URL.revokeObjectURL(video.src); resolve(null); };
    });
}

// Range Data Provider
export class RangeSrc {
    constructor(url, startByte, totalSize) {
        this.url = url; this.ptr = startByte; this.totalSize = totalSize; this.rdr = null; this.buf = new Uint8Array(0);
    }
    async read(size) {
        if (this.ptr >= this.totalSize) return new Uint8Array(0);
        if (!this.rdr) {
            const res = await fetch(this.url, { headers: { 'Range': `bytes=${this.ptr}-` } });
            this.rdr = res.body.getReader();
        }
        while (this.buf.length < size) {
            const { done, value } = await this.rdr.read();
            if (value) {
                const tmp = new Uint8Array(this.buf.length + value.length);
                tmp.set(this.buf); tmp.set(value, this.buf.length); this.buf = tmp;
            }
            if (done) break;
        }
        if (this.buf.length === 0) return new Uint8Array(0);
        const len = Math.min(size, this.buf.length);
        const chunk = this.buf.slice(0, len); this.buf = this.buf.slice(len);
        this.ptr += len; return chunk;
    }
}

// Network Data Provider
export class NetSrc {
    constructor(buf) { this.buf = buf; this.ptr = 0; }
    async read(size) {
        if (this.ptr >= this.buf.length) return new Uint8Array(0);
        const chunk = this.buf.slice(this.ptr, this.ptr + size);
        this.ptr += chunk.length; return chunk;
    }
}