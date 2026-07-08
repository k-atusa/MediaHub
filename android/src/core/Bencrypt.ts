import { Buffer } from 'buffer';
import crypto from 'react-native-quick-crypto';
import { sha3_256, sha3_512 } from 'js-sha3';
import Argon2 from 'react-native-argon2';

export function random(size: number): Buffer {
	return crypto.randomBytes(size) as unknown as Buffer;
}

export function sha3256(data: Buffer): Buffer {
	return Buffer.from(sha3_256.create().update(data).arrayBuffer());
}

export function hmac3256(key: Buffer, data: Buffer): Buffer {
	return crypto.createHmac('sha3-256', key).update(data).digest() as unknown as Buffer;
}

export function sha3512(data: Buffer): Buffer {
	return Buffer.from(sha3_512.create().update(data).arrayBuffer());
}

export function hmac3512(key: Buffer, data: Buffer): Buffer {
	return crypto.createHmac('sha3-512', key).update(data).digest() as unknown as Buffer;
}

export function genkey(data: Buffer, lbl: string, size: number): Buffer {
	const B = 72; // Block size for SHA3-512 (rate = 576 bits = 72 bytes)
	let k: any = Buffer.from(data);
	const m = Buffer.from(lbl, 'utf-8');

	if (k.length > B) {
		k = sha3512(k);
	}
	if (k.length < B) {
		const newK = Buffer.alloc(B);
		newK.set(k);
		k = newK;
	}

	const o_key_pad = Buffer.alloc(B);
	const i_key_pad = Buffer.alloc(B);
	for (let i = 0; i < B; i++) {
		o_key_pad[i] = k[i] ^ 0x5c;
		i_key_pad[i] = k[i] ^ 0x36;
	}

	const innerData = Buffer.alloc(B + m.length);
	innerData.set(i_key_pad, 0);
	innerData.set(m, B);
	const innerHash = sha3512(innerData);

	const outerData = Buffer.alloc(B + innerHash.length);
	outerData.set(o_key_pad, 0);
	outerData.set(innerHash, B);
	const result = sha3512(outerData);

	if (size > result.length) throw new Error("key size too large");
	return result.subarray(0, size) as unknown as Buffer;
}

export function mkiv(g: Buffer, c: number): Buffer {
	const iv = Buffer.from(g);
	const cb = Buffer.alloc(8);
	// Since JS numbers are doubles, c might be up to 2^53. BigInt safely handles it.
	cb.writeBigUInt64LE(BigInt(c), 0);
	for (let i = 0; i < 8; i++) {
		iv[4 + i] ^= cb[i];
	}
	return iv;
}

export class Masker {
	// Ported as passthrough since python just generates random mask at runtime
	// which effectively only obfuscates in-memory key but cancels out with 2 XORs.
	public XOR(data: Buffer): Buffer {
		return data;
	}
}

export class HashMaster {
	algo: string;
	hashSize: number;
	keySize: number;

	constructor(algo: string, hashSize: number = 32, keySize: number = 32) {
		if (!["sha3", "arg2low", "arg2st"].includes(algo)) {
			throw new Error(`Unsupported algorithm: ${algo}`);
		}
		this.algo = algo;
		this.hashSize = hashSize;
		this.keySize = keySize;
	}

	async KDF(pw: Buffer, salt: Buffer): Promise<[Buffer, Buffer]> {
		let lblStore = "", lblKeygen = "", master: Buffer | null = null;
		if (this.algo === "sha3") {
			lblStore = "PWHASH_SHA3";
			lblKeygen = "KEYGEN_SHA3";
			master = sha3512(Buffer.concat([salt, pw]));
		} else if (this.algo === "arg2st") {
			lblStore = "PWHASH_ARG2ST";
			lblKeygen = "KEYGEN_ARG2ST";
			// In python: time_cost=3, memory_cost=262144, parallelism=6, hash_len=64, type=ID
			// For react-native-argon2: Argon2(password, salt, { iterations: 3, memory: 262144, parallelism: 6, hashLength: 64, mode: 'argon2id' })
			// Note: the output format might be a string (encoded) or raw. react-native-argon2 returns an object { rawHash: string, ... } where rawHash is hex.
			try {
				const res = await Argon2(pw.toString('utf-8'), salt.toString('hex'), {
					iterations: 3,
					memory: 262144,
					parallelism: 6,
					hashLength: 64,
					mode: 'argon2id',
					saltEncoding: 'hex'
				});
				master = Buffer.from(res.rawHash, 'hex');
			} catch (e) {
				console.error("Argon2 error", e);
				throw e;
			}
		} else {
			throw new Error(`Not implemented for RN: ${this.algo}`);
		}

		const pwStore = genkey(master, lblStore, this.hashSize);
		const keyGen = genkey(master, lblKeygen, this.keySize);
		return [pwStore, keyGen];
	}
}

