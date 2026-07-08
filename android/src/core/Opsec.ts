import { Buffer } from 'buffer';

export function padLen(size: number): number {
    if (size <= 0) return 0;

    if (size <= 16384) {
        const remainder = size % 4096;
        if (remainder === 0) return 0;
        return 4096 - remainder;
    }

    // bit length
    let bitLen = 0;
    let temp = size;
    while (temp > 0) {
        bitLen++;
        temp = Math.floor(temp / 2);
    }

    let k = 0;
    if (bitLen <= 24) k = 2;
    else if (bitLen <= 29) k = 3;
    else if (bitLen <= 33) k = 4;
    else k = 5;

    const shift = bitLen - k;
    const mask = (1 << shift) - 1;
    if ((size & mask) === 0) {
        return 0;
    }

    const aftersize = ((size >> shift) + 1) << shift;
    return aftersize - size;
}

export function encodeInt(data: number, size: number, signed: boolean): Buffer {
    const buf = Buffer.alloc(size);
    if (signed) {
        buf.writeIntLE(data, 0, size);
    } else {
        buf.writeUIntLE(data, 0, size);
    }
    return buf;
}

export function decodeInt(data: Buffer, signed: boolean): number {
    if (signed) {
        return data.readIntLE(0, data.length);
    } else {
        return data.readUIntLE(0, data.length);
    }
}

export function encodeCfg(data: Record<string, Buffer>): Buffer {
    let bufs: Buffer[] = [];
    for (const [key, val] of Object.entries(data)) {
        const keyBytes = Buffer.from(key, 'utf-8');
        const keyLen = keyBytes.length;
        const dataLen = val.length;

        if (keyLen > 127) throw new Error(`Key length too long: ${keyLen}`);
        if (dataLen > 65535) throw new Error(`Data size too big: ${dataLen}`);

        if (dataLen > 255) {
            const head = Buffer.alloc(3);
            head.writeUInt8(keyLen + 128, 0);
            head.writeUInt16LE(dataLen, 1);
            bufs.push(head.subarray(0, 1), keyBytes, head.subarray(1, 3), val);
        } else {
            const head = Buffer.alloc(2);
            head.writeUInt8(keyLen, 0);
            head.writeUInt8(dataLen, 1);
            bufs.push(head.subarray(0, 1), keyBytes, head.subarray(1, 2), val);
        }
    }
    return Buffer.concat(bufs);
}

export function decodeCfg(data: Buffer): Record<string, Buffer> {
    const result: Record<string, Buffer> = {};
    let offset = 0;
    while (offset < data.length) {
        let keyLen = data.readUInt8(offset);
        let isLongData = false;
        offset += 1;
        
        if (keyLen > 127) {
            keyLen -= 128;
            isLongData = true;
        }

        const keyBytes = data.subarray(offset, offset + keyLen);
        const key = Buffer.from(keyBytes).toString('utf-8');
        offset += keyLen;

        let dataLen = 0;
        if (isLongData) {
            dataLen = data.readUInt16LE(offset);
            offset += 2;
        } else {
            dataLen = data.readUInt8(offset);
            offset += 1;
        }

        const val = data.subarray(offset, offset + dataLen);
        result[key] = val;
        offset += dataLen;
    }
    return result;
}
