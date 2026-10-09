// MediaHub Login & Registration View
import { NormPW } from '../engine/Bencode.js';
import { HashMaster, SHA3256, Masker } from '../engine/Bencrypt.js';
import { SafeSession } from '../core/session.js';
import { router } from '../core/router.js';
import { showNotice, showAlert, toHex, getUserPid } from '../core/utils.js';
import { driveService } from '../services/drive.js';

const mask = new Masker();
const SECRET_PEPPER = "_PROJECT_WHY_MEDIAHUB_PEPPER_2026_!@#$";

export class LoginView {
    constructor() {
        this.container = document.getElementById('view-login');
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;

        const btnLogin = document.getElementById("btnLogin");
        const btnRegister = document.getElementById("btnRegister");
        const usernameInput = document.getElementById("username");
        const passwordInput = document.getElementById("password");

        if (btnLogin) {
            btnLogin.addEventListener("click", () => this.handleLogin());
        }

        if (btnRegister) {
            btnRegister.addEventListener("click", () => this.handleRegister());
        }

        if (usernameInput) {
            usernameInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") btnLogin?.click();
            });
        }

        if (passwordInput) {
            passwordInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") btnLogin?.click();
            });
        }
    }

    async makeKeys() {
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;
        if (!username || !password) {
            await showNotice("Please fill in all fields.", "Notice", "warning");
            return null;
        }

        const pwBytes = NormPW(password);
        const saltBytes = SHA3256(new TextEncoder().encode(username + SECRET_PEPPER));
        const hm = new HashMaster("arg2st");
        const [storeKey, userKey] = await hm.KDF(pwBytes, saltBytes);
        const masked = mask.XOR(userKey);
        userKey.fill(0);
        return { userHash: await getUserPid(storeKey), userKey: masked };
    }

    async setSession(hash, maskedKey, username) {
        const raw = mask.XOR(maskedKey);
        const redirectUrl = SafeSession.getItem("redirectAfterLogin");
        SafeSession.clear();
        SafeSession.setItem("userHash", hash);
        SafeSession.setItem("userKey", toHex(raw));
        SafeSession.setItem("username", username);
        raw.fill(0);

        await SafeSession.save();
        await driveService.initSession();

        if (redirectUrl) {
            SafeSession.removeItem("redirectAfterLogin");
            router.navigate(redirectUrl);
        } else {
            router.navigate('/drive');
        }
    }

    async handleLogin() {
        const res = await this.makeKeys();
        if (!res) return;
        const username = document.getElementById("username").value.trim();
        const btnLogin = document.getElementById("btnLogin");
        const origText = btnLogin ? btnLogin.textContent : "";
        if (btnLogin) {
            btnLogin.disabled = true;
            btnLogin.textContent = "Signing in...";
        }

        try {
            const check = await fetch(`${window.location.origin}/api/userdata/${res.userHash}`);
            if (check.status === 404) {
                await showNotice("Invalid username or password.", "Login Failed", "error");
                return;
            }
            await this.setSession(res.userHash, res.userKey, username);
        } catch (e) {
            await showNotice("Login failed: " + (e.message || "Unknown error"), "Login Failed", "error");
        } finally {
            if (btnLogin) {
                btnLogin.disabled = false;
                btnLogin.textContent = origText;
            }
        }
    }

    async handleRegister() {
        const res = await this.makeKeys();
        if (!res) return;
        const username = document.getElementById("username").value.trim();

        try {
            const check = await fetch(`${window.location.origin}/api/userdata/${res.userHash}`);
            if (check.status !== 404) {
                await showNotice("This account is already registered.", "Already Registered", "warning");
                return;
            }

            const inviteModal = document.getElementById("inviteModal");
            const inviteCodeInput = document.getElementById("inviteCodeInput");
            if (!inviteModal || !inviteCodeInput) return;

            inviteCodeInput.value = "";
            inviteModal.showModal();
            inviteCodeInput.focus();

            const submitInvite = async () => {
                const inviteCode = inviteCodeInput.value.trim();
                inviteModal.close();
                try {
                    const req = await fetch(`${window.location.origin}/api/userdata/${res.userHash}`, {
                        method: "POST",
                        headers: { "X-Invite-Code": inviteCode },
                        body: new Uint8Array(0)
                    });
                    if (!req.ok) {
                        if (req.status === 403) {
                            await showNotice("Invalid invite code. Please check and try again.", "Registration Failed", "error");
                            return;
                        }
                        await showNotice("Registration failed. Please try again.", "Registration Failed", "error");
                        return;
                    }
                    await showNotice("Account registered successfully.", "Success", "check_circle");
                    await this.setSession(res.userHash, res.userKey, username);
                } catch (e) {
                    await showNotice("Registration failed: " + (e.message || "Unknown error"), "Registration Failed", "error");
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
            await showNotice("Registration failed: " + (e.message || "Unknown error"), "Registration Failed", "error");
        }
    }

    async checkNotice() {
        try {
            const res = await fetch(`${window.location.origin}/api/notice`);
            if (!res.ok) return;
            const data = await res.json();
            if (data.notice && data.notice.trim() !== "" && !SafeSession.getItem("noticeShown")) {
                await showNotice(data.notice, "Notice", "campaign");
                SafeSession.setItem("noticeShown", "true");
            }
        } catch (e) {
            console.error("Failed to load notice:", e);
        }
    }

    mount() {
        this.init();
        const pwdInput = document.getElementById("password");
        if (pwdInput) pwdInput.value = "";
        this.checkNotice();
    }
}

export const loginView = new LoginView();