export class AES1 {
	enAESGCM(key: Buffer, data: Buffer): Buffer {
		if (key.length !== 32) throw new Error("key size must be 32 bytes");
		const iv = random(12);
		const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
		const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
		const tag = cipher.getAuthTag();
		return Buffer.concat([iv, ciphertext, tag]);
	}

	deAESGCM(key: Buffer, data: Buffer): Buffer {
		if (key.length !== 32) throw new Error("key size must be 32 bytes");
		if (data.length < 28) throw new Error("cipher too short");
		const iv = data.subarray(0, 12) as unknown as Buffer;
		const ciphertext = data.subarray(12, data.length - 16) as unknown as Buffer;
		const tag = data.subarray(data.length - 16) as unknown as Buffer;
		const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
		decipher.setAuthTag(tag as any);
		const plaintext = Buffer.concat([decipher.update(ciphertext) as any, decipher.final() as any]);
		return plaintext as unknown as Buffer;
	}

	// Extended chunked operations (gcmx1) used for file streams
	enAESGCMx(key: Buffer, src: Buffer, chunkSize: number = 1048576): Buffer {
		if (key.length !== 32) throw new Error("key size must be 32 bytes");
		const globalIV = random(12);
		let dst = [globalIV];
		let count = 0;
		let offset = 0;
		const size = src.length;

		while (offset < size) {
			const iv = mkiv(globalIV, count++);
			const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
			let end = Math.min(offset + chunkSize, size);
			const chunk = src.subarray(offset, end) as unknown as Buffer;
			const ciphertext = Buffer.concat([cipher.update(chunk), cipher.final()]);
			const tag = cipher.getAuthTag();
			dst.push(ciphertext as unknown as Buffer, tag as unknown as Buffer);
			offset = end;
		}

		// Handle exactly size == 0 case
		if (size === 0) {
			const iv = mkiv(globalIV, count++);
			const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
			const ciphertext = Buffer.concat([cipher.update(Buffer.alloc(0)), cipher.final()]);
			const tag = cipher.getAuthTag();
			dst.push(ciphertext as unknown as Buffer, tag as unknown as Buffer);
		}
		return Buffer.concat(dst);
	}

	deAESGCMx(key: Buffer, src: Buffer, chunkSize: number = 1048576): Buffer {
		if (key.length !== 32) throw new Error("key size must be 32 bytes");
		if (src.length < 28) throw new Error("cipher too short to decrypt");

		const globalIV = src.subarray(0, 12) as unknown as Buffer;
		let count = 0;
		let offset = 12;
		let dst = [];
		const size = src.length;

		while (offset < size) {
			const iv = mkiv(globalIV, count++);
			const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);

			// chunkSize + 16 (for auth tag)
			const remaining = size - offset;
			const currentChunkSize = Math.min(chunkSize + 16, remaining);

			const ciphertext = src.subarray(offset, offset + currentChunkSize - 16) as unknown as Buffer;
			const tag = src.subarray(offset + currentChunkSize - 16, offset + currentChunkSize) as unknown as Buffer;
			decipher.setAuthTag(tag as any);
			const plaintext = Buffer.concat([decipher.update(ciphertext) as any, decipher.final() as any]);
			dst.push(plaintext as unknown as Buffer);

			offset += currentChunkSize;
		}
		return Buffer.concat(dst);
	}
}

export class SymMaster {
	algo: string;
	key: Buffer;
	worker: AES1;

	constructor(algo: string, key: Buffer) {
		if (!["gcm1", "gcmx1"].includes(algo)) {
			throw new Error(`Unsupported algorithm: ${algo}`);
		}
		this.algo = algo;
		if (key.length !== 32) {
			throw new Error(`SYM keysize must be 32: got ${key.length}`);
		}
		this.key = Buffer.from(key);
		this.worker = new AES1();
	}

	afterSize(size: number): number {
		if (this.algo === "gcm1") return size + 28;
		else if (this.algo === "gcmx1") {
			let c = Math.floor(size / 1048576) + 1;
			if (size !== 0 && size % 1048576 === 0) c -= 1;
			return size + 12 + 16 * c;
		}
		return 0;
	}

	enBin(data: Buffer): Buffer {
		if (this.algo === "gcm1") return this.worker.enAESGCM(this.key, data);
		else return this.worker.enAESGCMx(this.key, data);
	}

	deBin(data: Buffer): Buffer {
		if (this.algo === "gcm1") return this.worker.deAESGCM(this.key, data);
		else return this.worker.deAESGCMx(this.key, data);
	}
}
