// MediaHub Login Module
import { NormPW } from './Bencode.js';
import { HashMaster, SHA3256, Masker } from './Bencrypt.js';
import { SafeSession } from './session.js';
const mask = new Masker();

await SafeSession.init();

const SERVER_URL = window.location.origin;
const SECRET_PEPPER = "_PROJECT_WHY_MEDIAHUB_PEPPER_2026_!@#$";
const toHex = (buf) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
const getPid = async (key) => { return toHex(SHA3256(key).slice(0, 16)); };

// Derive auth keys from credentials
async function makeKeys() {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    if (!username || !password) {
        if (window.showNotice) {
            await window.showNotice("Please fill in all fields.", "Notice", "warning");
        } else {
            alert("Please fill in all fields.");
        }
        return null;
    }

    const pwBytes = NormPW(password);
    const saltBytes = SHA3256(new TextEncoder().encode(username + SECRET_PEPPER));
    const hm = new HashMaster("arg2st");
    const [storeKey, userKey] = await hm.KDF(pwBytes, saltBytes);
    const masked = mask.XOR(userKey); userKey.fill(0);
    return { userHash: await getPid(storeKey), userKey: masked };
}

// Store session and redirect
async function setSess(hash, maskedKey, username) {
    const raw = mask.XOR(maskedKey);
    const redirectUrl = SafeSession.getItem("redirectAfterLogin");
    SafeSession.clear();
    SafeSession.setItem("userHash", hash);
    SafeSession.setItem("userKey", toHex(raw));
    SafeSession.setItem("username", username);
    raw.fill(0);
    if (redirectUrl) {
        await SafeSession.navigate(redirectUrl);
    } else {
        await SafeSession.navigate("./folder.html");
    }
}

// Register
document.getElementById("btnRegister").addEventListener("click", async () => {
    const res = await makeKeys(); if (!res) return;
    const username = document.getElementById("username").value.trim();
    try {
        const check = await fetch(`${SERVER_URL}/api/userdata/${res.userHash}`);
        if (check.status !== 404) {
            if (window.showNotice) {
                await window.showNotice("This account is already registered.", "Already Registered", "warning");
            } else {
                alert("Already registered");
            }
            return;
        }

        const inviteModal = document.getElementById("inviteModal");
        const inviteCodeInput = document.getElementById("inviteCodeInput");
        inviteCodeInput.value = "";
        inviteModal.showModal();
        inviteCodeInput.focus();

        const submitInvite = async () => {
            const inviteCode = inviteCodeInput.value.trim();
            inviteModal.close();
            try {
                const req = await fetch(`${SERVER_URL}/api/userdata/${res.userHash}`, {
                    method: "POST",
                    headers: { "X-Invite-Code": inviteCode },
                    body: new Uint8Array(0)
                });
                if (!req.ok) {
                    if (req.status === 403) {
                        if (window.showNotice) {
                            await window.showNotice("Invalid invite code. Please check and try again.", "Registration Failed", "error");
                        } else {
                            alert("Invalid invite code");
                        }
                        return;
                    }
                    if (window.showNotice) {
                        await window.showNotice("Registration failed. Please try again.", "Registration Failed", "error");
                    } else {
                        alert("Register failed");
                    }
                    return;
                }
                if (window.showNotice) {
                    await window.showNotice("Account registered successfully.", "Success", "check_circle");
                }
                await setSess(res.userHash, res.userKey, username);
            } catch (e) {
                if (window.showNotice) {
                    await window.showNotice("Registration failed: " + (e.message || "Unknown error"), "Registration Failed", "error");
                } else {
                    alert("Register failed");
                }
            }
        };

        document.getElementById("btnConfirmInvite").onclick = submitInvite;

        inviteCodeInput.onkeydown = (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                submitInvite();
            }
        };

        document.getElementById("btnCancelInvite").onclick = () => {
            inviteModal.close();
        };
    } catch (e) {
        if (window.showNotice) {
            await window.showNotice("Registration failed: " + (e.message || "Unknown error"), "Registration Failed", "error");
        } else {
            alert("Register failed");
        }
    }
});

// Handle Enter key for login
document.getElementById("username").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btnLogin").click();
});
document.getElementById("password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btnLogin").click();
});

// Login
document.getElementById("btnLogin").addEventListener("click", async () => {
    const res = await makeKeys(); if (!res) return;
    const username = document.getElementById("username").value.trim();
    try {
        const check = await fetch(`${SERVER_URL}/api/userdata/${res.userHash}`);
        if (check.status === 404) {
            if (window.showNotice) {
                await window.showNotice("Invalid username or password.", "Login Failed", "error");
            } else {
                alert("Invalid credentials");
            }
            return;
        }
        await setSess(res.userHash, res.userKey, username);
    } catch (e) {
        if (window.showNotice) {
            await window.showNotice("Login failed: " + (e.message || "Unknown error"), "Login Failed", "error");
        } else {
            alert("Login failed");
        }
    }
});

// Check and show notice if present
async function checkNotice() {
    try {
        const res = await fetch(`${SERVER_URL}/api/notice`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.notice && data.notice.trim() !== "" && !SafeSession.getItem("noticeShown")) {
            if (window.showNotice) {
                await window.showNotice(data.notice, "Notice", "campaign");
            }
            SafeSession.setItem("noticeShown", "true");
        }
    } catch (e) {
        console.error("Failed to load notice:", e);
    }
}
checkNotice();