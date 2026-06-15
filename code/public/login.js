// MediaHub Login Module
import { NormPW } from './Bencode.js';
import { HashMaster, SHA3256, Masker } from './Bencrypt.js';
const mask = new Masker();

const SERVER_URL = window.location.origin;
const SECRET_PEPPER = "_PROJECT_WHY_MEDIAHUB_PEPPER_2026_!@#$";
const toHex = (buf) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
const getPid = (key) => toHex(SHA3256(key).slice(0, 16));

// Derive auth keys from credentials
async function makeKeys() {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    if (!username || !password) { alert("⚠️ Fill in all fields"); return null; }

    const pwBytes = NormPW(password);
    const saltBytes = new TextEncoder().encode(username + SECRET_PEPPER);
    const hm = new HashMaster("arg2", 32, 44);
    const [storeKey, userKey] = await hm.KDF(pwBytes, saltBytes);
    const masked = mask.XOR(userKey); userKey.fill(0);
    return { userHash: getPid(storeKey), userKey: masked };
}

// Store session and redirect
function setSess(hash, maskedKey) {
    const raw = mask.XOR(maskedKey);
    sessionStorage.clear();
    sessionStorage.setItem("userHash", hash);
    sessionStorage.setItem("userKey", toHex(raw));
    raw.fill(0);
    window.location.href = "./folder.html";
}

// Register
document.getElementById("btnRegister").addEventListener("click", async () => {
    const res = await makeKeys(); if (!res) return;
    try {
        const check = await fetch(`${SERVER_URL}/api/userdata/${res.userHash}`);
        if (check.status !== 404) return alert("❌ Already registered");
        await fetch(`${SERVER_URL}/api/userdata/${res.userHash}`, { method: "POST", body: new Uint8Array(0) });
        alert("✅ Registered"); setSess(res.userHash, res.userKey);
    } catch (e) { alert("❌ Register failed"); }
});

// Login
document.getElementById("btnLogin").addEventListener("click", async () => {
    const res = await makeKeys(); if (!res) return;
    try {
        const check = await fetch(`${SERVER_URL}/api/userdata/${res.userHash}`);
        if (check.status === 404) return alert("❌ Invalid credentials");
        setSess(res.userHash, res.userKey);
    } catch (e) { alert("❌ Login failed"); }
});

// Check and show notice if present
async function checkNotice() {
    try {
        const res = await fetch(`${SERVER_URL}/api/notice`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.notice && data.notice.trim() !== "" && !sessionStorage.getItem("noticeShown")) {
            const modal = document.getElementById("noticeModal");
            const text = document.getElementById("noticeText");
            const btnConfirm = document.getElementById("btnConfirmNotice");

            text.textContent = data.notice;
            modal.showModal();
            sessionStorage.setItem("noticeShown", "true");

            btnConfirm.addEventListener("click", () => {
                modal.close();
            });
        }
    } catch (e) {
        console.error("Failed to load notice:", e);
    }
}
checkNotice();