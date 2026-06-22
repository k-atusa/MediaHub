// MediaHub Login Module
import { NormPW } from './Bencode.js';
import { HashMaster, SHA3256, Masker } from './Bencrypt.js';
const mask = new Masker();

const SERVER_URL = window.location.origin;
const SECRET_PEPPER = "_PROJECT_WHY_MEDIAHUB_PEPPER_2026_!@#$";
const toHex = (buf) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
const getPid = async (key) => { return toHex(SHA3256(key).slice(0, 16)); };

// Derive auth keys from credentials
async function makeKeys() {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    if (!username || !password) { alert("⚠️ Fill in all fields"); return null; }

    const pwBytes = NormPW(password);
    const saltBytes = SHA3256(new TextEncoder().encode(username + SECRET_PEPPER));
    const hm = new HashMaster("arg2st");
    const [storeKey, userKey] = await hm.KDF(pwBytes, saltBytes);
    const masked = mask.XOR(userKey); userKey.fill(0);
    return { userHash: await getPid(storeKey), userKey: masked };
}

// Store session and redirect
function setSess(hash, maskedKey, username) {
    const raw = mask.XOR(maskedKey);
    sessionStorage.clear();
    sessionStorage.setItem("userHash", hash);
    sessionStorage.setItem("userKey", toHex(raw));
    sessionStorage.setItem("username", username);
    raw.fill(0);
    window.location.href = "./folder.html";
}

// Register
document.getElementById("btnRegister").addEventListener("click", async () => {
    const res = await makeKeys(); if (!res) return;
    const username = document.getElementById("username").value.trim();
    try {
        const check = await fetch(`${SERVER_URL}/api/userdata/${res.userHash}`);
        if (check.status !== 404) return alert("❌ Already registered");

        const inviteModal = document.getElementById("inviteModal");
        const inviteCodeInput = document.getElementById("inviteCodeInput");
        inviteCodeInput.value = "";
        inviteModal.showModal();

        document.getElementById("btnConfirmInvite").onclick = async () => {
            const inviteCode = inviteCodeInput.value.trim();
            inviteModal.close();
            try {
                const req = await fetch(`${SERVER_URL}/api/userdata/${res.userHash}`, {
                    method: "POST",
                    headers: { "X-Invite-Code": inviteCode },
                    body: new Uint8Array(0)
                });
                if (!req.ok) {
                    if (req.status === 403) return alert("❌ Invalid Invite Code");
                    return alert("❌ Register failed");
                }
                alert("✅ Registered"); setSess(res.userHash, res.userKey, username);
            } catch (e) { alert("❌ Register failed"); }
        };

        document.getElementById("btnCancelInvite").onclick = () => {
            inviteModal.close();
        };
    } catch (e) { alert("❌ Register failed"); }
});

// Login
document.getElementById("btnLogin").addEventListener("click", async () => {
    const res = await makeKeys(); if (!res) return;
    const username = document.getElementById("username").value.trim();
    try {
        const check = await fetch(`${SERVER_URL}/api/userdata/${res.userHash}`);
        if (check.status === 404) return alert("❌ Invalid credentials");
        setSess(res.userHash, res.userKey, username);
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