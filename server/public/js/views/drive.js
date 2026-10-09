// MediaHub Drive Explorer View Controller
import { driveService } from '../services/drive.js';
import { uploadService } from '../services/upload.js';
import { makeToken, loadToken } from '../core/media.js';
import { SafeSession } from '../core/session.js';
import { router } from '../core/router.js';
import { showNotice, showConfirmModal, formatBytes, toHex, fromHex, getObjPid } from '../core/utils.js';

const RING_CIRCUMFERENCE = 56.548;

function getGoogleFileIcon(filename) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'ts', 'm4v', '3gp', 'flv'].includes(ext)) {
        return { icon: 'movie', color: '#e06d53' };
    }
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif'].includes(ext)) {
        return { icon: 'image', color: '#ea4335' };
    }
    if (['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma'].includes(ext)) {
        return { icon: 'audiotrack', color: '#f29900' };
    }
    if (['pdf'].includes(ext)) {
        return { icon: 'picture_as_pdf', color: '#ea4335' };
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
        return { icon: 'folder_zip', color: '#5f6368' };
    }
    return { icon: 'description', color: '#4285f4' };
}

export class DriveView {
    constructor() {
        this.container = document.getElementById('view-drive');
        this.initialized = false;
        this.page = 1;
        this.limit = 30;
        this.isInfiniteLoading = false;
        this.rootSearchCounter = 0;
        this.activeFolderMoreBtn = null;
        this.activeFileMoreBtn = null;
        this.fileBeingRenamed = null;
        this.folderBeingRenamed = null;

        // Upload widget state
        this.activeUploadFiles = [];
        this.uploadDismissTimer = null;
        this.isWidgetHovered = false;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;

        this.bindHeader();
        this.bindSidebar();
        this.bindWorkspaceActions();
        this.bindContextMenuListeners();
        this.bindModals();
        this.bindUploadAndDragDrop();
        this.bindUploadWidget();
    }

    // 1. Header bindings
    bindHeader() {
        const btnToggleSidebar = document.getElementById("btnToggleSidebar");
        const btnCloseSidebarDrawer = document.getElementById("btnCloseSidebarDrawer");
        const sidebarBackdrop = document.getElementById("sidebarBackdrop");
        const driveSidebar = document.querySelector(".drive-sidebar");

        const toggleSidebar = () => {
            if (window.innerWidth <= 768) {
                if (driveSidebar) {
                    const isOpen = driveSidebar.classList.toggle("mobile-open");
                    if (sidebarBackdrop) {
                        sidebarBackdrop.classList.toggle("active", isOpen);
                    }
                }
            } else {
                const isCollapsed = document.body.classList.toggle("sidebar-collapsed");
                localStorage.setItem("mediahub_sidebar_collapsed", isCollapsed ? "true" : "false");
            }
        };

        const closeMobileSidebar = () => {
            if (driveSidebar) driveSidebar.classList.remove("mobile-open");
            if (sidebarBackdrop) sidebarBackdrop.classList.remove("active");
        };

        if (btnToggleSidebar) btnToggleSidebar.addEventListener("click", toggleSidebar);
        if (btnCloseSidebarDrawer) btnCloseSidebarDrawer.addEventListener("click", closeMobileSidebar);
        if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", closeMobileSidebar);

        if (window.innerWidth > 768 && localStorage.getItem("mediahub_sidebar_collapsed") === "true") {
            document.body.classList.add("sidebar-collapsed");
        }

        // Top Search Input
        const topSearchInput = document.getElementById("topSearchInput");
        const btnSearchClear = document.getElementById("btnSearchClear");
        const btnMobileSearchToggle = document.getElementById("btnMobileSearchToggle");
        const btnMobileSearchClose = document.getElementById("btnMobileSearchClose");
        const driveHeader = document.querySelector(".drive-header");

        if (topSearchInput) {
            let debounce = null;
            const onSearch = () => {
                const val = (topSearchInput.value || "").trim();
                if (btnSearchClear) {
                    btnSearchClear.style.display = val.length > 0 ? "inline-flex" : "none";
                }
                clearTimeout(debounce);
                debounce = setTimeout(() => {
                    if (!driveService.currentFolderName) {
                        this.renderRootFolderGrid();
                    } else {
                        this.page = 1;
                        this.renderFiles(false);
                    }
                }, 100);
            };

            topSearchInput.addEventListener("input", onSearch);
            topSearchInput.addEventListener("compositionend", onSearch);
            topSearchInput.addEventListener("keydown", (e) => {
                if (e.key === "Escape") {
                    topSearchInput.value = "";
                    topSearchInput.blur();
                    if (btnSearchClear) btnSearchClear.style.display = "none";
                    if (driveHeader) driveHeader.classList.remove("mobile-search-active");
                    onSearch();
                }
            });
        }

        if (btnSearchClear) {
            btnSearchClear.addEventListener("click", () => {
                if (topSearchInput) {
                    topSearchInput.value = "";
                    btnSearchClear.style.display = "none";
                    topSearchInput.focus();
                    if (!driveService.currentFolderName) {
                        this.renderRootFolderGrid();
                    } else {
                        this.page = 1;
                        this.renderFiles(false);
                    }
                }
            });
        }

        if (btnMobileSearchToggle) {
            btnMobileSearchToggle.addEventListener("click", (e) => {
                e.stopPropagation();
                if (driveHeader) {
                    driveHeader.classList.add("mobile-search-active");
                    topSearchInput?.focus();
                }
            });
        }

        if (btnMobileSearchClose) {
            btnMobileSearchClose.addEventListener("click", (e) => {
                e.stopPropagation();
                if (driveHeader) driveHeader.classList.remove("mobile-search-active");
                if (topSearchInput) {
                    topSearchInput.value = "";
                    if (btnSearchClear) btnSearchClear.style.display = "none";
                    if (!driveService.currentFolderName) this.renderRootFolderGrid();
                    else { this.page = 1; this.renderFiles(false); }
                }
            });
        }

        // Account Menu Dropdown
        const btnAccountMenu = document.getElementById("btnAccountMenu");
        const accountDropdownMenu = document.getElementById("accountDropdownMenu");
        const accountMenuWrapper = document.getElementById("accountMenuWrapper");
        const accountMenuItemTheme = document.getElementById("accountMenuItemTheme");
        const accountMenuItemPassword = document.getElementById("accountMenuItemPassword");
        const accountMenuItemLogout = document.getElementById("accountMenuItemLogout");

        if (btnAccountMenu && accountDropdownMenu) {
            btnAccountMenu.addEventListener("click", (e) => {
                e.stopPropagation();
                this.closeAllDropdowns();
                const isOpen = accountDropdownMenu.classList.toggle("open");
                btnAccountMenu.setAttribute("aria-expanded", isOpen ? "true" : "false");
            });

            document.addEventListener("click", (e) => {
                if (accountMenuWrapper && !accountMenuWrapper.contains(e.target)) {
                    accountDropdownMenu.classList.remove("open");
                    btnAccountMenu.setAttribute("aria-expanded", "false");
                }
            });
        }

        if (accountMenuItemTheme) {
            accountMenuItemTheme.addEventListener("click", () => {
                const current = localStorage.getItem("theme") || "system";
                const next = current === "system" ? "dark" : current === "dark" ? "light" : "system";
                this.setTheme(next);
            });
        }

        if (accountMenuItemPassword) {
            accountMenuItemPassword.addEventListener("click", () => {
                accountDropdownMenu?.classList.remove("open");
                const pwModal = document.getElementById("pwModal");
                document.getElementById("newPassword").value = "";
                document.getElementById("newPasswordConfirm").value = "";
                if (pwModal) pwModal.showModal();
            });
        }

        if (accountMenuItemLogout) {
            accountMenuItemLogout.addEventListener("click", async () => {
                driveService.clearSession();
                router.navigate('/login');
            });
        }
    }

    setTheme(mode) {
        if (mode === "system") {
            localStorage.setItem("theme", "system");
            document.documentElement.removeAttribute("data-theme");
        } else {
            localStorage.setItem("theme", mode);
            document.documentElement.setAttribute("data-theme", mode);
        }
        this.updateThemeUI();
    }

    updateThemeUI() {
        const mode = localStorage.getItem("theme") || "system";
        const accountMenuThemeLabel = document.getElementById("accountMenuThemeLabel");
        const accountMenuThemeIcon = document.getElementById("accountMenuThemeIcon");
        if (mode === "dark") {
            if (accountMenuThemeIcon) accountMenuThemeIcon.textContent = "dark_mode";
            if (accountMenuThemeLabel) accountMenuThemeLabel.textContent = "Theme: Dark";
        } else if (mode === "light") {
            if (accountMenuThemeIcon) accountMenuThemeIcon.textContent = "light_mode";
            if (accountMenuThemeLabel) accountMenuThemeLabel.textContent = "Theme: Light";
        } else {
            if (accountMenuThemeIcon) accountMenuThemeIcon.textContent = "brightness_auto";
            if (accountMenuThemeLabel) accountMenuThemeLabel.textContent = "Theme: System (Auto)";
        }
    }

