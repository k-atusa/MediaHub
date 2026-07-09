import TcpSocket from 'react-native-tcp-socket';
import { Buffer } from 'buffer';
import { MediaHubClient } from './MediaHubClient';
import * as Bencrypt from './Bencrypt';
import * as Opsec from './Opsec';

export class LocalProxyServer {
	private server: TcpSocket.Server | null = null;
	public port: number = 8080;
	private client: MediaHubClient;
	private chkCache: Map<string, Buffer> = new Map();
	private ivCache: Map<string, Buffer> = new Map();

	constructor(client: MediaHubClient) {
		this.client = client;
	}

	private async getIV(fPid: string, fpid: string): Promise<Buffer | null> {
		const ck = `${fPid}_${fpid}`;
		if (this.ivCache.has(ck)) return this.ivCache.get(ck)!;

		const headers = { 'Range': 'bytes=0-11' };
		try {
			const res = await fetch(`${this.client.url}/api/media/${fPid}/${fpid}/dat`, { headers });
			if (res.status === 200 || res.status === 206) {
				const ab = await res.arrayBuffer();
				if (ab.byteLength === 12) {
					const b = Buffer.from(ab);
					this.ivCache.set(ck, b);
					return b;
				}
			}
		} catch (e) {
			console.error("getIV error", e);
		}
		return null;
	}

	private async getChunk(fPid: string, fpid: string, aesKey: Buffer, origSz: number, idx: number, gIV: Buffer): Promise<Buffer | null> {
		const ck = `${fPid}_${fpid}_${idx}`;
		if (this.chkCache.has(ck)) return this.chkCache.get(ck)!;

		const PL = 1048576;
		const CL = PL + 16;
		const cS = 12 + idx * CL;
		const pLen = Math.min(PL, origSz - idx * PL);
		const cLen = pLen + 16;
		const cE = cS + cLen - 1;

		const headers = { 'Range': `bytes=${cS}-${cE}`, 'Cache-Control': 'no-cache, no-store' };
		try {
			const res = await fetch(`${this.client.url}/api/media/${fPid}/${fpid}/dat`, { headers });
			if (res.status === 200 || res.status === 206) {
				const ab = await res.arrayBuffer();
				if (ab.byteLength === cLen) {
					const buf = Buffer.from(ab);
					const cipher = buf;
					
					// Decrypt
					const worker = new Bencrypt.AES1();
					const [plain] = worker.deAESGCMxChunk(aesKey, cipher, gIV, idx);
					
					this.chkCache.set(ck, plain);
					if (this.chkCache.size > 16) {
						// Evict oldest
						const firstKey = this.chkCache.keys().next().value;
						if (firstKey) this.chkCache.delete(firstKey);
					}
					return plain;
				}
			}
		} catch (e) {
			console.error("getChunk error", e);
		}
		return null;
	}

