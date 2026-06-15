// MediaHub Share Token Engine
import { Opsec } from './Opsec.js';
import { Encode64, Decode64, NormPW } from './Bencode.js';
import { Masker } from './Bencrypt.js';
const mask = new Masker();

// Encrypt folder share token with password
export async function makeToken(name, maskedKey) {
    const pw = prompt("Set share password:");
    if (!pw) return null;

    const rawKey = mask.XOR(maskedKey);
    const op = new Opsec();
    op.Smsg = name;
    op.SmsgInfo = rawKey;
    const head = await op.Encpw("arg2", NormPW(pw));
    rawKey.fill(0);
    return Encode64(head, "#"); // no opsec-write layer
}

// Decrypt folder share token with password
export async function loadToken(token) {
    try {
        const raw = Decode64(token, "#");
        const op = new Opsec();
        op.View(raw);

        const pw = prompt("Enter share password:");
        if (!pw) return null;

        await op.Decpw(NormPW(pw));
        if (!op.Smsg || op.SmsgInfo.length === 0) return null;
        const maskedKey = mask.XOR(op.SmsgInfo);
        op.SmsgInfo.fill(0);
        return { name: op.Smsg, key: maskedKey };
    } catch (e) { return null; }
}