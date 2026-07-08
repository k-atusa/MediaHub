import { Buffer } from 'buffer';
import * as Bencrypt from './Bencrypt';
import * as Opsec from './Opsec';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';

export class MediaHubClient {
    url: string;
    user: string;
    pw: string;
    uHash: string | null = null;
    uKey: Buffer | null = null;
    fldMap: Record<string, Buffer> = {};

    constructor(url: string, user: string, pw: string) {
        this.url = url.replace(/\/$/, '');
        this.user = user;
        this.pw = pw;
    }

    usrPid(key: Buffer): string {
        return Buffer.from(Bencrypt.sha3256(key).subarray(0, 16)).toString('hex');
    }

    objPid(key: Buffer): string {
        return Buffer.from(key.subarray(32, 44)).toString('hex');
    }

    async auth() {
        const PEPPER = "_PROJECT_WHY_MEDIAHUB_PEPPER_2026_!@#$";
        const normalizedUser = this.user.normalize('NFC');
        const salt = Bencrypt.sha3256(Buffer.from(normalizedUser + PEPPER, 'utf-8'));
        const pwBuf = Buffer.from(this.pw.normalize('NFC'), 'utf-8'); 
        const hm = new Bencrypt.HashMaster("arg2st");
        const [stKey, uKey] = await hm.KDF(pwBuf, salt);
        this.uHash = this.usrPid(stKey);
        this.uKey = uKey;
    }

    setAuth(uHash: string, uKey: Buffer) {
        this.uHash = uHash;
        this.uKey = uKey;
    }

    async getFlds() {
        if (!this.uHash) throw new Error("Not authenticated");
        const res = await fetch(`${this.url}/api/userdata/${this.uHash}`);
        if (res.status === 200) {
            const ab = await res.arrayBuffer();
            const buf = Buffer.from(ab);
            if (buf.length > 0) {
                const sm = new Bencrypt.SymMaster("gcm1", this.uKey!.subarray(0, 32) as unknown as Buffer);
                const dec = sm.deBin(buf);
                this.fldMap = Opsec.decodeCfg(dec);
            } else {
                this.fldMap = {};
            }
        } else if (res.status === 404) {
            this.fldMap = {};
        } else {
            throw new Error(`Connection Error: code ${res.status}`);
        }
        return this.fldMap;
    }

    async mkFld(name: string) {
        if (this.fldMap[name]) throw new Error("Folder name already exists!");
        const folderKey = Buffer.concat([Bencrypt.random(32), Bencrypt.random(12)]);
        this.fldMap[name] = folderKey;
        
        const sm = new Bencrypt.SymMaster("gcm1", this.uKey!.subarray(0, 32) as unknown as Buffer);
        const enc = sm.enBin(Opsec.encodeCfg(this.fldMap));
        
        const res = await fetch(`${this.url}/api/userdata/${this.uHash}`, {
            method: 'POST',
            body: enc as any
        });
        if (res.status !== 200) {
            throw new Error(`Failed to create folder: code ${res.status}`);
        }
    }

    async getFiles(name: string) {
        if (!this.fldMap[name]) throw new Error("Folder not found");
        const fKey = this.fldMap[name];
        const fPid = this.objPid(fKey);
        
        const res = await fetch(`${this.url}/api/storage/${fPid}/names`);
        let flMap: Record<string, Buffer> = {};
        if (res.status === 200) {
            const ab = await res.arrayBuffer();
            const buf = Buffer.from(ab);
            if (buf.length > 0) {
                const sm = new Bencrypt.SymMaster("gcm1", fKey.subarray(0, 32) as unknown as Buffer);
                flMap = Opsec.decodeCfg(sm.deBin(buf));
            }
        }
        return { fPid, fKey, flMap };
    }