	public start() {
		if (this.server) return;
		this.server = TcpSocket.createServer((socket) => {
			let headerBuffer = Buffer.alloc(0);
			let headersParsed = false;

			socket.on('data', async (data) => {
				if (headersParsed) return;

				headerBuffer = Buffer.concat([headerBuffer, Buffer.from(data)]);
				const headerStr = headerBuffer.toString('utf8');
				const headerEnd = headerStr.indexOf('\r\n\r\n');

				if (headerEnd !== -1) {
					headersParsed = true;
					const requestStr = headerStr.substring(0, headerEnd);
					const lines = requestStr.split('\r\n');
					const reqLine = lines[0].split(' ');
					const method = reqLine[0];
					const url = reqLine[1];

					if (method !== 'GET') {
						socket.write('HTTP/1.1 405 Method Not Allowed\r\n\r\n');
						socket.destroy();
						return;
					}

					const qMark = url.indexOf('?');
					if (qMark === -1) {
						socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
						socket.destroy();
						return;
					}

					const path = url.substring(0, qMark);
					const query = url.substring(qMark + 1);

					if (path !== '/stream') {
						socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
						socket.destroy();
						return;
					}

					const params = new URLSearchParams(query);
					const fPid = params.get('fPid');
					const fpid = params.get('fpid');
					const flInfoHex = params.get('flInfoHex');
					const ext = params.get('ext') || 'mp4';

					if (!fPid || !fpid || !flInfoHex) {
						socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
						socket.destroy();
						return;
					}

					const flInfo = Buffer.from(flInfoHex, 'hex');
					const aesKey = Buffer.from(new Uint8Array(flInfo.subarray(0, 32)));
					const origSz = Opsec.decodeInt(Buffer.from(new Uint8Array(flInfo.subarray(44, 52))), false);

					let rS = 0;
					let rE = origSz - 1;
					let partial = false;

					for (let i = 1; i < lines.length; i++) {
						const lowerLine = lines[i].toLowerCase();
						if (lowerLine.startsWith('range:')) {
							const rng = lowerLine.substring(6).trim();
							const rm = rng.match(/bytes=(\d+)-(\d*)/);
							if (rm) {
								rS = parseInt(rm[1], 10);
								if (rm[2]) {
									rE = parseInt(rm[2], 10);
								}
								partial = true;
							} else {
								const rm2 = rng.match(/bytes=-(\d+)/);
								if (rm2) {
									rS = Math.max(0, origSz - parseInt(rm2[1], 10));
									partial = true;
								}
							}
							break;
						}
					}

					if (rS > rE || rS >= origSz) {
						socket.write(`HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */${origSz}\r\n\r\n`);
						socket.destroy();
						return;
					}

					const PL = 1048576;
					const fi = Math.floor(rS / PL);
					const li = Math.floor(rE / PL);
					const cLen = rE - rS + 1;

					let mime = "application/octet-stream";
					if (ext === "mp4" || ext === "mov") mime = "video/mp4";
					else if (ext === "webm") mime = "video/webm";
					else if (ext === "mkv") mime = "video/x-matroska";

					let resHeaders = "";
					if (partial) {
						resHeaders += `HTTP/1.1 206 Partial Content\r\n`;
						resHeaders += `Content-Range: bytes ${rS}-${rE}/${origSz}\r\n`;
					} else {
						resHeaders += `HTTP/1.1 200 OK\r\n`;
					}
					
					resHeaders += `Content-Type: ${mime}\r\n`;
					resHeaders += `Content-Length: ${cLen}\r\n`;
					resHeaders += `Accept-Ranges: bytes\r\n`;
					resHeaders += `Cache-Control: no-store\r\n`;
					resHeaders += `Access-Control-Allow-Origin: *\r\n`;
					resHeaders += `Connection: close\r\n\r\n`;

					socket.write(resHeaders);

					try {
						const gIV = await this.getIV(fPid, fpid);
						if (!gIV) {
							socket.destroy();
							return;
						}

						for (let ci = fi; ci <= li; ci++) {
							const chunk = await this.getChunk(fPid, fpid, aesKey, origSz, ci, gIV);
							if (!chunk) break;

							const base = ci * PL;
							const a = Math.max(rS, base) - base;
							const b = Math.min(rE, base + chunk.length - 1) - base;

							if (a <= b) {
								const slice = Buffer.from(new Uint8Array(chunk.subarray(a, b + 1)));
								socket.write(slice);
							}
						}
					} catch (e) {
						console.error("Streaming error", e);
					} finally {
						socket.destroy();
					}
				}
			});

			socket.on('error', (err) => {
				// suppress socket reset warnings
			});
		});

		this.server.listen({ port: this.port, host: '127.0.0.1' }, () => {
			console.log(`Local proxy server started on 127.0.0.1:${this.port}`);
		});
	}

	public stop() {
		if (this.server) {
			this.server.close();
			this.server = null;
		}
	}
}
