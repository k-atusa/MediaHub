import sys
import os
from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, 
                             QLabel, QLineEdit, QPushButton, QListWidget, QListWidgetItem, 
                             QStackedWidget, QFileDialog, QMessageBox, QInputDialog, QTableWidget,
                             QTableWidgetItem, QHeaderView, QProgressBar, QTextEdit)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QUrl, QPoint, QPointF
from PyQt6.QtGui import QFont, QIcon, QColor, QPixmap, QPainter, QImage
try:
    from PyQt6.QtMultimedia import QMediaPlayer, QAudioOutput
    from PyQt6.QtMultimediaWidgets import QVideoWidget
except ImportError:
    QMediaPlayer = None
    QAudioOutput = None
    QVideoWidget = None
try:
    from PyQt6.QtWebEngineWidgets import QWebEngineView
except ImportError:
    QWebEngineView = None

from mediahub_core import MediaHubClient
from mediahub_proxy import MediaHubProxy
import urllib.parse
import json

CREDENTIALS_FILE = os.path.join(os.path.expanduser("."), ".mediahub_credentials.json")

class SortableTableItem(QTableWidgetItem):
    def __lt__(self, other):
        # Sort by UserRole (numeric size) if available
        data1 = self.data(Qt.ItemDataRole.UserRole)
        data2 = other.data(Qt.ItemDataRole.UserRole)
        if data1 is not None and data2 is not None:
            return data1 < data2
        return super().__lt__(other)

class WorkerBase(QThread):
    error = pyqtSignal(str)

class LoginWorker(WorkerBase):
    success = pyqtSignal()
    
    def __init__(self, client):
        super().__init__()
        self.client = client
        
    def run(self):
        try:
            self.client.authenticate()
            self.success.emit()
        except Exception as e:
            self.error.emit(str(e))

class FetchFoldersWorker(WorkerBase):
    success = pyqtSignal(dict)
    
    def __init__(self, client):
        super().__init__()
        self.client = client
        
    def run(self):
        try:
            folders = self.client.fetch_folders()
            self.success.emit(folders)
        except Exception as e:
            self.error.emit(str(e))

class FetchFilesWorker(WorkerBase):
    success = pyqtSignal(str, bytes, dict)
    
    def __init__(self, client, folder_name):
        super().__init__()
        self.client = client
        self.folder_name = folder_name
        
    def run(self):
        try:
            pid, key, files = self.client.fetch_files(self.folder_name)
            self.success.emit(pid, key, files)
        except Exception as e:
            self.error.emit(str(e))

class UploadWorker(WorkerBase):
    success = pyqtSignal()
    
    def __init__(self, client, folder_pid, folder_key, fls_map, filepaths):
        super().__init__()
        self.client = client
        self.folder_pid = folder_pid
        self.folder_key = folder_key
        self.fls_map = fls_map
        self.filepaths = filepaths
        
    def run(self):
        try:
            for fp in self.filepaths:
                self.client.upload_file(self.folder_pid, self.folder_key, self.fls_map, fp)
            self.success.emit()
        except Exception as e:
            self.error.emit(str(e))

class DownloadWorker(WorkerBase):
    success = pyqtSignal(str)
    
    def __init__(self, client, folder_pid, fl_info, file_name, out_dir):
        super().__init__()
        self.client = client
        self.folder_pid = folder_pid
        self.fl_info = fl_info
        self.file_name = file_name
        self.out_dir = out_dir
        
    def run(self):
        try:
            out_path = self.client.download_file(self.folder_pid, self.fl_info, self.file_name, self.out_dir)
            self.success.emit(out_path)
        except Exception as e:
            self.error.emit(str(e))