    // 2. Sidebar bindings
    bindSidebar() {
        const btnNewDropdown = document.getElementById("btnNewDropdown");
        const newDriveMenu = document.getElementById("newDriveMenu");
        const newActionWrapper = document.getElementById("newActionWrapper");
        const menuItemNewFolder = document.getElementById("menuItemNewFolder");
        const btnImport = document.getElementById("btnImport");

        if (btnNewDropdown && newDriveMenu) {
            btnNewDropdown.addEventListener("click", (e) => {
                e.stopPropagation();
                this.closeAllDropdowns();
                const isOpen = newDriveMenu.classList.toggle("open");
                btnNewDropdown.setAttribute("aria-expanded", isOpen ? "true" : "false");
            });

            document.addEventListener("click", (e) => {
                if (newActionWrapper && !newActionWrapper.contains(e.target)) {
                    newDriveMenu.classList.remove("open");
                    btnNewDropdown.setAttribute("aria-expanded", "false");
                }
            });
        }

        if (menuItemNewFolder) {
            menuItemNewFolder.addEventListener("click", () => {
                newDriveMenu?.classList.remove("open");
                const modal = document.getElementById("newFolderModal");
                const input = document.getElementById("modalFolderNameInput");
                if (input) input.value = "";
                if (modal) modal.showModal();
                input?.focus();
            });
        }

        if (btnImport) {
            btnImport.addEventListener("click", () => {
                newDriveMenu?.classList.remove("open");
                this.handleImportShare();
            });
        }

        // Navigation to Root
        const sidebarMyDriveHeader = document.getElementById("sidebarMyDriveHeader");
        const logoWrap = document.querySelector(".logo-wrap");
        const breadcrumbLink = document.querySelector(".breadcrumb-link");

        const navRoot = () => router.navigate('/drive');
        if (sidebarMyDriveHeader) sidebarMyDriveHeader.addEventListener("click", navRoot);
        if (logoWrap) logoWrap.addEventListener("click", navRoot);
        if (breadcrumbLink) breadcrumbLink.addEventListener("click", navRoot);
    }

    // 3. Workspace top bar actions
    bindWorkspaceActions() {
        // View options
        const btnViewMenu = document.getElementById("btnViewMenu");
        const viewDropdownMenu = document.getElementById("viewDropdownMenu");
        const viewActionWrapper = document.getElementById("viewActionWrapper");

        if (btnViewMenu && viewDropdownMenu) {
            btnViewMenu.addEventListener("click", (e) => {
                e.stopPropagation();
                this.closeAllDropdowns();
                const isOpen = viewDropdownMenu.classList.toggle("open");
                btnViewMenu.setAttribute("aria-expanded", isOpen ? "true" : "false");
            });

            document.addEventListener("click", (e) => {
                if (viewActionWrapper && !viewActionWrapper.contains(e.target)) {
                    viewDropdownMenu.classList.remove("open");
                    btnViewMenu.setAttribute("aria-expanded", "false");
                }
            });
        }

        document.querySelectorAll(".view-menu-item").forEach(item => {
            item.addEventListener("click", () => {
                const mode = item.getAttribute("data-view");
                this.applyViewMode(mode);
                viewDropdownMenu?.classList.remove("open");
                btnViewMenu?.setAttribute("aria-expanded", "false");
            });
        });

        this.applyViewMode(localStorage.getItem("driveViewMode") || "medium");

        // Sort options
        const btnSortMenu = document.getElementById("btnSortMenu");
        const sortDropdownMenu = document.getElementById("sortDropdownMenu");
        const sortActionWrapper = document.getElementById("sortActionWrapper");

        if (btnSortMenu && sortDropdownMenu) {
            btnSortMenu.addEventListener("click", (e) => {
                e.stopPropagation();
                this.closeAllDropdowns();
                const isOpen = sortDropdownMenu.classList.toggle("open");
                btnSortMenu.setAttribute("aria-expanded", isOpen ? "true" : "false");
            });

            document.addEventListener("click", (e) => {
                if (sortActionWrapper && !sortActionWrapper.contains(e.target)) {
                    sortDropdownMenu.classList.remove("open");
                    btnSortMenu.setAttribute("aria-expanded", "false");
                }
            });
        }

        document.querySelectorAll(".sort-menu-item").forEach(item => {
            item.addEventListener("click", () => {
                const mode = item.getAttribute("data-sort");
                this.applySortMode(mode);
                sortDropdownMenu?.classList.remove("open");
                btnSortMenu?.setAttribute("aria-expanded", "false");
            });
        });

        this.updateSortMenuUI(driveService.sortMode);

        // Keyword filter
        const btnKeywordFilter = document.getElementById("btnKeywordFilter");
        const filterDropdownMenu = document.getElementById("filterDropdownMenu");
        const filterActionWrapper = document.getElementById("filterActionWrapper");
        const keywordFilterSearchInput = document.getElementById("keywordFilterSearchInput");
        const btnClearActiveChips = document.getElementById("btnClearActiveChips");
        const btnClearAllKeywords = document.getElementById("btnClearAllKeywords");

        if (btnKeywordFilter && filterDropdownMenu) {
            btnKeywordFilter.addEventListener("click", (e) => {
                e.stopPropagation();
                this.closeAllDropdowns();
                const isOpen = filterDropdownMenu.classList.toggle("open");
                btnKeywordFilter.setAttribute("aria-expanded", isOpen ? "true" : "false");
                if (isOpen) {
                    if (keywordFilterSearchInput) keywordFilterSearchInput.value = "";
                    this.renderKeywordDropdownItems("");
                    setTimeout(() => keywordFilterSearchInput?.focus(), 50);
                }
            });

            document.addEventListener("click", (e) => {
                if (filterActionWrapper && !filterActionWrapper.contains(e.target)) {
                    filterDropdownMenu.classList.remove("open");
                    btnKeywordFilter.setAttribute("aria-expanded", "false");
                }
            });
        }

        if (keywordFilterSearchInput) {
            const onFilterSearch = () => {
                this.renderKeywordDropdownItems(keywordFilterSearchInput.value);
            };
            keywordFilterSearchInput.addEventListener("input", onFilterSearch);
            keywordFilterSearchInput.addEventListener("compositionend", onFilterSearch);
        }

        const clearKeywords = () => {
            driveService.selectKeywords.clear();
            this.page = 1;
            this.renderFiles(false);
            this.updateKeywordFilterUI();
        };

        if (btnClearActiveChips) btnClearActiveChips.addEventListener("click", clearKeywords);
        if (btnClearAllKeywords) btnClearAllKeywords.addEventListener("click", clearKeywords);

        // Current Folder More button
        const btnCurrentFolderMore = document.getElementById("btnCurrentFolderMore");
        if (btnCurrentFolderMore) {
            btnCurrentFolderMore.addEventListener("click", (e) => {
                e.stopPropagation();
                if (driveService.currentFolderName) {
                    this.openFolderContextMenu(e, driveService.currentFolderName, btnCurrentFolderMore);
                }
            });
        }

        // Infinite scroll
        const mediaContainer = document.getElementById("mediaContainer");
        if (mediaContainer) {
            mediaContainer.addEventListener("scroll", () => {
                this.closeFolderContextMenu();
                this.closeFileContextMenu();
                this.handleInfiniteScroll();
            });
        }
    }

    closeAllDropdowns() {
        document.querySelectorAll(".account-dropdown-menu, .new-drive-menu, .view-dropdown-menu, .sort-dropdown-menu, .filter-dropdown-menu").forEach(menu => {
            menu.classList.remove("open");
        });
        document.querySelectorAll("[aria-expanded='true']").forEach(btn => {
            btn.setAttribute("aria-expanded", "false");
        });
    }

    applyViewMode(mode) {
        let cleanMode = mode;
        if (cleanMode === "grid") cleanMode = "medium";
        else if (cleanMode === "list") cleanMode = "details";
        else if (cleanMode === "large-grid") cleanMode = "large";

        localStorage.setItem("driveViewMode", cleanMode);
        const mediaGrid = document.getElementById("mediaGrid");
        const mediaContainer = document.getElementById("mediaContainer");
        const viewModeIcon = document.getElementById("viewModeIcon");

        if (mediaGrid && mediaContainer) {
            mediaGrid.classList.remove("view-extra-large", "view-large", "view-medium", "view-small", "view-details", "list-view", "large-grid");
            mediaContainer.classList.remove("is-list-mode");

            if (cleanMode === "details") {
                mediaGrid.classList.add("view-details", "list-view");
                mediaContainer.classList.add("is-list-mode");
                if (viewModeIcon) viewModeIcon.textContent = "view_list";
            } else if (cleanMode === "extra-large") {
                mediaGrid.classList.add("view-extra-large");
                if (viewModeIcon) viewModeIcon.textContent = "photo_size_select_actual";
            } else if (cleanMode === "large") {
                mediaGrid.classList.add("view-large");
                if (viewModeIcon) viewModeIcon.textContent = "view_module";
            } else if (cleanMode === "small") {
                mediaGrid.classList.add("view-small");
                if (viewModeIcon) viewModeIcon.textContent = "view_compact";
            } else {
                cleanMode = "medium";
                mediaGrid.classList.add("view-medium");
                if (viewModeIcon) viewModeIcon.textContent = "grid_view";
            }
        }

        document.querySelectorAll(".view-menu-item").forEach(item => {
            item.classList.toggle("active", item.getAttribute("data-view") === cleanMode);
        });

        if (cleanMode === "details") {
            this.enhanceCardsForListView();
        }
    }

    applySortMode(mode) {
        driveService.sortMode = mode;
        localStorage.setItem("mediahub_sort", mode);
        this.updateSortMenuUI(mode);
        this.page = 1;
        this.renderFiles(false);
    }

    updateSortMenuUI(mode) {
        const sortModeText = document.getElementById("sortModeText");
        const sortModeIcon = document.getElementById("sortModeIcon");

        document.querySelectorAll(".sort-menu-item").forEach(item => {
            item.classList.toggle("active", item.getAttribute("data-sort") === mode);
        });

        if (sortModeText && sortModeIcon) {
            if (mode === "name-asc") {
                sortModeText.textContent = "Sort: Name (A-Z)";
                sortModeIcon.textContent = "arrow_upward";
            } else if (mode === "name-desc") {
                sortModeText.textContent = "Sort: Name (Z-A)";
                sortModeIcon.textContent = "arrow_downward";
            } else if (mode === "size-asc") {
                sortModeText.textContent = "Sort: Size (Small)";
                sortModeIcon.textContent = "straighten";
            } else if (mode === "size-desc") {
                sortModeText.textContent = "Sort: Size (Large)";
                sortModeIcon.textContent = "inventory_2";
            }
        }
    }

