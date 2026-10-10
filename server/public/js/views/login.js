// MediaHub Login & Registration View Controller (Pure UI)
import { SafeSession } from '../core/session.js';
import { router } from '../core/router.js';
import { ShowNotice, ToHex } from '../core/utils.js';
import { driveService } from '../services/drive.js';
import { adapter } from '../adapter.js';

export class LoginView {
    // Initialize LoginView with root container and state
    constructor() {
        this.container = document.getElementById('view-login');
        this.initialized = false;
    }

    // Bind UI button clicks and keyboard enter events
    Init() {
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

    // Save authenticated user credentials to SafeSession and transition to drive view
    async setSession(userHash, maskedKey, username) {
        const rawUk = driveService.UnmaskKey(maskedKey);
        const redirectUrl = SafeSession.GetItem("redirectAfterLogin");

        SafeSession.Clear();
        SafeSession.SetItem("userHash", userHash);
        SafeSession.SetItem("userKey", ToHex(rawUk));
        SafeSession.SetItem("username", username);
        rawUk.fill(0);

        await SafeSession.Save();
        await driveService.InitSession();

        if (redirectUrl) {
            SafeSession.RemoveItem("redirectAfterLogin");
            await router.Navigate(redirectUrl);
        } else {
            await router.Navigate('/drive');
        }
    }

    // Handle user sign-in action with credential validation and adapter authentication
    async handleLogin() {
        const username = document.getElementById("username")?.value.trim() || "";
        const password = document.getElementById("password")?.value || "";

        if (!username || !password) {
            await ShowNotice("Please fill in all fields.", "Notice", "warning");
            return;
        }

        const btnLogin = document.getElementById("btnLogin");
        const origText = btnLogin ? btnLogin.textContent : "";
        if (btnLogin) {
            btnLogin.disabled = true;
            btnLogin.textContent = "Signing in...";
        }

        try {
            // Derive authentication credentials through backend adapter
            const { userHash, maskedKey } = await adapter.DeriveKeys(username, password);

            // Verify if user account exists
            const exists = await adapter.CheckUserExists(userHash);
            if (!exists) {
                await ShowNotice("Invalid username or password.", "Login Failed", "error");
                return;
            }

            // Persist session and navigate
            await this.setSession(userHash, maskedKey, username);
        } catch (e) {
            await ShowNotice("Login failed: " + (e.message || "Unknown error"), "Login Failed", "error");
        } finally {
            if (btnLogin) {
                btnLogin.disabled = false;
                btnLogin.textContent = origText;
            }
        }
    }

    // Handle new account registration dialog and submission
    async handleRegister() {
        const username = document.getElementById("username")?.value.trim() || "";
        const password = document.getElementById("password")?.value || "";

        if (!username || !password) {
            await ShowNotice("Please fill in all fields.", "Notice", "warning");
            return;
        }

        try {
            // Derive keys through backend adapter
            const { userHash, maskedKey } = await adapter.DeriveKeys(username, password);

            // Check if already registered
            const exists = await adapter.CheckUserExists(userHash);
            if (exists) {
                await ShowNotice("This account is already registered.", "Already Registered", "warning");
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
                    // Register account through backend adapter
                    await adapter.RegisterUser(userHash, inviteCode);
                    await ShowNotice("Account registered successfully.", "Success", "check_circle");
                    await this.setSession(userHash, maskedKey, username);
                } catch (e) {
                    await ShowNotice("Registration failed: " + (e.message || "Unknown error"), "Registration Failed", "error");
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
            await ShowNotice("Registration failed: " + (e.message || "Unknown error"), "Registration Failed", "error");
        }
    }

    // Fetch and display optional system notice modal if not previously acknowledged
    async checkNotice() {
        try {
            const notice = await adapter.FetchNotice();
            if (notice && notice.trim() !== "" && !SafeSession.GetItem("noticeShown")) {
                await ShowNotice(notice, "Notice", "campaign");
                SafeSession.SetItem("noticeShown", "true");
            }
        } catch (e) {
            console.error("Failed to load notice:", e);
        }
    }

    // Mount login view, clear password field, and trigger notice check
    Mount() {
        this.Init();
        const pwdInput = document.getElementById("password");
        if (pwdInput) pwdInput.value = "";
        this.checkNotice();
    }
}

// Global login view singleton instance
export const loginView = new LoginView();
