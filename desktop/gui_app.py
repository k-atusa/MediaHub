import sys
import os
from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, 
                             QLabel, QLineEdit, QPushButton, QListWidget, QListWidgetItem, 
                             QStackedWidget, QFileDialog, QMessageBox, QInputDialog, QTableWidget,
                             QTableWidgetItem, QHeaderView, QProgressBar, QTextEdit)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QUrl
from PyQt6.QtGui import QFont, QIcon, QColor, QPixmap
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


class ViewerWindow(QMainWindow):
    def __init__(self, file_path, file_name, parent=None):
        super().__init__(parent)
        self.file_path = file_path
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
        self.lbl = QLabel()
        self.pixmap = QPixmap(self.file_path)
        self.lbl.setPixmap(self.pixmap.scaled(self.size(), Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        self.lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.layout.addWidget(self.lbl)
        
    def resizeEvent(self, event):
        if hasattr(self, 'lbl') and hasattr(self, 'pixmap'):
            self.lbl.setPixmap(self.pixmap.scaled(self.size(), Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        super().resizeEvent(event)
        
    def show_text(self):
        txt = QTextEdit()
        txt.setReadOnly(True)
        try:
            with open(self.file_path, 'r', encoding='utf-8') as f:
                txt.setText(f.read())
        except Exception as e:
            txt.setText(f"Error reading text file: {e}")
        self.layout.addWidget(txt)
        
    def show_video(self):
        self.video_lbl = QLabel()
        self.video_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.layout.addWidget(self.video_lbl)
        
        import cv2
        from PyQt6.QtCore import QTimer
        self.cap = cv2.VideoCapture(self.file_path)
        fps = self.cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0: fps = 30
        
        self.timer = QTimer()
        self.timer.timeout.connect(self.next_frame)
        self.timer.start(int(1000 / fps))
        
        controls = QHBoxLayout()
        play_btn = QPushButton("Play/Pause")
        play_btn.clicked.connect(self.toggle_play)
        controls.addWidget(play_btn)
        
        self.layout.addLayout(controls)

    def next_frame(self):
        import cv2
        from PyQt6.QtGui import QImage, QPixmap
        ret, frame = self.cap.read()
        if ret:
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            h, w, ch = frame.shape
            bytes_per_line = ch * w
            qimg = QImage(frame.data, w, h, bytes_per_line, QImage.Format.Format_RGB888)
            pixmap = QPixmap.fromImage(qimg)
            self.video_lbl.setPixmap(pixmap.scaled(self.size(), Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        else:
            self.timer.stop()
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0) # Loop or just stop

    def toggle_play(self):
        if hasattr(self, 'timer'):
            if self.timer.isActive():
                self.timer.stop()
            else:
                self.timer.start()
            
    def show_pdf(self):
        if QWebEngineView is None:
            lbl = QLabel("PyQt6-WebEngine is not installed.\nPlease run: pip install PyQt6-WebEngine")
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.layout.addWidget(lbl)
            return
            
        self.web = QWebEngineView()
        self.web.load(QUrl.fromLocalFile(self.file_path))
        self.layout.addWidget(self.web)
        
    def closeEvent(self, event):
        if hasattr(self, 'timer'):
            self.timer.stop()
        if hasattr(self, 'cap'):
            self.cap.release()
        if hasattr(self, 'web') and self.web is not None:
            self.web.load(QUrl(""))
        
        # Delete temporary file securely when viewer is closed
        if os.path.exists(self.file_path):
            try:
                os.remove(self.file_path)
            except Exception as e:
                print(f"Failed to delete temp file: {e}")
        super().closeEvent(event)


class MediaHubApp(QMainWindow):
    def __init__(self):
        super().__init__()
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
        
        self.stack.setCurrentIndex(0)

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
        
        sidebar_layout.addWidget(folder_label)
        sidebar_layout.addWidget(self.folder_list)
        sidebar_layout.addLayout(btn_layout)
        sidebar.setLayout(sidebar_layout)
        
        # Main Area
        content = QWidget()
        content_layout = QVBoxLayout()
        content_layout.setContentsMargins(15,0,0,0)
        
        self.current_folder_label = QLabel("Select a folder")
        self.current_folder_label.setStyleSheet("font-size: 24px; font-weight: bold; margin-bottom: 10px;")
        
        self.file_table = QTableWidget(0, 2)
        self.file_table.setHorizontalHeaderLabels(["Filename", "Size (Bytes)"])
        self.file_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.file_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.file_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.file_table.itemDoubleClicked.connect(self.do_view_file)
        
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
        content_layout.addWidget(self.file_table)
        content_layout.addLayout(action_layout)
        content_layout.addWidget(self.progress_bar)
        content.setLayout(content_layout)
        
        layout.addWidget(sidebar)
        layout.addWidget(content)
        main_widget.setLayout(layout)
        self.stack.addWidget(main_widget)

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
        self.stack.setCurrentIndex(1)
        self.do_fetch_folders()

    def on_login_error(self, err):
        self.login_btn.setEnabled(True)
        self.status_label.setText(f"Error: {err}")

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

    def on_files_fetched(self, pid, key, files):
        self.current_folder_pid = pid
        self.current_folder_key = key
        self.current_files_map = files
        
        self.file_table.setRowCount(0)
        from mediahub_core import Opsec
        for name, info in files.items():
            sz = Opsec.DecodeInt(info[44:52], False)
            row = self.file_table.rowCount()
            self.file_table.insertRow(row)
            self.file_table.setItem(row, 0, QTableWidgetItem(name))
            self.file_table.setItem(row, 1, QTableWidgetItem(str(sz)))

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
            file_name = self.file_table.item(row, 0).text()
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
            
        self.set_loading(True)
        row = selected_rows[0].row()
        file_name = self.file_table.item(row, 0).text()
        fl_info = self.current_files_map[file_name]
        
        import tempfile
        out_dir = tempfile.gettempdir()
        
        self.worker = DownloadWorker(self.client, self.current_folder_pid, fl_info, file_name, out_dir)
        self.worker.success.connect(self.on_view_download_success)
        self.worker.error.connect(self.on_op_error)
        self.worker.start()

    def on_view_download_success(self, out_path):
        self.set_loading(False)
        self.viewer = ViewerWindow(out_path, os.path.basename(out_path), parent=self)
        self.viewer.show()

    def on_op_error(self, err):
        self.set_loading(False)
        QMessageBox.critical(self, "Error", str(err))

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MediaHubApp()
    window.show()
    sys.exit(app.exec())