    // 4. Context menus & listeners
    bindContextMenuListeners() {
        const folderActionMenu = document.getElementById("folderActionMenu");
        const fileActionMenu = document.getElementById("fileActionMenu");

        document.getElementById("folderMenuRename")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const target = folderActionMenu?.dataset.targetFolder;
            this.closeFolderContextMenu();
            if (target) this.openRenameFolderModal(target);
        });

        document.getElementById("folderMenuShare")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const target = folderActionMenu?.dataset.targetFolder;
            this.closeFolderContextMenu();
            if (target) this.openShareFolderModal(target);
        });

        document.getElementById("folderMenuTrim")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const target = folderActionMenu?.dataset.targetFolder;
            this.closeFolderContextMenu();
            if (target) this.openTrimFolderModal(target);
        });

        document.getElementById("folderMenuUnlink")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const target = folderActionMenu?.dataset.targetFolder;
            this.closeFolderContextMenu();
            if (target) this.openUnlinkFolderModal(target);
        });

        document.getElementById("folderMenuDelete")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const target = folderActionMenu?.dataset.targetFolder;
            this.closeFolderContextMenu();
            if (target) this.openDeleteFolderModal(target);
        });

        document.getElementById("fileMenuShare")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            const target = fileActionMenu?.dataset.targetFile;
            this.closeFileContextMenu();
            if (target) this.shareFile(target);
        });

        document.getElementById("fileMenuRename")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const target = fileActionMenu?.dataset.targetFile;
            this.closeFileContextMenu();
            if (target) this.openRenameFileModal(target);
        });

        document.getElementById("fileMenuDownload")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            const target = fileActionMenu?.dataset.targetFile;
            this.closeFileContextMenu();
            if (target) this.downloadFile(target);
        });

        document.getElementById("fileMenuDelete")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            const target = fileActionMenu?.dataset.targetFile;
            this.closeFileContextMenu();
            if (target) this.deleteFile(target);
        });

        document.addEventListener("click", (e) => {
            if (folderActionMenu?.classList.contains("open")) {
                if (!folderActionMenu.contains(e.target) && (!this.activeFolderMoreBtn || !this.activeFolderMoreBtn.contains(e.target))) {
                    this.closeFolderContextMenu();
                }
            }
            if (fileActionMenu?.classList.contains("open")) {
                if (!fileActionMenu.contains(e.target) && (!this.activeFileMoreBtn || !this.activeFileMoreBtn.contains(e.target))) {
                    this.closeFileContextMenu();
                }
            }
        });
    }

    closeFolderContextMenu() {
        const folderActionMenu = document.getElementById("folderActionMenu");
        if (folderActionMenu) {
            folderActionMenu.classList.remove("open");
            folderActionMenu.style.display = "none";
        }
        if (this.activeFolderMoreBtn) {
            this.activeFolderMoreBtn.classList.remove("open");
            this.activeFolderMoreBtn = null;
        }
    }

    openFolderContextMenu(e, folderName, btn) {
        const folderActionMenu = document.getElementById("folderActionMenu");
        if (!folderActionMenu) return;
        if (folderActionMenu.classList.contains("open") && this.activeFolderMoreBtn === btn) {
            this.closeFolderContextMenu();
            return;
        }

        this.closeAllDropdowns();
        this.closeFileContextMenu();
        if (this.activeFolderMoreBtn) this.activeFolderMoreBtn.classList.remove("open");

        this.activeFolderMoreBtn = btn;
        btn.classList.add("open");
        folderActionMenu.dataset.targetFolder = folderName;

        folderActionMenu.style.visibility = "hidden";
        folderActionMenu.style.display = "block";

        const btnRect = btn.getBoundingClientRect();
        const menuWidth = folderActionMenu.offsetWidth || 190;
        const menuHeight = folderActionMenu.offsetHeight || 140;

        let left = btnRect.right + 6;
        let top = btnRect.top - 4;

        if (left + menuWidth > window.innerWidth - 10) {
            left = btnRect.left - menuWidth - 6;
            if (left < 10) left = window.innerWidth - menuWidth - 10;
        }
        if (top + menuHeight > window.innerHeight - 10) {
            top = window.innerHeight - menuHeight - 10;
        }
        if (top < 10) top = 10;

        folderActionMenu.style.left = `${left}px`;
        folderActionMenu.style.top = `${top}px`;
        folderActionMenu.style.visibility = "";
        folderActionMenu.classList.add("open");
    }

    closeFileContextMenu() {
        const fileActionMenu = document.getElementById("fileActionMenu");
        if (fileActionMenu) {
            fileActionMenu.classList.remove("open");
            fileActionMenu.style.display = "none";
        }
        if (this.activeFileMoreBtn) {
            this.activeFileMoreBtn.classList.remove("open");
            this.activeFileMoreBtn = null;
        }
    }

    openFileContextMenu(e, fileName, btn) {
        const fileActionMenu = document.getElementById("fileActionMenu");
        if (!fileActionMenu) return;
        if (fileActionMenu.classList.contains("open") && this.activeFileMoreBtn === btn) {
            this.closeFileContextMenu();
            return;
        }

        this.closeAllDropdowns();
        this.closeFolderContextMenu();
        if (this.activeFileMoreBtn) this.activeFileMoreBtn.classList.remove("open");

        this.activeFileMoreBtn = btn;
        btn.classList.add("open");
        fileActionMenu.dataset.targetFile = fileName;

        fileActionMenu.style.visibility = "hidden";
        fileActionMenu.style.display = "block";

        const btnRect = btn.getBoundingClientRect();
        const menuWidth = fileActionMenu.offsetWidth || 190;
        const menuHeight = fileActionMenu.offsetHeight || 140;

        let left = btnRect.right + 6;
        let top = btnRect.top - 4;

        if (left + menuWidth > window.innerWidth - 10) {
            left = btnRect.left - menuWidth - 6;
            if (left < 10) left = window.innerWidth - menuWidth - 10;
        }
        if (top + menuHeight > window.innerHeight - 10) {
            top = window.innerHeight - menuHeight - 10;
        }
        if (top < 10) top = 10;

        fileActionMenu.style.left = `${left}px`;
        fileActionMenu.style.top = `${top}px`;
        fileActionMenu.style.visibility = "";
        fileActionMenu.classList.add("open");
    }

    // 5. Modals & Dialog handling
    bindModals() {
        // New folder modal
        const newFolderModal = document.getElementById("newFolderModal");
        const btnConfirmNewFolder = document.getElementById("btnConfirmNewFolder");
        const btnCancelNewFolder = document.getElementById("btnCancelNewFolder");
        const modalFolderNameInput = document.getElementById("modalFolderNameInput");

        const handleCreateFolder = async () => {
            const name = modalFolderNameInput?.value.trim();
            if (!name) return;
            try {
                await driveService.createFolder(name);
                newFolderModal?.close();
                this.renderSidebarFolderList();
                this.renderRootFolderGrid();
                showNotice(`Folder "${name}" created successfully.`, "Success", "check_circle");
            } catch (err) {
                showNotice("Failed to create folder: " + err.message, "Error", "error");
            }
        };

        if (btnConfirmNewFolder) btnConfirmNewFolder.addEventListener("click", handleCreateFolder);
        if (btnCancelNewFolder) btnCancelNewFolder.addEventListener("click", () => newFolderModal?.close());
        if (modalFolderNameInput) {
            modalFolderNameInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreateFolder();
                }
            });
        }

        // Rename folder modal
        const renameFolderModal = document.getElementById("renameFolderModal");
        const btnConfirmRenameFolder = document.getElementById("btnConfirmRenameFolder");
        const btnCancelRenameFolder = document.getElementById("btnCancelRenameFolder");
        const modalRenameFolderNameInput = document.getElementById("modalRenameFolderNameInput");
        const renameFolderErrorText = document.getElementById("renameFolderErrorText");

        const handleRenameFolder = async () => {
            if (!this.folderBeingRenamed) return;
            const newName = modalRenameFolderNameInput?.value.trim();
            if (!newName) {
                if (renameFolderErrorText) {
                    renameFolderErrorText.textContent = "Please enter a folder name.";
                    renameFolderErrorText.style.display = "block";
                }
                return;
            }
            try {
                await driveService.renameFolder(this.folderBeingRenamed, newName);
                renameFolderModal?.close();
                this.renderSidebarFolderList();
                if (driveService.currentFolderName === newName) {
                    this.updateFolderHeader(newName);
                } else {
                    this.renderRootFolderGrid();
                }
                showNotice(`Folder renamed to "${newName}"`, "Success", "check_circle");
            } catch (err) {
                if (renameFolderErrorText) {
                    renameFolderErrorText.textContent = err.message || "Failed to rename folder.";
                    renameFolderErrorText.style.display = "block";
                }
            }
        };

        if (btnConfirmRenameFolder) btnConfirmRenameFolder.addEventListener("click", handleRenameFolder);
        if (btnCancelRenameFolder) btnCancelRenameFolder.addEventListener("click", () => renameFolderModal?.close());
        if (modalRenameFolderNameInput) {
            modalRenameFolderNameInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    handleRenameFolder();
                }
            });
            modalRenameFolderNameInput.addEventListener("input", () => {
                if (renameFolderErrorText) renameFolderErrorText.style.display = "none";
            });
        }

        // Rename file modal
        const renameFileModal = document.getElementById("renameFileModal");
        const btnConfirmRenameFile = document.getElementById("btnConfirmRenameFile");
        const btnCancelRenameFile = document.getElementById("btnCancelRenameFile");
        const modalRenameFileNameInput = document.getElementById("modalRenameFileNameInput");
        const renameFileErrorText = document.getElementById("renameFileErrorText");

        const handleRenameFile = async () => {
            if (!this.fileBeingRenamed) return;
            const newName = modalRenameFileNameInput?.value.trim();
            if (!newName) {
                if (renameFileErrorText) {
                    renameFileErrorText.textContent = "Please enter a file name.";
                    renameFileErrorText.style.display = "block";
                }
                return;
            }
            try {
                await driveService.renameFile(this.fileBeingRenamed, newName);
                renameFileModal?.close();
                this.renderFiles(false);
                showNotice(`Renamed to "${newName}"`, "Success", "check_circle");
            } catch (err) {
                if (renameFileErrorText) {
                    renameFileErrorText.textContent = err.message || "Failed to rename file.";
                    renameFileErrorText.style.display = "block";
                }
            }
        };

        if (btnConfirmRenameFile) btnConfirmRenameFile.addEventListener("click", handleRenameFile);
        if (btnCancelRenameFile) btnCancelRenameFile.addEventListener("click", () => renameFileModal?.close());
        if (modalRenameFileNameInput) {
            modalRenameFileNameInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    handleRenameFile();
                }
            });
            modalRenameFileNameInput.addEventListener("input", () => {
                if (renameFileErrorText) renameFileErrorText.style.display = "none";
            });
        }

        // Password change modal
        const pwModal = document.getElementById("pwModal");
        const btnConfirmPw = document.getElementById("btnConfirmPw");
        const btnCancelPw = document.getElementById("btnCancelPw");

        if (btnConfirmPw) {
            btnConfirmPw.addEventListener("click", async () => {
                const newPw = document.getElementById("newPassword").value;
                const confirmPw = document.getElementById("newPasswordConfirm").value;
                if (!newPw) return showNotice("Please enter a new password.", "Notice", "warning");
                if (newPw !== confirmPw) return showNotice("Passwords do not match.", "Notice", "warning");

                try {
                    await driveService.changePassword(newPw);
                    pwModal?.close();
                    this.syncUserProfileUI();
                    showNotice("Password changed successfully.", "Success", "check_circle");
                } catch (e) {
                    showNotice("Failed to change password: " + e.message, "Error", "error");
                }
            });
        }
        if (btnCancelPw) btnCancelPw.addEventListener("click", () => pwModal?.close());

        // Trim modal
        const trimFolderModal = document.getElementById("trimFolderModal");
        const btnConfirmTrimFolder = document.getElementById("btnConfirmTrimFolder");
        const btnCancelTrimFolder = document.getElementById("btnCancelTrimFolder");

        if (btnConfirmTrimFolder) {
            btnConfirmTrimFolder.addEventListener("click", async () => {
                const folderName = trimFolderModal?.dataset.folderName;
                if (!folderName) return;

                const statusArea = document.getElementById("trimFolderStatusArea");
                const resultText = document.getElementById("trimFolderResultText");
                const desc = document.getElementById("trimFolderDesc");
                const actions = document.getElementById("trimFolderActions");

                if (statusArea) statusArea.style.display = "block";
                if (desc) desc.style.display = "none";
                if (actions) actions.style.display = "none";

                try {
                    const res = await driveService.trimFolder(folderName);
                    if (statusArea) statusArea.style.display = "none";
                    if (resultText) {
                        resultText.style.display = "block";
                        resultText.textContent = res.text || "Trim completed successfully.";
                    }
                    setTimeout(() => {
                        trimFolderModal?.close();
                        if (actions) actions.style.display = "flex";
                        if (desc) desc.style.display = "block";
                        if (resultText) resultText.style.display = "none";
                        if (driveService.currentFolderName === folderName) {
                            this.renderFiles(false);
                        }
                    }, 1200);
                } catch (err) {
                    if (statusArea) statusArea.style.display = "none";
                    if (resultText) {
                        resultText.style.display = "block";
                        resultText.textContent = "Error: " + err.message;
                    }
                    if (actions) actions.style.display = "flex";
                }
            });
        }
        if (btnCancelTrimFolder) btnCancelTrimFolder.addEventListener("click", () => trimFolderModal?.close());

        // Backdrop click close for dialogs
        document.querySelectorAll("dialog").forEach(dialog => {
            dialog.addEventListener("click", (e) => {
                const rect = dialog.getBoundingClientRect();
                const inDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height && rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
                if (!inDialog) dialog.close();
            });
        });
    }

    openRenameFolderModal(folderName) {
        this.folderBeingRenamed = folderName;
        const modal = document.getElementById("renameFolderModal");
        const input = document.getElementById("modalRenameFolderNameInput");
        const errText = document.getElementById("renameFolderErrorText");
        if (errText) errText.style.display = "none";
        if (input) {
            input.value = folderName;
            input.select();
        }
        if (modal) modal.showModal();
    }

    openRenameFileModal(fileName) {
        this.fileBeingRenamed = fileName;
        const modal = document.getElementById("renameFileModal");
        const input = document.getElementById("modalRenameFileNameInput");
        const errText = document.getElementById("renameFileErrorText");
        if (errText) errText.style.display = "none";
        if (input) {
            input.value = fileName;
            const lastDot = fileName.lastIndexOf(".");
            if (lastDot > 0) input.setSelectionRange(0, lastDot);
            else input.select();
        }
        if (modal) modal.showModal();
    }

    async openShareFolderModal(folderName) {
        const modal = document.getElementById("shareModal");
        const descEl = document.getElementById("shareModalDesc");
        const pwInput = document.getElementById("sharePasswordInput");
        const errText = document.getElementById("shareErrorText");
        const btnConfirm = document.getElementById("btnConfirmShare");
        const btnCancel = document.getElementById("btnCancelShare");

        if (descEl) {
            descEl.innerHTML = `Set a password to encrypt this folder's share token for "<strong>${folderName.replace(/</g, "&lt;")}</strong>". Anyone with the token file and password can access the folder.`;
        }
        if (pwInput) pwInput.value = "";
        if (errText) errText.style.display = "none";

        modal?.showModal();
        pwInput?.focus();

        const cleanup = () => {
            btnConfirm?.removeEventListener("click", onConfirm);
            btnCancel?.removeEventListener("click", onCancel);
        };
        const onCancel = () => { cleanup(); modal?.close(); };
        const onConfirm = async () => {
            const pw = pwInput?.value;
            if (!pw) {
                if (errText) {
                    errText.textContent = "Please enter a password.";
                    errText.style.display = "block";
                }
                return;
            }
            cleanup();
            modal?.close();

            const maskedKey = driveService.fldMap[folderName];
            const token = await makeToken(folderName, maskedKey, pw);
            if (!token) return;

            const blob = new Blob([token], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const safeName = folderName.replace(/[\\/:*?"<>|]/g, "_");
            a.download = `${safeName}_share.txt`;
            a.click();
            URL.revokeObjectURL(url);
            showNotice("Share token downloaded successfully.", "Share Folder", "check_circle");
        };

        btnConfirm?.addEventListener("click", onConfirm);
        btnCancel?.addEventListener("click", onCancel);
    }

    async handleImportShare() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".txt";
        input.onchange = async () => {
            if (!input.files[0]) return;
            const fileText = (await input.files[0].text()).trim();

            const modal = document.getElementById("importShareModal");
            const pwInput = document.getElementById("importPasswordInput");
            const errText = document.getElementById("importErrorText");
            const btnConfirm = document.getElementById("btnConfirmImportShare");
            const btnCancel = document.getElementById("btnCancelImportShare");

            if (pwInput) pwInput.value = "";
            if (errText) errText.style.display = "none";
            modal?.showModal();
            pwInput?.focus();

            const cleanup = () => {
                btnConfirm?.removeEventListener("click", onConfirm);
                btnCancel?.removeEventListener("click", onCancel);
            };
            const onCancel = () => { cleanup(); modal?.close(); };
            const onConfirm = async () => {
                const pw = pwInput?.value;
                if (!pw) {
                    if (errText) {
                        errText.textContent = "Please enter the password.";
                        errText.style.display = "block";
                    }
                    return;
                }
                cleanup();
                modal?.close();

                const info = await loadToken(fileText, pw);
                if (!info) {
                    return showNotice("Invalid token or incorrect password.", "Error", "error");
                }

                const effectiveName = info.name;
                if (driveService.fldMap[effectiveName]) {
                    const overwrite = await showConfirmModal(
                        `A folder named "${effectiveName}" already exists. Overwrite?`,
                        "Overwrite Folder?",
                        "warning",
                        "Overwrite",
                        true
                    );
                    if (!overwrite) return;
                }

                driveService.fldMap[effectiveName] = info.key;
                await driveService.saveUser();
                await driveService.loadUser();
                this.renderSidebarFolderList();
                this.renderRootFolderGrid();
                showNotice(`Folder "${effectiveName}" imported successfully.`, "Success", "check_circle");
            };

            btnConfirm?.addEventListener("click", onConfirm);
            btnCancel?.addEventListener("click", onCancel);
        };
        input.click();
    }

    openTrimFolderModal(folderName) {
        const modal = document.getElementById("trimFolderModal");
        if (modal) {
            modal.dataset.folderName = folderName;
            modal.showModal();
        }
    }

    async openUnlinkFolderModal(folderName) {
        const ok = await showConfirmModal(
            `Are you sure you want to remove folder "<strong>${folderName.replace(/</g, "&lt;")}</strong>" from your account? The folder will remain accessible for other users sharing it.`,
            "Remove Folder?",
            "link_off",
            "Remove"
        );
        if (!ok) return;
        try {
            await driveService.unlinkFolder(folderName);
            this.renderSidebarFolderList();
            if (driveService.currentFolderName === folderName) {
                router.navigate('/drive');
            } else {
                this.renderRootFolderGrid();
            }
            showNotice(`Removed "${folderName}" from your account.`, "Success", "check_circle");
        } catch (e) {
            showNotice("Failed to remove folder: " + e.message, "Error", "error");
        }
    }

    async openDeleteFolderModal(folderName) {
        const ok = await showConfirmModal(
            `Are you sure you want to delete "<strong>${folderName.replace(/</g, "&lt;")}</strong>" permanently? All files and encrypted metadata inside it will be permanently deleted from the server for ALL users.`,
            "Delete Permanently?",
            "delete_forever",
            "Delete Permanently",
            true
        );
        if (!ok) return;
        try {
            await driveService.deleteFolderPermanently(folderName);
            this.renderSidebarFolderList();
            if (driveService.currentFolderName === folderName) {
                router.navigate('/drive');
            } else {
                this.renderRootFolderGrid();
            }
            showNotice(`Folder "${folderName}" permanently deleted.`, "Deleted", "delete");
        } catch (e) {
            showNotice("Failed to delete folder: " + e.message, "Error", "error");
        }
    }

    // 6. Upload & Drag and Drop
    bindUploadAndDragDrop() {
        const fileInput = document.getElementById("fileInput");
        const folderInput = document.getElementById("folderInput");
        const menuItemFileUpload = document.getElementById("menuItemFileUpload");
        const menuItemFolderUpload = document.getElementById("menuItemFolderUpload");
        const btnEmptyUploadAction = document.getElementById("btnEmptyUploadAction");

        const triggerFile = () => {
            this.closeAllDropdowns();
            if (!driveService.currentFolderName) {
                return showNotice("Please select or create a folder first to upload files.", "Select Folder", "warning");
            }
            if (fileInput) { fileInput.value = ""; fileInput.click(); }
        };

        const triggerFolder = () => {
            this.closeAllDropdowns();
            if (!driveService.currentFolderName) {
                return showNotice("Please select or create a folder first to upload files.", "Select Folder", "warning");
            }
            if (folderInput) { folderInput.value = ""; folderInput.click(); }
        };

        if (menuItemFileUpload) menuItemFileUpload.addEventListener("click", triggerFile);
        if (menuItemFolderUpload) menuItemFolderUpload.addEventListener("click", triggerFolder);
        if (btnEmptyUploadAction) btnEmptyUploadAction.addEventListener("click", triggerFile);

        if (fileInput) {
            fileInput.addEventListener("change", () => {
                if (fileInput.files.length > 0) {
                    const prepared = uploadService.prepareFiles(fileInput.files);
                    this.executeUpload(prepared);
                }
            });
        }

        if (folderInput) {
            folderInput.addEventListener("change", () => {
                if (folderInput.files.length > 0) {
                    const prepared = uploadService.prepareFiles(folderInput.files);
                    this.executeUpload(prepared);
                }
            });
        }

        // Full window Drag & Drop
        const dragDropOverlay = document.getElementById("dragDropOverlay");
        const dragDropSubtitle = document.getElementById("dragDropSubtitle");
        let dragCounter = 0;

        window.addEventListener("dragenter", (e) => {
            e.preventDefault();
            if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files")) {
                dragCounter++;
                if (dragCounter === 1 && dragDropOverlay) {
                    const cur = driveService.currentFolderName;
                    if (dragDropSubtitle) dragDropSubtitle.textContent = cur ? `Upload to "${cur}"` : "Please select a folder first";
                    dragDropOverlay.classList.add("active");
                }
            }
        });

        window.addEventListener("dragleave", (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                dragDropOverlay?.classList.remove("active");
            }
        });

        window.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        });

        window.addEventListener("drop", async (e) => {
            e.preventDefault();
            dragCounter = 0;
            dragDropOverlay?.classList.remove("active");

            if (!driveService.currentFolderName) {
                return showNotice("Please select or create a folder first before uploading files.", "Select Folder", "warning");
            }

            if (!e.dataTransfer) return;
            const files = Array.from(e.dataTransfer.files || []);
            if (files.length > 0) {
                const prepared = uploadService.prepareFiles(files);
                this.executeUpload(prepared);
            }
        });
    }

    async executeUpload(files) {
        if (!files || files.length === 0) return;

        // Check for overwrites
        const confirmedFiles = [];
        for (const file of files) {
            if (driveService.flsMap[file.name]) {
                const overwrite = await showConfirmModal(
                    `File "${file.name}" already exists. Overwrite?`,
                    "File Exists",
                    "warning",
                    "Overwrite",
                    true
                );
                if (overwrite) confirmedFiles.push(file);
            } else {
                confirmedFiles.push(file);
            }
        }
        if (confirmedFiles.length === 0) return;

        try {
            await uploadService.uploadFiles(confirmedFiles, {
                onStart: (fls) => this.showUploadProgressWidget(fls),
                onFileProgress: (idx, percent, total) => this.updateFileProgress(idx, percent, total),
                onFileComplete: (idx, name) => this.markFileUploaded(idx, name),
                onSyncing: () => this.setUploadSyncingState(),
                onComplete: () => {
                    this.markUploadComplete();
                    this.renderFiles(false);
                },
                onCancel: (idx) => this.markUploadCancelled(idx)
            });
        } catch (e) {
            showNotice("Upload failed: " + e.message, "Upload Error", "error");
        }
    }

    // 7. Upload progress widget UI
    bindUploadWidget() {
        const uploadProgressWidget = document.getElementById("uploadProgressWidget");
        const uploadWidgetHeader = document.getElementById("uploadWidgetHeader");
        const btnMinimizeUploadWidget = document.getElementById("btnMinimizeUploadWidget");
        const btnCloseUploadWidget = document.getElementById("btnCloseUploadWidget");
        const uploadWidgetChevron = document.getElementById("uploadWidgetChevron");
        const uploadWidgetBody = document.getElementById("uploadWidgetBody");

        const toggleCollapse = () => {
            if (!uploadWidgetBody) return;
            const collapsed = uploadWidgetBody.classList.toggle("collapsed");
            if (uploadWidgetChevron) {
                uploadWidgetChevron.textContent = collapsed ? "keyboard_arrow_up" : "keyboard_arrow_down";
            }
        };

        if (uploadWidgetHeader) {
            uploadWidgetHeader.addEventListener("click", (e) => {
                if (!e.target.closest("#btnCloseUploadWidget")) toggleCollapse();
            });
        }
        if (btnMinimizeUploadWidget) btnMinimizeUploadWidget.addEventListener("click", (e) => { e.stopPropagation(); toggleCollapse(); });
        if (btnCloseUploadWidget) {
            btnCloseUploadWidget.addEventListener("click", (e) => {
                e.stopPropagation();
                uploadProgressWidget?.classList.add("hidden");
                clearTimeout(this.uploadDismissTimer);
            });
        }

        if (uploadProgressWidget) {
            uploadProgressWidget.addEventListener("mouseenter", () => {
                this.isWidgetHovered = true;
                clearTimeout(this.uploadDismissTimer);
            });
            uploadProgressWidget.addEventListener("mouseleave", () => {
                this.isWidgetHovered = false;
                if (!uploadService.isUploading && !uploadProgressWidget.classList.contains("hidden")) {
                    this.uploadDismissTimer = setTimeout(() => {
                        uploadProgressWidget.classList.add("hidden");
                    }, 4000);
                }
            });
        }
    }

    showUploadProgressWidget(files) {
        clearTimeout(this.uploadDismissTimer);
        this.activeUploadFiles = files || [];
        const uploadProgressWidget = document.getElementById("uploadProgressWidget");
        const uploadWidgetTitle = document.getElementById("uploadWidgetTitle");
        const uploadFileList = document.getElementById("uploadFileList");
        const uploadWidgetBody = document.getElementById("uploadWidgetBody");
        const uploadWidgetChevron = document.getElementById("uploadWidgetChevron");

        if (uploadProgressWidget) {
            uploadProgressWidget.classList.remove("hidden");
            uploadProgressWidget.style.opacity = "1";
            uploadProgressWidget.style.transform = "translateY(0)";
        }
        if (uploadWidgetBody) uploadWidgetBody.classList.remove("collapsed");
        if (uploadWidgetChevron) uploadWidgetChevron.textContent = "keyboard_arrow_down";

        const count = this.activeUploadFiles.length;
        if (uploadWidgetTitle) uploadWidgetTitle.textContent = `Uploading ${count} ${count === 1 ? 'item' : 'items'}...`;

        if (uploadFileList) {
            uploadFileList.innerHTML = "";
            this.activeUploadFiles.forEach((f, idx) => {
                const info = getGoogleFileIcon(f.name);
                const item = document.createElement("div");
                item.className = "upload-file-item";
                item.id = `uploadItem_${idx}`;
                item.dataset.fileName = f.name;
                item.innerHTML = `
                    <span class="material-symbols-outlined upload-item-type-icon" style="color: ${info.color};">${info.icon}</span>
                    <span class="upload-item-name" title="${f.name}">${f.name}</span>
                    <div class="upload-item-status" id="uploadItemStatus_${idx}">
                        ${idx === 0 ? this.createProgressRingHtml(idx, 0) : '<span class="material-symbols-outlined" style="font-size: 18px; color: var(--g-text-muted);">schedule</span>'}
                    </div>
                `;
                uploadFileList.appendChild(item);
            });
        }
    }

    createProgressRingHtml(idx, percent = 0) {
        const offset = RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * Math.max(0, Math.min(100, percent)) / 100);
        return `
            <button type="button" class="upload-progress-btn" id="uploadProgressBtn_${idx}" title="Cancel upload">
                <svg class="progress-ring-svg" viewBox="0 0 24 24">
                    <circle class="progress-ring-bg" cx="12" cy="12" r="9"></circle>
                    <circle class="progress-ring-circle" cx="12" cy="12" r="9" style="stroke-dasharray: ${RING_CIRCUMFERENCE}; stroke-dashoffset: ${offset};"></circle>
                </svg>
                <span class="material-symbols-outlined progress-cancel-icon">close</span>
            </button>
        `;
    }

    updateFileProgress(fileIdx, percent, totalFiles) {
        const total = totalFiles || this.activeUploadFiles.length || 1;
        const statusEl = document.getElementById(`uploadItemStatus_${fileIdx}`);
        if (statusEl) {
            if (percent >= 100) {
                statusEl.innerHTML = `<span class="material-symbols-outlined status-complete-icon">check_circle</span>`;
            } else {
                let circle = statusEl.querySelector(".progress-ring-circle");
                if (!circle) {
                    statusEl.innerHTML = this.createProgressRingHtml(fileIdx, percent);
                    circle = statusEl.querySelector(".progress-ring-circle");
                    statusEl.querySelector(".upload-progress-btn")?.addEventListener("click", (e) => {
                        e.stopPropagation();
                        uploadService.cancelUpload(fileIdx);
                    });
                }
                if (circle) {
                    const offset = RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * Math.max(0, Math.min(100, percent)) / 100);
                    circle.style.strokeDashoffset = `${offset}`;
                }
            }
        }
        const uploadWidgetTitle = document.getElementById("uploadWidgetTitle");
        if (uploadWidgetTitle) {
            uploadWidgetTitle.textContent = `Uploading ${total} ${total === 1 ? 'item' : 'items'} (${fileIdx + 1}/${total})...`;
        }
    }

    markFileUploaded(idx, name) {
        const statusEl = document.getElementById(`uploadItemStatus_${idx}`);
        if (statusEl) {
            statusEl.innerHTML = `<span class="material-symbols-outlined status-complete-icon">check_circle</span>`;
        }
    }

    setUploadSyncingState() {
        const uploadWidgetTitle = document.getElementById("uploadWidgetTitle");
        if (uploadWidgetTitle) uploadWidgetTitle.textContent = "Syncing with MediaHub...";
    }

    markUploadComplete() {
        const total = this.activeUploadFiles.length || 1;
        const uploadWidgetTitle = document.getElementById("uploadWidgetTitle");
        if (uploadWidgetTitle) uploadWidgetTitle.textContent = `${total} ${total === 1 ? 'upload' : 'uploads'} complete`;

        const uploadFileList = document.getElementById("uploadFileList");
        if (uploadFileList) {
            uploadFileList.querySelectorAll(".upload-file-item").forEach((item, idx) => {
                const name = item.dataset.fileName;
                item.classList.add("completed");
                item.onclick = () => {
                    this.openFileInViewer(name);
                };
            });
        }

        clearTimeout(this.uploadDismissTimer);
        this.uploadDismissTimer = setTimeout(() => {
            if (!this.isWidgetHovered) {
                const widget = document.getElementById("uploadProgressWidget");
                if (widget) widget.classList.add("hidden");
            }
        }, 7000);
    }

    markUploadCancelled(fileIdx) {
        const uploadWidgetTitle = document.getElementById("uploadWidgetTitle");
        if (uploadWidgetTitle) uploadWidgetTitle.textContent = "Upload cancelled";
        if (fileIdx !== undefined && fileIdx >= 0) {
            const statusEl = document.getElementById(`uploadItemStatus_${fileIdx}`);
            if (statusEl) statusEl.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; color: var(--g-text-muted);">block</span>`;
        }
    }

    // 8. Workspace Rendering
    async mount(folderName = "") {
        this.init();
        this.syncUserProfileUI();
        await driveService.loadUser();
        this.renderSidebarFolderList();

        if (!folderName) {
            driveService.selectFolder("");
            this.updateFolderHeader("");
            this.renderRootFolderGrid();
        } else {
            const ok = await driveService.selectFolder(folderName);
            if (!ok) {
                showNotice("Folder not found", "Notice", "warning");
                return router.navigate('/drive');
            }
            this.updateFolderHeader(folderName);
            this.page = 1;
            await this.renderFiles(false);
        }
    }

    updateFolderHeader(folderName) {
        const breadcrumbName = document.getElementById("breadcrumbFolderName");
        const breadcrumbSeparator = document.getElementById("breadcrumbSeparator");
        const folderTitle = document.getElementById("currentFolderTitle");
        const rootFolderView = document.getElementById("rootFolderView");
        const mediaContainer = document.getElementById("mediaContainer");
        const sidebarMyDriveHeader = document.getElementById("sidebarMyDriveHeader");
        const filterActionWrapper = document.getElementById("filterActionWrapper");
        const viewActionWrapper = document.getElementById("viewActionWrapper");
        const sortActionWrapper = document.getElementById("sortActionWrapper");
        const btnCurrentFolderMore = document.getElementById("btnCurrentFolderMore");

        if (folderName) {
            if (breadcrumbName) { breadcrumbName.textContent = folderName; breadcrumbName.style.display = "inline"; }
            if (breadcrumbSeparator) breadcrumbSeparator.style.display = "inline";
            if (folderTitle) folderTitle.textContent = folderName;
            if (rootFolderView) rootFolderView.style.display = "none";
            if (mediaContainer) mediaContainer.style.display = "flex";
            if (sidebarMyDriveHeader) sidebarMyDriveHeader.classList.remove("active");
            if (filterActionWrapper) filterActionWrapper.style.display = "";
            if (viewActionWrapper) viewActionWrapper.style.display = "";
            if (sortActionWrapper) sortActionWrapper.style.display = "";
            if (btnCurrentFolderMore) btnCurrentFolderMore.style.display = "inline-flex";

            document.querySelectorAll(".nav-folder-item").forEach(item => {
                item.classList.toggle("active", item.dataset.folderName === folderName);
            });
        } else {
            if (breadcrumbName) { breadcrumbName.textContent = ""; breadcrumbName.style.display = "none"; }
            if (breadcrumbSeparator) breadcrumbSeparator.style.display = "none";
            if (folderTitle) folderTitle.textContent = "My Drive";
            if (rootFolderView) rootFolderView.style.display = "flex";
            if (mediaContainer) mediaContainer.style.display = "none";
            if (sidebarMyDriveHeader) sidebarMyDriveHeader.classList.add("active");
            if (filterActionWrapper) filterActionWrapper.style.display = "none";
            if (viewActionWrapper) viewActionWrapper.style.display = "none";
            if (sortActionWrapper) sortActionWrapper.style.display = "none";
            if (btnCurrentFolderMore) btnCurrentFolderMore.style.display = "none";

            document.querySelectorAll(".nav-folder-item").forEach(item => {
                item.classList.remove("active");
            });
        }
    }

    renderSidebarFolderList() {
        const sidebarFolderList = document.getElementById("sidebarFolderList");
        if (!sidebarFolderList) return;
        sidebarFolderList.innerHTML = "";

        const folders = Object.keys(driveService.fldMap);
        if (folders.length === 0) {
            sidebarFolderList.innerHTML = '<div style="padding: 10px 14px; font-size: 13px; color: var(--g-text-muted);">No folders</div>';
            return;
        }

        folders.forEach(name => {
            const item = document.createElement("div");
            item.className = "nav-folder-item" + (name === driveService.currentFolderName ? " active" : "");
            item.dataset.folderName = name;
            item.innerHTML = `
                <span class="material-symbols-outlined nav-folder-icon">folder</span>
                <span class="folder-name-label" title="${name}">${name}</span>
                <button type="button" class="folder-more-btn" title="More options" aria-label="More options">
                    <span class="material-symbols-outlined">more_vert</span>
                </button>
            `;
            item.addEventListener("click", () => {
                if (window.innerWidth <= 768) {
                    document.querySelector(".drive-sidebar")?.classList.remove("mobile-open");
                    document.getElementById("sidebarBackdrop")?.classList.remove("active");
                }
                router.navigate(`/drive/${encodeURIComponent(name)}`);
            });
            const moreBtn = item.querySelector(".folder-more-btn");
            if (moreBtn) {
                moreBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.openFolderContextMenu(e, name, moreBtn);
                });
            }
            sidebarFolderList.appendChild(item);
        });
    }

    async renderRootFolderGrid() {
        const rootFolderGrid = document.getElementById("rootFolderGrid");
        if (!rootFolderGrid) return;

        const searchInput = document.getElementById("topSearchInput");
        const query = (searchInput ? searchInput.value || "" : "").normalize('NFC').trim().toLowerCase();

        if (!query) {
            rootFolderGrid.innerHTML = "";
            const folders = Object.keys(driveService.fldMap);
            if (folders.length === 0) {
                rootFolderGrid.innerHTML = `
                    <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--g-text-muted);">
                        <span class="material-symbols-outlined" style="font-size: 48px; margin-bottom: 8px;">folder_off</span>
                        <div style="font-size: 16px; font-weight: 500; color: var(--g-text-main); margin-bottom: 4px;">No folders created</div>
                        <div style="font-size: 13px;">Click "+ New" to create your first folder.</div>
                    </div>
                `;
                return;
            }

            folders.forEach(name => {
                const card = document.createElement("div");
                card.className = "root-folder-card";
                card.innerHTML = `
                    <span class="material-symbols-outlined">folder</span>
                    <span class="root-folder-card-name">${name}</span>
                    <button type="button" class="folder-more-btn" title="More options" aria-label="More options">
                        <span class="material-symbols-outlined">more_vert</span>
                    </button>
                `;
                card.addEventListener("click", () => {
                    router.navigate(`/drive/${encodeURIComponent(name)}`);
                });
                const moreBtn = card.querySelector(".folder-more-btn");
                if (moreBtn) {
                    moreBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        this.openFolderContextMenu(e, name, moreBtn);
                    });
                }
                rootFolderGrid.appendChild(card);
            });
            return;
        }

        // Global search across root folders and all files
        const thisReq = ++this.rootSearchCounter;
        rootFolderGrid.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 36px 20px; text-align: center; color: var(--g-text-muted);">
                <div class="m3-circular-progress" style="width: 28px; height: 28px; margin: 0 auto 12px auto; border-width: 3px;"></div>
                <div style="font-size: 14px; color: var(--g-text-main);">Searching across all folders...</div>
            </div>
        `;

        const allFiles = await driveService.fetchAllFoldersAndFiles();
        if (thisReq !== this.rootSearchCounter) return;

        const folders = Object.keys(driveService.fldMap);
        const matchingFolders = folders.filter(f => f.normalize('NFC').toLowerCase().includes(query));
        const matchingFiles = allFiles.filter(f => f.fileName.normalize('NFC').toLowerCase().includes(query));

        if (matchingFolders.length === 0 && matchingFiles.length === 0) {
            rootFolderGrid.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; color: var(--g-text-muted);">
                    <span class="material-symbols-outlined" style="font-size: 48px; margin-bottom: 8px; opacity: 0.6;">search_off</span>
                    <div style="font-size: 16px; font-weight: 500; color: var(--g-text-main); margin-bottom: 4px;">No matching results</div>
                    <div style="font-size: 13px;">No folders or files matching "${query}".</div>
                </div>
            `;
            return;
        }

        rootFolderGrid.innerHTML = "";

        if (matchingFolders.length > 0) {
            const h = document.createElement("div");
            h.className = "root-folder-header";
            h.style.gridColumn = "1 / -1";
            h.textContent = `Folders (${matchingFolders.length})`;
            rootFolderGrid.appendChild(h);

            matchingFolders.forEach(name => {
                const card = document.createElement("div");
                card.className = "root-folder-card";
                card.innerHTML = `
                    <span class="material-symbols-outlined">folder</span>
                    <span class="root-folder-card-name">${name}</span>
                    <button type="button" class="folder-more-btn" title="More options">
                        <span class="material-symbols-outlined">more_vert</span>
                    </button>
                `;
                card.addEventListener("click", () => router.navigate(`/drive/${encodeURIComponent(name)}`));
                const moreBtn = card.querySelector(".folder-more-btn");
                if (moreBtn) moreBtn.addEventListener("click", (e) => { e.stopPropagation(); this.openFolderContextMenu(e, name, moreBtn); });
                rootFolderGrid.appendChild(card);
            });
        }

        if (matchingFiles.length > 0) {
            const h = document.createElement("div");
            h.className = "root-folder-header";
            h.style.gridColumn = "1 / -1";
            h.style.margin = (matchingFolders.length > 0) ? "24px 0 4px 0" : "0 0 4px 0";
            h.textContent = `Files (${matchingFiles.length})`;
            rootFolderGrid.appendChild(h);

            const grid = document.createElement("div");
            grid.className = "media-grid";
            grid.style.gridColumn = "1 / -1";
            grid.style.width = "100%";

            matchingFiles.forEach(file => {
                const card = document.createElement("div");
                card.className = "media-card";
                const img = document.createElement("img");
                img.className = "thumb-img";
                img.alt = "Loading...";

                const rawFK = file.fileKey.slice();
                const fkSlice = rawFK.slice(0, 44);
                const ext = file.fileName.split('.').pop().toUpperCase();
                driveService.loadThumbnail(file.folderId, getObjPid(fkSlice), ext, img, fkSlice);

                const title = document.createElement("div");
                title.className = "file-title";
                title.textContent = file.fileName;

                const folderChip = document.createElement("div");
                folderChip.className = "file-folder-chip";
                folderChip.innerHTML = `<span class="material-symbols-outlined">folder</span><span>${file.folderName}</span>`;

                card.appendChild(img);
                card.appendChild(title);
                card.appendChild(folderChip);

                card.addEventListener("click", () => {
                    this.openFileInViewer(file.fileName, file.fileKey, file.folderId, file.folderKey, file.folderName);
                });
                grid.appendChild(card);
            });
            rootFolderGrid.appendChild(grid);
        }
    }

    async renderFiles(isAppend = false) {
        const grid = document.getElementById("mediaGrid");
        const emptyState = document.getElementById("emptyStateContainer");
        if (!grid) return;

        if (!isAppend) grid.innerHTML = "";

        let entries = Object.entries(driveService.flsMap);

        // Search query filter
        const searchInput = document.getElementById("topSearchInput");
        const query = (searchInput ? searchInput.value || "" : "").normalize('NFC').trim().toLowerCase();
        if (query) {
            entries = entries.filter(([name]) => name.normalize('NFC').toLowerCase().includes(query));
        }

        // Keyword filter
        if (driveService.selectKeywords.size > 0) {
            if (!driveService.keywordsBuilt) driveService.buildKeywords();
            entries = entries.filter(([name]) => {
                const tokens = driveService.tokenCache.get(name);
                if (!tokens) return false;
                for (const kw of driveService.selectKeywords) {
                    if (!tokens.has(kw)) return false;
                }
                return true;
            });
        }

        // Sorting
        const sortMode = driveService.sortMode;
        if (sortMode === "name-desc") {
            entries.sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true, sensitivity: 'base' }));
        } else if (sortMode === "size-asc") {
            entries.sort((a, b) => {
                const szA = driveService.getEntrySize(a[1]);
                const szB = driveService.getEntrySize(b[1]);
                return (szA - szB) || a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' });
            });
        } else if (sortMode === "size-desc") {
            entries.sort((a, b) => {
                const szA = driveService.getEntrySize(a[1]);
                const szB = driveService.getEntrySize(b[1]);
                return (szB - szA) || a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' });
            });
        } else {
            entries.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));
        }

        // Empty state check
        if (entries.length === 0) {
            if (emptyState) emptyState.style.display = "flex";
            const emptyTitle = document.getElementById("emptyStateTitle");
            const emptySubtitle = document.getElementById("emptyStateSubtitle");
            const emptyIcon = document.getElementById("emptyStateIcon");
            const emptyBtn = document.getElementById("btnEmptyUploadAction");

            if (query) {
                if (emptyIcon) emptyIcon.textContent = "search_off";
                if (emptyTitle) emptyTitle.textContent = "No matching files found";
                if (emptySubtitle) emptySubtitle.textContent = `No files matching "${query}".`;
                if (emptyBtn) emptyBtn.style.display = "none";
            } else if (driveService.selectKeywords.size > 0) {
                if (emptyIcon) emptyIcon.textContent = "filter_list_off";
                if (emptyTitle) emptyTitle.textContent = "No files match selected keywords";
                if (emptySubtitle) emptySubtitle.textContent = "Try unchecking some keywords or click clear to reset.";
                if (emptyBtn) {
                    emptyBtn.style.display = "inline-flex";
                    emptyBtn.innerHTML = `<span class="material-symbols-outlined">filter_alt_off</span><span>Clear filter</span>`;
                    emptyBtn.onclick = () => { driveService.selectKeywords.clear(); this.renderFiles(false); this.updateKeywordFilterUI(); };
                }
            } else {
                if (emptyIcon) emptyIcon.textContent = "cloud_upload";
                if (emptyTitle) emptyTitle.textContent = "This folder is empty";
                if (emptySubtitle) emptySubtitle.textContent = "Drag and drop files anywhere on the page, or use the upload button.";
                if (emptyBtn) {
                    emptyBtn.style.display = "inline-flex";
                    emptyBtn.innerHTML = `<span class="material-symbols-outlined">add</span><span>Upload</span>`;
                    emptyBtn.onclick = () => document.getElementById("fileInput")?.click();
                }
            }
            this.updateKeywordFilterUI();
            return;
        }

        if (emptyState) emptyState.style.display = "none";

        const start = isAppend ? (this.page - 1) * this.limit : 0;
        const end = Math.min(this.page * this.limit, entries.length);

        for (const [name, fileKey] of entries.slice(start, end)) {
            const card = document.createElement("div");
            card.className = "media-card";
            card.dataset.fileName = name;

            const img = document.createElement("img");
            img.className = "thumb-img";
            img.alt = "Loading...";

            const rawFK = fileKey.slice();
            const fkSlice = rawFK.slice(0, 44);
            const ext = name.split('.').pop().toUpperCase();
            driveService.loadThumbnail(driveService.currentFolderId, getObjPid(fkSlice), ext, img, fkSlice);

            const title = document.createElement("div");
            title.className = "file-title";
            title.textContent = name;
            title.title = name;

            const moreBtn = document.createElement("button");
            moreBtn.type = "button";
            moreBtn.className = "file-more-btn";
            moreBtn.title = "More options";
            moreBtn.innerHTML = '<span class="material-symbols-outlined">more_vert</span>';
            moreBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.openFileContextMenu(e, name, moreBtn);
            });

            card.appendChild(img);
            card.appendChild(title);
            card.appendChild(moreBtn);

            card.addEventListener("click", () => {
                this.openFileInViewer(name);
            });

            grid.appendChild(card);
        }

        this.enhanceCardsForListView();
        this.updateKeywordFilterUI();
    }

    async enhanceCardsForListView() {
        const mode = localStorage.getItem("driveViewMode");
        if (mode !== "details") return;
        const grid = document.getElementById("mediaGrid");
        const cards = grid?.querySelectorAll(".media-card");
        if (!cards || cards.length === 0) return;

        cards.forEach(card => {
            if (!card.dataset.enhanced) {
                card.dataset.enhanced = "true";
                const img = card.querySelector(".thumb-img");
                const title = card.querySelector(".file-title");
                const moreBtn = card.querySelector(".file-more-btn");
                const fileName = card.dataset.fileName;

                const nameCol = document.createElement("div");
                nameCol.className = "list-col-name";
                if (img) nameCol.appendChild(img);
                if (title) nameCol.appendChild(title);
                card.appendChild(nameCol);

                const sizeCol = document.createElement("div");
                sizeCol.className = "list-col-size";
                sizeCol.textContent = "...";
                card.appendChild(sizeCol);

                const moreCol = document.createElement("div");
                moreCol.className = "list-col-more";
                if (moreBtn) moreCol.appendChild(moreBtn);
                card.appendChild(moreCol);
            }
        });

        const currentFolder = driveService.currentFolderName;
        if (currentFolder) {
            const sizes = await driveService.fetchFolderFileSizes(currentFolder);
            cards.forEach(card => {
                const titleEl = card.querySelector(".file-title");
                const sizeEl = card.querySelector(".list-col-size");
                if (titleEl && sizeEl) {
                    const fn = titleEl.textContent;
                    if (sizes && sizes[fn] !== undefined) {
                        sizeEl.textContent = formatBytes(sizes[fn]);
                    } else {
                        sizeEl.textContent = "-";
                    }
                }
            });
        }
    }

    handleInfiniteScroll() {
        if (this.isInfiniteLoading || !driveService.currentFolderName) return;
        const mediaContainer = document.getElementById("mediaContainer");
        const infiniteScrollLoader = document.getElementById("infiniteScrollLoader");
        if (!mediaContainer) return;

        const remaining = mediaContainer.scrollHeight - mediaContainer.scrollTop - mediaContainer.clientHeight;
        if (remaining <= 320) {
            const total = Object.keys(driveService.flsMap).length;
            const maxPage = Math.ceil(total / this.limit);
            if (this.page < maxPage) {
                this.isInfiniteLoading = true;
                if (infiniteScrollLoader) infiniteScrollLoader.style.display = "flex";
                this.page++;
                setTimeout(async () => {
                    await this.renderFiles(true);
                    this.isInfiniteLoading = false;
                    if (infiniteScrollLoader) infiniteScrollLoader.style.display = "none";
                }, 150);
            }
        }
    }

    renderKeywordDropdownItems(filterQuery = "") {
        const keywordListContainer = document.getElementById("keywordListContainer");
        const keywordEmptyMessage = document.getElementById("keywordEmptyMessage");
        const keywordSearchWrap = document.getElementById("keywordSearchWrap");
        const btnClearAllKeywords = document.getElementById("btnClearAllKeywords");
        const filterMenuHeader = document.getElementById("filterMenuHeader");
        if (!keywordListContainer) return;

        const { availKeywords, keywordCounts, selectKeywords } = driveService;
        keywordListContainer.innerHTML = "";

        const query = (filterQuery || "").normalize('NFC').trim().toLowerCase();
        const filtered = availKeywords.filter(kw => !query || kw.normalize('NFC').toLowerCase().includes(query));

        if (keywordSearchWrap) {
            keywordSearchWrap.style.display = availKeywords.length >= 6 ? "block" : "none";
        }

        const hasSelected = selectKeywords.size > 0;
        if (btnClearAllKeywords) btnClearAllKeywords.style.display = hasSelected ? "inline-block" : "none";
        if (filterMenuHeader) filterMenuHeader.classList.toggle("has-clear", hasSelected);

        if (availKeywords.length === 0 || filtered.length === 0) {
            keywordListContainer.style.display = "none";
            if (keywordEmptyMessage) {
                keywordEmptyMessage.style.display = "block";
                keywordEmptyMessage.innerHTML = `<span class="material-symbols-outlined" style="font-size: 24px; margin-bottom: 4px; display: block; opacity: 0.6;">search_off</span><div style="font-size: 13px; font-weight: 500;">No keywords found</div>`;
            }
            return;
        }

        keywordListContainer.style.display = "flex";
        if (keywordEmptyMessage) keywordEmptyMessage.style.display = "none";

        filtered.forEach(kw => {
            const isChecked = selectKeywords.has(kw);
            const count = keywordCounts[kw] || 0;
            const item = document.createElement("div");
            item.className = "filter-menu-item" + (isChecked ? " active" : "");
            item.innerHTML = `
                <div class="filter-item-left">
                    <input type="checkbox" class="filter-item-checkbox" ${isChecked ? "checked" : ""}>
                    <span class="filter-item-name">${kw}</span>
                </div>
                <span class="filter-item-count">${count}</span>
            `;
            const chk = item.querySelector(".filter-item-checkbox");
            item.addEventListener("click", (e) => {
                if (e.target !== chk) chk.checked = !chk.checked;
                if (driveService.selectKeywords.has(kw)) driveService.selectKeywords.delete(kw);
                else driveService.selectKeywords.add(kw);
                this.page = 1;
                this.renderFiles(false);
                this.updateKeywordFilterUI();
            });
            keywordListContainer.appendChild(item);
        });
    }

    updateKeywordFilterUI() {
        const btnKeywordFilter = document.getElementById("btnKeywordFilter");
        const filterCountBadge = document.getElementById("filterCountBadge");
        const activeFilterChipsBar = document.getElementById("activeFilterChipsBar");
        const activeChipsList = document.getElementById("activeChipsList");

        const count = driveService.selectKeywords.size;
        if (btnKeywordFilter) btnKeywordFilter.classList.toggle("active-filter", count > 0);
        if (filterCountBadge) {
            filterCountBadge.style.display = count > 0 ? "inline-flex" : "none";
            filterCountBadge.textContent = count;
        }

        if (activeFilterChipsBar && activeChipsList) {
            if (count > 0) {
                activeFilterChipsBar.style.display = "flex";
                activeChipsList.innerHTML = "";
                driveService.selectKeywords.forEach(kw => {
                    const chip = document.createElement("span");
                    chip.className = "filter-chip";
                    chip.innerHTML = `<span>${kw}</span><button type="button" class="chip-remove-btn"><span class="material-symbols-outlined" style="font-size: 14px;">close</span></button>`;
                    chip.querySelector(".chip-remove-btn").addEventListener("click", (e) => {
                        e.stopPropagation();
                        driveService.selectKeywords.delete(kw);
                        this.page = 1;
                        this.renderFiles(false);
                        this.updateKeywordFilterUI();
                    });
                    activeChipsList.appendChild(chip);
                });
            } else {
                activeFilterChipsBar.style.display = "none";
                activeChipsList.innerHTML = "";
            }
        }
    }

    openFileInViewer(name, customFlKey, customFldId, customFldKey, customFldName) {
        let fldId = customFldId || driveService.currentFolderId;
        let fldName = customFldName || driveService.currentFolderName;
        let fldKey = customFldKey || driveService.currentFolderKey;
        let flKey = customFlKey || driveService.flsMap[name];

        if (!flKey || !fldId || !fldKey) return;

        SafeSession.setItem("currentFileName", name);
        SafeSession.setItem("currentFileKey", toHex(flKey));
        SafeSession.setItem("currentFolderId", fldId);
        SafeSession.setItem("currentFolderKey", toHex(fldKey));
        SafeSession.setItem("oldFold", fldName);
        SafeSession.save();

        router.navigate(`/viewer?folder=${encodeURIComponent(fldId)}&file=${encodeURIComponent(name)}`);
    }

    async shareFile(name) {
        const fileKey = driveService.flsMap[name];
        if (!fileKey || !driveService.currentFolderId) return;
        const pid = getObjPid(fileKey.slice(0, 44));
        const url = `${window.location.origin}/#drive/${encodeURIComponent(driveService.currentFolderName)}?file=${encodeURIComponent(pid)}`;
        try {
            await navigator.clipboard.writeText(url);
            showNotice("Link copied to clipboard.", "Share", "check_circle");
        } catch {
            prompt("Copy link:", url);
        }
    }

    async downloadFile(name) {
        showNotice(`Preparing download for "${name}"...`, "Downloading", "download");
        // Direct download using view viewer helper or fullDown logic
        // We will delegate to viewer view or drive download
        const fileKey = driveService.flsMap[name];
        if (!fileKey) return;
        this.openFileInViewer(name);
    }

    async deleteFile(name) {
        const ok = await showConfirmModal(
            `Are you sure you want to delete "<strong>${name.replace(/</g, "&lt;")}</strong>"?`,
            "Delete file?",
            "delete",
            "Delete",
            true
        );
        if (!ok) return;
        try {
            await driveService.deleteFile(name);
            this.renderFiles(false);
            showNotice(`Deleted "${name}"`, "Success", "check_circle");
        } catch (e) {
            showNotice("Delete failed: " + e.message, "Error", "error");
        }
    }

    syncUserProfileUI() {
        const username = SafeSession.getItem("username") || "User";
        const usrHsh = SafeSession.getItem("userHash") || "";
        const initial = (username.slice(0, 2) || "TE").toUpperCase();

        const headerAvatar = document.getElementById("headerAvatar");
        const menuLargeAvatar = document.getElementById("menuLargeAvatar");
        const menuUsername = document.getElementById("menuUsername");
        const menuUserHashShort = document.getElementById("menuUserHashShort");

        if (headerAvatar) headerAvatar.textContent = initial;
        if (menuLargeAvatar) menuLargeAvatar.textContent = initial;
        if (menuUsername) menuUsername.textContent = username;
        if (menuUserHashShort) {
            menuUserHashShort.textContent = usrHsh ? `ID: ${usrHsh.slice(0, 8)}...${usrHsh.slice(-4)}` : "E2EE Account";
        }
    }
}

export const driveView = new DriveView();