    async imgThumb(uri: string): Promise<Buffer | null> {
        try {
            const manipResult = await ImageManipulator.manipulateAsync(
                uri,
                [{ resize: { width: 256 } }],
                { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
            );
            const b64 = await FileSystem.readAsStringAsync(manipResult.uri, { encoding: FileSystem.EncodingType.Base64 });
            return Buffer.from(b64, 'base64');
        } catch (e) {
            console.error("imgThumb error", e);
            return null;
        }
    }

    async vidThumb(uri: string): Promise<Buffer | null> {
        try {
            const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, {
                time: 1000,
                quality: 0.7,
            });
            const manipResult = await ImageManipulator.manipulateAsync(
                thumbUri,
                [{ resize: { width: 256 } }],
                { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
            );
            const b64 = await FileSystem.readAsStringAsync(manipResult.uri, { encoding: FileSystem.EncodingType.Base64 });
            return Buffer.from(b64, 'base64');
        } catch (e) {
            console.error("vidThumb error", e);
            return null;
        }
    }

    async upFile(fPid: string, fKey: Buffer, flMap: Record<string, Buffer>, path: string, name: string, origSz: number, progCb?: (sent: number, total: number) => void) {
        // Generate file key and derive ID
        const fk = Buffer.concat([Bencrypt.random(32), Bencrypt.random(12)]);
        const fpid = this.objPid(fk);

        const ext = name.split('.').pop()?.toLowerCase() || '';
        let thumb: Buffer | null = null;
        if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) {
            thumb = await this.vidThumb(path);
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            thumb = await this.imgThumb(path);
        }

        if (thumb) {
            const sm = new Bencrypt.SymMaster("gcm1", fk.subarray(0, 32) as unknown as Buffer);
            const enc = sm.enBin(thumb);
            await fetch(`${this.url}/api/media/${fPid}/${fpid}/thumb`, {
                method: 'POST',
                headers: { 'X-User-Hash': this.uHash! },
                body: enc as any
            });
        }

        // Encrypt and upload media
        // Note: For React Native we read entirely to memory. For very large files this will crash!
        const b64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
        const rawData = Buffer.from(b64, 'base64');

        const smx = new Bencrypt.SymMaster("gcmx1", fk.subarray(0, 32) as unknown as Buffer);
        const encData = smx.enBin(rawData);
        
        const padSz = Opsec.padLen(encData.length);
        const padding = Bencrypt.random(padSz);
        
        const totalData = Buffer.concat([encData, padding]);

        if (progCb) progCb(0, totalData.length);

        const res = await fetch(`${this.url}/api/media/${fPid}/${fpid}/dat`, {
            method: 'POST',
            headers: { 
                'Content-Length': totalData.length.toString(),
                'X-User-Hash': this.uHash! 
            },
            body: totalData
        });

        if (res.status !== 200) {
            throw new Error(`Upload failed: code ${res.status}`);
        }
        if (progCb) progCb(totalData.length, totalData.length);

        // Update metadata
        const sizeBuf = Opsec.encodeInt(origSz, 8, false);
        flMap[name] = Buffer.concat([fk, sizeBuf]);
        
        const sm = new Bencrypt.SymMaster("gcm1", fKey.subarray(0, 32) as unknown as Buffer);
        const encMap = sm.enBin(Opsec.encodeCfg(flMap));
        
        const resMap = await fetch(`${this.url}/api/storage/${fPid}/names`, {
            method: 'POST',
            headers: { 'X-User-Hash': this.uHash! },
            body: encMap as any
        });
        
        if (resMap.status !== 200) {
            throw new Error(`Failed to sync metadata: code ${resMap.status}`);
        }
        return true;
    }

    async dnFile(fPid: string, flInfo: Buffer, name: string, outDir: string, progCb?: (sent: number, total: number) => void): Promise<string> {
        const fk = flInfo.subarray(0, 44);
        const origSz = Opsec.decodeInt(flInfo.subarray(44, 52) as unknown as Buffer, false);
        const fpid = this.objPid(fk);
        const smx = new Bencrypt.SymMaster("gcmx1", fk.subarray(0, 32) as unknown as Buffer);
        
        const res = await fetch(`${this.url}/api/media/${fPid}/${fpid}/dat`);
        if (res.status === 200 || res.status === 206) {
            const ab = await res.arrayBuffer();
            const encryptedData = Buffer.from(ab);
            // We just decrypt everything in memory.
            const decrypted = smx.deBin(encryptedData);
            const destPath = `${outDir}/${name}`;
            await FileSystem.writeAsStringAsync(destPath, (decrypted.subarray(0, origSz) as unknown as Buffer).toString('base64'), { encoding: FileSystem.EncodingType.Base64 });
            return destPath;
        } else {
            throw new Error(`Download failed: ${res.status}`);
        }
    }
}