class ThumbnailWorker(WorkerBase):
    success = pyqtSignal(int, QPixmap)

    def __init__(self, client, folder_pid, file_pid, file_key_bytes, row):
        super().__init__()
        self.client = client
        self.folder_pid = folder_pid
        self.file_pid = file_pid
        self.file_key_bytes = file_key_bytes
        self.row = row

    def run(self):
        try:
            import requests
            import Bencrypt
            url = f"{self.client.server_url}/api/media/{self.folder_pid}/{self.file_pid}/thumb"
            res = requests.get(url, verify=False)
            if res.status_code == 200 and res.content:
                sm = Bencrypt.SymMaster("gcm1", self.file_key_bytes[:32])
                raw = sm.DeBin(res.content)
                pixmap = QPixmap.fromImage(QImage.fromData(raw))
                if not pixmap.isNull():
                    self.success.emit(self.row, pixmap)
        except Exception:
            pass

class ScalableImageLabel(QLabel):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._pixmap = None
        self._scale_factor = 1.0
        self._offset = QPointF(0, 0)
        self._last_mouse_pos = QPoint()

    def setPixmap(self, pixmap):
        self._pixmap = pixmap
        self._scale_factor = 1.0
        self._offset = QPointF(0, 0)
        self.update()

    def wheelEvent(self, event):
        if not self._pixmap:
            return
        # Zoom in or out
        angle = event.angleDelta().y()
        zoom_step = 1.1 if angle > 0 else 0.9
        
        # Calculate cursor position relative to the image
        cursor_pos = event.position()
        
        # Adjust offset so zooming centers on the mouse cursor
        self._offset = cursor_pos - (cursor_pos - self._offset) * zoom_step
        self._scale_factor *= zoom_step
        
        # Clamp scale factor to reasonable limits
        self._scale_factor = max(0.1, min(self._scale_factor, 10.0))
        self.update()

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._last_mouse_pos = event.position()

    def mouseMoveEvent(self, event):
        if event.buttons() & Qt.MouseButton.LeftButton:
            delta = event.position() - self._last_mouse_pos
            self._offset += delta
            self._last_mouse_pos = event.position()
            self.update()

    def paintEvent(self, event):
        if not self._pixmap:
            return
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        
        # We start by drawing the pixmap scaled to fit the window (if scale factor is 1)
        # To do this correctly while allowing zoom/pan, we calculate the base scale to fit:
        base_scaled = self._pixmap.scaled(self.size(), Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
        
        base_x = (self.width() - base_scaled.width()) / 2
        base_y = (self.height() - base_scaled.height()) / 2
        
        painter.translate(self._offset)
        painter.scale(self._scale_factor, self._scale_factor)
        
        # When zoomed in, we still draw from the base centered position
        # so that it stays relative
        painter.drawPixmap(int(base_x), int(base_y), base_scaled)

class ViewerWindow(QMainWindow):
    def __init__(self, file_url, file_name, parent=None):
        super().__init__(parent)
        self.file_url = file_url
        self.setWindowTitle(f"MediaHub Viewer - {file_name}")
        self.resize(800, 600)
        self.setStyleSheet("""
            QMainWindow { background-color: #121212; color: #FFFFFF; }
            QWidget { font-family: 'Inter', 'Segoe UI', sans-serif; font-size: 14px; }
            QLabel { color: #E0E0E0; }
            QTextEdit { background-color: #1E1E1E; color: #E0E0E0; border: 1px solid #333; padding: 10px; }
            QPushButton { background-color: #BB86FC; color: #000; border: none; border-radius: 6px; padding: 10px 20px; font-weight: bold; }
            QPushButton:hover { background-color: #9965f4; }
        """)
        
        self.central_widget = QWidget()
        self.setCentralWidget(self.central_widget)
        self.layout = QVBoxLayout(self.central_widget)
        self.layout.setContentsMargins(10,10,10,10)
        
        ext = file_name.split('.')[-1].lower()
        if ext in ['png', 'jpg', 'jpeg', 'gif', 'webp']:
            self.show_image()
        elif ext in ['mp4', 'webm', 'mov', 'mkv']:
            self.show_video()
        elif ext in ['txt', 'md', 'csv', 'py', 'json', 'log']:
            self.show_text()
        elif ext in ['pdf']:
            self.show_pdf()
        else:
            lbl = QLabel("Unsupported file type for internal viewer.")
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.layout.addWidget(lbl)
            
    def show_image(self):
        import requests
        self.lbl = ScalableImageLabel()
        self.layout.addWidget(self.lbl)
        
        try:
            res = requests.get(self.file_url)
            qimg = QImage.fromData(res.content)
            self.pixmap = QPixmap.fromImage(qimg)
            self.lbl.setPixmap(self.pixmap)
        except Exception as e:
            err = QLabel(f"Failed to load image: {e}")
            self.layout.addWidget(err)
        
    def show_text(self):
        import requests
        txt = QTextEdit()
        txt.setReadOnly(True)
        try:
            res = requests.get(self.file_url)
            txt.setText(res.content.decode('utf-8', errors='replace'))
        except Exception as e:
            txt.setText(f"Error reading text file: {e}")
        self.layout.addWidget(txt)
        
    def show_video(self):
        try:
            from PyQt6.QtMultimedia import QMediaPlayer, QAudioOutput
            from PyQt6.QtMultimediaWidgets import QVideoWidget
        except ImportError:
            lbl = QLabel("QtMultimedia is not available on this system.")
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.layout.addWidget(lbl)
            return

        self.video_widget = QVideoWidget()
        self.layout.addWidget(self.video_widget)
        
        self.player = QMediaPlayer()
        self.audio_output = QAudioOutput()
        self.audio_output.setVolume(1.0)
        
        self.player.setAudioOutput(self.audio_output)
        self.player.setVideoOutput(self.video_widget)
        self.player.setSource(QUrl(self.file_url))
        
        from PyQt6.QtWidgets import QSlider
        
        # Seek Bar & Time
        seek_layout = QHBoxLayout()
        self.time_lbl = QLabel("00:00 / 00:00")
        self.seek_slider = QSlider(Qt.Orientation.Horizontal)
        self.seek_slider.setRange(0, 0)
        self.seek_slider.sliderMoved.connect(self.set_position)
        
        self.player.positionChanged.connect(self.position_changed)
        self.player.durationChanged.connect(self.duration_changed)
        
        seek_layout.addWidget(self.time_lbl)
        seek_layout.addWidget(self.seek_slider)
        self.layout.addLayout(seek_layout)
        
        # Controls & Volume
        controls = QHBoxLayout()
        play_btn = QPushButton("Play / Pause")
        play_btn.clicked.connect(self.toggle_play)
        
        vol_lbl = QLabel("Volume:")
        self.vol_slider = QSlider(Qt.Orientation.Horizontal)
        self.vol_slider.setRange(0, 100)
        self.vol_slider.setValue(100)
        self.vol_slider.valueChanged.connect(self.set_volume)
        
        controls.addWidget(play_btn)
        controls.addStretch()
        controls.addWidget(vol_lbl)
        controls.addWidget(self.vol_slider)
        
        self.layout.addLayout(controls)
        self.player.play()

    def set_position(self, position):
        self.player.setPosition(position)

    def position_changed(self, position):
        self.seek_slider.setValue(position)
        self.update_time_label()

    def duration_changed(self, duration):
        self.seek_slider.setRange(0, duration)
        self.update_time_label()

    def update_time_label(self):
        pos = self.player.position() // 1000
        dur = self.player.duration() // 1000
        self.time_lbl.setText(f"{pos//60:02d}:{pos%60:02d} / {dur//60:02d}:{dur%60:02d}")

    def set_volume(self, volume):
        self.audio_output.setVolume(volume / 100.0)

    def toggle_play(self):
        if hasattr(self, 'player'):
            from PyQt6.QtMultimedia import QMediaPlayer
            if self.player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
                self.player.pause()
            else:
                self.player.play()

    def keyPressEvent(self, event):
        if not hasattr(self, 'player'):
            super().keyPressEvent(event)
            return

        key = event.key()
        if key in (Qt.Key.Key_Up, Qt.Key.Key_Down):
            vol = self.vol_slider.value()
            new_vol = vol + 5 if key == Qt.Key.Key_Up else vol - 5
            new_vol = max(0, min(100, new_vol))
            self.vol_slider.setValue(new_vol)
            self.show_overlay(f"Volume: {new_vol}%")
        elif key in (Qt.Key.Key_Left, Qt.Key.Key_Right):
            pos = self.player.position()
            dur = self.player.duration()
            offset = 10000 if key == Qt.Key.Key_Right else -10000
            new_pos = max(0, min(dur, pos + offset))
            self.player.setPosition(new_pos)
            sign = "+10s" if offset > 0 else "-10s"
            self.show_overlay(f"Seek: {sign}")
        else:
            super().keyPressEvent(event)

    def show_overlay(self, text):
        if not hasattr(self, 'overlay_lbl'):
            # On macOS, native video renderer draws over child widgets.
            # Solution: create a separate frameless, always-on-top window.
            self.overlay_lbl = QLabel()
            self.overlay_lbl.setWindowFlags(
                Qt.WindowType.FramelessWindowHint |
                Qt.WindowType.WindowStaysOnTopHint |
                Qt.WindowType.Tool
            )
            self.overlay_lbl.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
            self.overlay_lbl.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
            self.overlay_lbl.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
            self.overlay_lbl.setStyleSheet("""
                QLabel {
                    color: white;
                    background-color: rgba(0, 0, 0, 180);
                    padding: 12px 18px;
                    border-radius: 8px;
                    font-size: 22px;
                    font-weight: bold;
                }
            """)

            from PyQt6.QtCore import QTimer
            self.overlay_timer = QTimer(self)
            self.overlay_timer.setSingleShot(True)
            self.overlay_timer.timeout.connect(self.overlay_lbl.hide)

        self.overlay_lbl.setText(text)
        self.overlay_lbl.adjustSize()

        # Position over the video widget using global screen coordinates
        global_pos = self.video_widget.mapToGlobal(self.video_widget.rect().topLeft())
        self.overlay_lbl.move(global_pos.x() + 20, global_pos.y() + 20)
        self.overlay_lbl.show()
        self.overlay_lbl.raise_()
        self.overlay_timer.start(1500)
            
    def show_pdf(self):
        if QWebEngineView is None:
            lbl = QLabel("PyQt6-WebEngine is not installed.\nPlease run: pip install PyQt6-WebEngine")
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.layout.addWidget(lbl)
            return
            
        self.web = QWebEngineView()
        self.web.load(QUrl(self.file_url))
        self.layout.addWidget(self.web)
        
    def closeEvent(self, event):
        if hasattr(self, 'player'):
            self.player.stop()
            self.player.setSource(QUrl(""))
        if hasattr(self, 'web') and self.web is not None:
            self.web.load(QUrl(""))
            
        super().closeEvent(event)


class MediaHubApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.proxy = MediaHubProxy(port=18080)
        self.proxy.start()
        self.client = None
        self.current_folder_name = None
        self.current_folder_pid = None
        self.current_folder_key = None
        self.current_files_map = {}
        
        self.setWindowTitle("MediaHub Desktop")
        self.resize(1000, 700)
        self.setStyleSheet("""
            QMainWindow { background-color: #121212; color: #FFFFFF; }
            QWidget { font-family: 'Inter', 'Segoe UI', sans-serif; font-size: 14px; }
            QLabel { color: #E0E0E0; }
            QLineEdit { background-color: #1E1E1E; color: #FFF; border: 1px solid #333; border-radius: 6px; padding: 10px; }
            QLineEdit:focus { border: 1px solid #BB86FC; }
            QPushButton { background-color: #BB86FC; color: #000; border: none; border-radius: 6px; padding: 10px 20px; font-weight: bold; }
            QPushButton:hover { background-color: #9965f4; }
            QPushButton:disabled { background-color: #555; color: #888; }
            QListWidget, QTableWidget { background-color: #1E1E1E; color: #E0E0E0; border: 1px solid #333; border-radius: 6px; }
            QListWidget::item:selected, QTableWidget::item:selected { background-color: #BB86FC; color: #000; }
            QHeaderView::section { background-color: #1E1E1E; color: #BB86FC; padding: 5px; border: none; font-weight: bold; }
            QTableWidget QTableCornerButton::section { background-color: #1E1E1E; }
        """)
        
        self.stack = QStackedWidget()
        self.setCentralWidget(self.stack)
        
        self.init_login_ui()
        self.init_main_ui()
        
        # Try auto-login with saved credentials
        creds = self.load_credentials()
        if creds:
            self.url_input.setText(creds.get('url', ''))
            self.user_input.setText(creds.get('user', ''))
            self.pass_input.setText(creds.get('password', ''))
            self.stack.setCurrentIndex(0)
            self.do_login()
        else:
            self.stack.setCurrentIndex(0)

    def load_credentials(self):
        try:
            if os.path.exists(CREDENTIALS_FILE):
                with open(CREDENTIALS_FILE, 'r') as f:
                    return json.load(f)
        except Exception:
            pass
        return None

    def save_credentials(self, url, user, password):
        try:
            with open(CREDENTIALS_FILE, 'w') as f:
                json.dump({'url': url, 'user': user, 'password': password}, f)
        except Exception:
            pass

    def clear_credentials(self):
        try:
            if os.path.exists(CREDENTIALS_FILE):
                os.remove(CREDENTIALS_FILE)
        except Exception:
            pass

    def init_login_ui(self):
        login_widget = QWidget()
        layout = QVBoxLayout()
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        title = QLabel("MediaHub")
        title.setStyleSheet("font-size: 32px; font-weight: bold; color: #BB86FC; margin-bottom: 20px;")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("Server Address (e.g., https://localhost:443)")
        self.url_input.setFixedWidth(300)
        
        self.user_input = QLineEdit()
        self.user_input.setPlaceholderText("Username")
        self.user_input.setFixedWidth(300)
        
        self.pass_input = QLineEdit()
        self.pass_input.setPlaceholderText("Password")
        self.pass_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.pass_input.setFixedWidth(300)
        
        self.login_btn = QPushButton("Login")
        self.login_btn.setFixedWidth(300)
        self.login_btn.clicked.connect(self.do_login)
        
        self.status_label = QLabel("")
        self.status_label.setStyleSheet("color: #CF6679;")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        layout.addWidget(title)
        layout.addWidget(self.url_input)
        layout.addWidget(self.user_input)
        layout.addWidget(self.pass_input)
        layout.addWidget(self.login_btn)
        layout.addWidget(self.status_label)
        
        login_widget.setLayout(layout)
        self.stack.addWidget(login_widget)

    def init_main_ui(self):
        main_widget = QWidget()
        layout = QHBoxLayout()
        
        # Sidebar
        sidebar = QWidget()
        sidebar_layout = QVBoxLayout()
        sidebar_layout.setContentsMargins(0,0,0,0)
        sidebar.setFixedWidth(250)
        
        folder_label = QLabel("Folders")
        folder_label.setStyleSheet("font-size: 18px; font-weight: bold; margin-bottom: 10px; color: #BB86FC;")
        
        self.folder_list = QListWidget()
        self.folder_list.itemClicked.connect(self.on_folder_selected)
        
        btn_layout = QHBoxLayout()
        self.new_folder_btn = QPushButton("New Folder")
        self.new_folder_btn.clicked.connect(self.do_create_folder)
        self.refresh_fld_btn = QPushButton("Refresh")
        self.refresh_fld_btn.clicked.connect(self.do_fetch_folders)
        btn_layout.addWidget(self.new_folder_btn)
        btn_layout.addWidget(self.refresh_fld_btn)
        
        self.logout_btn = QPushButton("Logout")
        self.logout_btn.setStyleSheet("background-color: #333; color: #CF6679; font-size: 12px; padding: 6px;")
        self.logout_btn.clicked.connect(self.do_logout)
        
        sidebar_layout.addWidget(folder_label)
        sidebar_layout.addWidget(self.folder_list)
        sidebar_layout.addLayout(btn_layout)
        sidebar_layout.addWidget(self.logout_btn)
        sidebar.setLayout(sidebar_layout)
        
        # Main Area
        content = QWidget()
        content_layout = QVBoxLayout()
        content_layout.setContentsMargins(15,0,0,0)
        
        self.current_folder_label = QLabel("Select a folder")
        self.current_folder_label.setStyleSheet("font-size: 24px; font-weight: bold; margin-bottom: 10px;")
        
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search files...")
        self.search_input.textChanged.connect(self.filter_files)
        
        self.file_table = QTableWidget(0, 3)
        self.file_table.setHorizontalHeaderLabels(["", "Filename", "Size"])
        self.file_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Fixed)
        self.file_table.setColumnWidth(0, 80)
        self.file_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.file_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self.file_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.file_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.file_table.itemDoubleClicked.connect(self.do_view_file)
        self.file_table.setSortingEnabled(True)
        self.file_table.horizontalHeader().setSortIndicator(-1, Qt.SortOrder.AscendingOrder)
        self.file_table.verticalHeader().setDefaultSectionSize(70)
        self.file_table.verticalHeader().hide()
        # Disable sorting on thumbnail column (col 0)
        self.file_table.horizontalHeader().sectionClicked.connect(
            lambda col: self.file_table.horizontalHeader().setSortIndicator(-1, Qt.SortOrder.AscendingOrder) if col == 0 else None
        )
        
        action_layout = QHBoxLayout()
        self.upload_btn = QPushButton("Upload Files")
        self.upload_btn.clicked.connect(self.do_upload)
        self.upload_dir_btn = QPushButton("Upload Directory")
        self.upload_dir_btn.clicked.connect(self.do_upload_dir)
        self.download_btn = QPushButton("Download Selected")
        self.download_btn.clicked.connect(self.do_download)
        self.view_btn = QPushButton("View File")
        self.view_btn.clicked.connect(self.do_view_file)
        
        action_layout.addWidget(self.upload_btn)
        action_layout.addWidget(self.upload_dir_btn)
        action_layout.addWidget(self.download_btn)
        action_layout.addWidget(self.view_btn)
        action_layout.addStretch()
        
        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        self.progress_bar.setTextVisible(False)
        self.progress_bar.setStyleSheet("""
            QProgressBar { border: 1px solid #333; border-radius: 5px; background-color: #1E1E1E; height: 10px; }
            QProgressBar::chunk { background-color: #BB86FC; border-radius: 5px; }
        """)
        
        content_layout.addWidget(self.current_folder_label)
        content_layout.addWidget(self.search_input)
        content_layout.addWidget(self.file_table)
        content_layout.addLayout(action_layout)
        content_layout.addWidget(self.progress_bar)
        content.setLayout(content_layout)
        
        layout.addWidget(sidebar)
        layout.addWidget(content)
        main_widget.setLayout(layout)
        self.stack.addWidget(main_widget)

    def filter_files(self, text):
        import unicodedata
        search_text = unicodedata.normalize('NFC', text).lower()
        for row in range(self.file_table.rowCount()):
            item = self.file_table.item(row, 1)  # column 1 = filename
            if item:
                item_text = unicodedata.normalize('NFC', item.text()).lower()
                self.file_table.setRowHidden(row, search_text not in item_text)

    def do_login(self):
        url = self.url_input.text().strip()
        user = self.user_input.text().strip()
        pw = self.pass_input.text()
        
        if not url or not user or not pw:
            self.status_label.setText("Please fill all fields")
            return
            
        self.login_btn.setEnabled(False)
        self.status_label.setText("Authenticating...")
        
        self.client = MediaHubClient(url, user, pw)
        self.worker = LoginWorker(self.client)
        self.worker.success.connect(self.on_login_success)
        self.worker.error.connect(self.on_login_error)
        self.worker.start()

    def on_login_success(self):
        # Save credentials for next launch
        self.save_credentials(
            self.url_input.text().strip(),
            self.user_input.text().strip(),
            self.pass_input.text()
        )
        self.stack.setCurrentIndex(1)
        self.do_fetch_folders()

    def on_login_error(self, err):
        self.login_btn.setEnabled(True)
        self.status_label.setText(f"Error: {err}")

    def do_logout(self):
        self.clear_credentials()
        self.client = None
        self.folder_list.clear()
        self.file_table.setRowCount(0)
        self.pass_input.clear()
        self.stack.setCurrentIndex(0)
        self.login_btn.setEnabled(True)
        self.status_label.setText("")

    def do_fetch_folders(self):
        self.folder_list.clear()
        self.worker = FetchFoldersWorker(self.client)
        self.worker.success.connect(self.on_folders_fetched)
        self.worker.error.connect(lambda e: QMessageBox.critical(self, "Error", f"Failed to fetch folders: {e}"))
        self.worker.start()

    def on_folders_fetched(self, folders):
        self.folder_list.clear()
        for f in folders.keys():
            self.folder_list.addItem(f)

    def do_create_folder(self):
        name, ok = QInputDialog.getText(self, "New Folder", "Folder Name:")
        if ok and name:
            try:
                self.client.create_folder(name)
                self.do_fetch_folders()
            except Exception as e:
                QMessageBox.critical(self, "Error", str(e))

    def on_folder_selected(self, item):
        self.current_folder_name = item.text()
        self.current_folder_label.setText(f"Folder: {self.current_folder_name}")
        self.file_table.setRowCount(0)
        
        self.worker = FetchFilesWorker(self.client, self.current_folder_name)
        self.worker.success.connect(self.on_files_fetched)
        self.worker.error.connect(lambda e: QMessageBox.critical(self, "Error", f"Failed to fetch files: {e}"))
        self.worker.start()

    def format_size(self, size):
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024.0:
                return f"{size:.1f} {unit}" if unit != 'B' else f"{size} {unit}"
            size /= 1024.0
        return f"{size:.1f} PB"

    def on_files_fetched(self, pid, key, files):
        self.current_folder_pid = pid
        self.current_folder_key = key
        self.current_files_map = files
        self.proxy.update_context(self.client, files)
        self._thumb_workers = []  # keep references to prevent GC
        
        self.file_table.setSortingEnabled(False)
        self.file_table.setRowCount(0)
        from mediahub_core import Opsec
        
        IMAGE_EXTS = {'jpg', 'jpeg', 'png', 'gif', 'webp'}
        VIDEO_EXTS = {'mp4', 'webm', 'mov', 'mkv'}
        TEXT_EXTS  = {'txt', 'md', 'csv', 'py', 'json', 'log'}
        PDF_EXTS   = {'pdf'}
        
        for name, info in files.items():
            sz = Opsec.DecodeInt(info[44:52], False)
            row = self.file_table.rowCount()
            self.file_table.insertRow(row)
            self.file_table.setRowHeight(row, 70)
            
            # Placeholder thumbnail widget
            thumb_lbl = QLabel()
            thumb_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
            
            if ext in IMAGE_EXTS | VIDEO_EXTS:
                # Will be replaced by real thumbnail asynchronously
                thumb_lbl.setText("⏳")
                thumb_lbl.setStyleSheet("color:#888; font-size:22px;")
                file_key = info[:44]
                file_pid = self.client.get_obj_pid(file_key)
                w = ThumbnailWorker(self.client, pid, file_pid, file_key, row)
                w.success.connect(self.on_thumbnail_ready)
                w.start()
                self._thumb_workers.append(w)
            elif ext in PDF_EXTS:
                thumb_lbl.setText("📄")
                thumb_lbl.setStyleSheet("font-size:32px;")
            elif ext in TEXT_EXTS:
                thumb_lbl.setText("📝")
                thumb_lbl.setStyleSheet("font-size:32px;")
            else:
                thumb_lbl.setText("📁")
                thumb_lbl.setStyleSheet("font-size:32px;")
            
            self.file_table.setCellWidget(row, 0, thumb_lbl)
            
            # Invisible dummy item for column 0 to allow sorting row selection
            self.file_table.setItem(row, 0, SortableTableItem(""))
            
            name_item = SortableTableItem(name)
            name_item.setData(Qt.ItemDataRole.UserRole, name.lower())
            
            size_item = SortableTableItem(self.format_size(sz))
            size_item.setData(Qt.ItemDataRole.UserRole, sz)
            
            self.file_table.setItem(row, 1, name_item)
            self.file_table.setItem(row, 2, size_item)
            
        self.file_table.setSortingEnabled(True)
        # Re-apply filter if text exists
        self.filter_files(self.search_input.text())

    def on_thumbnail_ready(self, row, pixmap):
        thumb_lbl = self.file_table.cellWidget(row, 0)
        if thumb_lbl:
            scaled = pixmap.scaled(68, 68, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            thumb_lbl.setPixmap(scaled)

    def set_loading(self, loading=True):
        self.upload_btn.setEnabled(not loading)
        self.upload_dir_btn.setEnabled(not loading)
        self.download_btn.setEnabled(not loading)
        self.view_btn.setEnabled(not loading)
        self.progress_bar.setVisible(loading)
        if loading:
            self.progress_bar.setRange(0, 0) # Indeterminate

    def do_upload(self):
        if not self.current_folder_name:
            QMessageBox.warning(self, "Warning", "Select a folder first")
            return
            
        files, _ = QFileDialog.getOpenFileNames(self, "Select Files to Upload")
        if files:
            self.set_loading(True)
            self.worker = UploadWorker(self.client, self.current_folder_pid, self.current_folder_key, self.current_files_map, files)
            self.worker.success.connect(self.on_upload_success)
            self.worker.error.connect(self.on_op_error)
            self.worker.start()

    def do_upload_dir(self):
        if not self.current_folder_name:
            QMessageBox.warning(self, "Warning", "Select a folder first")
            return
            
        dir_path = QFileDialog.getExistingDirectory(self, "Select Directory to Upload")
        if dir_path:
            files = [os.path.join(dir_path, f) for f in os.listdir(dir_path) if os.path.isfile(os.path.join(dir_path, f))]
            if files:
                self.set_loading(True)
                self.worker = UploadWorker(self.client, self.current_folder_pid, self.current_folder_key, self.current_files_map, files)
                self.worker.success.connect(self.on_upload_success)
                self.worker.error.connect(self.on_op_error)
                self.worker.start()

    def on_upload_success(self):
        self.set_loading(False)
        QMessageBox.information(self, "Success", "Upload complete!")
        self.on_folder_selected(self.folder_list.currentItem()) # refresh

    def do_download(self):
        if not self.current_folder_name:
            QMessageBox.warning(self, "Warning", "Select a folder first")
            return
            
        selected_rows = self.file_table.selectionModel().selectedRows()
        if not selected_rows:
            QMessageBox.warning(self, "Warning", "Select files to download")
            return
            
        out_dir = QFileDialog.getExistingDirectory(self, "Select Download Directory")
        if out_dir:
            self.set_loading(True)
            # Just downloading the first selected one for now to keep it simple, or we can queue them
            # We will just download the first one for demonstration
            row = selected_rows[0].row()
            file_name = self.file_table.item(row, 1).text()  # column 1 = filename
            fl_info = self.current_files_map[file_name]
            
            self.worker = DownloadWorker(self.client, self.current_folder_pid, fl_info, file_name, out_dir)
            self.worker.success.connect(self.on_download_success)
            self.worker.error.connect(self.on_op_error)
            self.worker.start()

    def on_download_success(self, out_path):
        self.set_loading(False)
        QMessageBox.information(self, "Success", f"Downloaded to:\n{out_path}")

    def do_view_file(self):
        if not self.current_folder_name:
            QMessageBox.warning(self, "Warning", "Select a folder first")
            return
            
        selected_rows = self.file_table.selectionModel().selectedRows()
        if not selected_rows:
            QMessageBox.warning(self, "Warning", "Select a file to view")
            return
            
        row = selected_rows[0].row()
        file_name = self.file_table.item(row, 1).text()  # column 1 = filename
        
        encoded_name = urllib.parse.quote(file_name)
        stream_url = f"http://127.0.0.1:18080/stream/{self.current_folder_pid}/{encoded_name}"
        
        self.viewer = ViewerWindow(stream_url, file_name, parent=self)
        self.viewer.show()

    def on_op_error(self, err):
        self.set_loading(False)
        QMessageBox.critical(self, "Error", str(err))
        
    def closeEvent(self, event):
        self.proxy.stop()
        super().closeEvent(event)

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MediaHubApp()
    window.show()
    sys.exit(app.exec())
