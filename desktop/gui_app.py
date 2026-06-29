import sys
import os
import json
import unicodedata
import urllib.parse
from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                             QLabel, QLineEdit, QPushButton, QListWidget, QListWidgetItem,
                             QStackedWidget, QFileDialog, QMessageBox, QInputDialog, QTableWidget,
                             QTableWidgetItem, QHeaderView, QProgressBar, QTextEdit, QSlider,
                             QStyle, QCheckBox)
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

from mediahub_core import MHClient
from mediahub_proxy import MHProxy
import Opsec

try:
    import keyring
    HAS_KEYRING = True
except ImportError:
    HAS_KEYRING = False

KR_SVC = "mediahub"
KR_ACC = "session"


# --- Utility Widgets ---

class SortItem(QTableWidgetItem):
    def __lt__(self, other):
        d1 = self.data(Qt.ItemDataRole.UserRole)
        d2 = other.data(Qt.ItemDataRole.UserRole)
        if d1 is not None and d2 is not None:
            return d1 < d2
        return super().__lt__(other)


class ClickSldr(QSlider):
    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            val = QStyle.sliderValueFromPosition(
                self.minimum(), self.maximum(),
                int(event.position().x()), self.width())
            self.setValue(val)
            self.sliderMoved.emit(val)
        super().mousePressEvent(event)


class ScaleLabel(QLabel):
    zoomChanged = pyqtSignal(float)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._pm = None
        self._sc = 1.0
        self._off = QPointF(0, 0)
        self._last = QPointF(0, 0)
        from PyQt6.QtWidgets import QSizePolicy
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

    def setPixmap(self, pm):
        self._pm = pm
        self._sc = 1.0
        self._off = QPointF(0, 0)
        self.zoomChanged.emit(self.totalScale())
        self.update()

    def getFitScale(self):
        if not self._pm or self._pm.width() <= 0 or self._pm.height() <= 0:
            return 1.0
        w_ratio = self.width() / self._pm.width()
        h_ratio = self.height() / self._pm.height()
        return min(w_ratio, h_ratio)

    def totalScale(self):
        return self.getFitScale() * self._sc

    def wheelEvent(self, ev):
        if not self._pm:
            return
        step = 1.1 if ev.angleDelta().y() > 0 else 0.9
        pos = ev.position()
        cx = self.width() / 2.0
        cy = self.height() / 2.0
        mouse_from_center = pos - QPointF(cx, cy)
        
        self._off = mouse_from_center - (mouse_from_center - self._off) * step
        self._sc = max(0.1, min(self._sc * step, 10.0))
        self.zoomChanged.emit(self.totalScale())
        self.update()

    def mousePressEvent(self, ev):
        if ev.button() == Qt.MouseButton.LeftButton:
            self._last = ev.position()

    def mouseMoveEvent(self, ev):
        if ev.buttons() & Qt.MouseButton.LeftButton:
            self._off += ev.position() - self._last
            self._last = ev.position()
            self.update()

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        if self._pm:
            self.zoomChanged.emit(self.totalScale())

    def paintEvent(self, ev):
        if not self._pm:
            return
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        
        fit_scale = self.getFitScale()
        total_scale = fit_scale * self._sc
        
        cx = self.width() / 2.0
        cy = self.height() / 2.0
        
        p.translate(cx + self._off.x(), cy + self._off.y())
        p.scale(total_scale, total_scale)
        
        px = -self._pm.width() / 2.0
        py = -self._pm.height() / 2.0
        
        p.drawPixmap(QPointF(px, py), self._pm)

    def zoomIn(self):
        if not self._pm:
            return
        self.zoomTo(self._sc * 1.2)

    def zoomOut(self):
        if not self._pm:
            return
        self.zoomTo(self._sc / 1.2)

    def zoomTo(self, target_sc):
        target_sc = max(0.1, min(target_sc, 10.0))
        self._off = self._off * (target_sc / self._sc)
        self._sc = target_sc
        self.zoomChanged.emit(self.totalScale())
        self.update()

    def resetZoom(self):
        self._sc = 1.0
        self._off = QPointF(0, 0)
        self.zoomChanged.emit(self.totalScale())
        self.update()

    def originalSize(self):
        if not self._pm:
            return
        fit_scale = self.getFitScale()
        if fit_scale > 0:
            self.zoomTo(1.0 / fit_scale)
            self._off = QPointF(0, 0)
            self.update()


# --- Worker Threads ---

class WkBase(QThread):
    error = pyqtSignal(str)


class WkLogin(WkBase):
    success = pyqtSignal()

    def __init__(self, cli):
        super().__init__()
        self.cli = cli

    def run(self):
        try:
            self.cli.auth()
            self.success.emit()
        except Exception as e:
            self.error.emit(str(e))


class WkFlds(WkBase):
    success = pyqtSignal(dict)

    def __init__(self, cli):
        super().__init__()
        self.cli = cli

    def run(self):
        try:
            self.success.emit(self.cli.getFlds())
        except Exception as e:
            self.error.emit(str(e))


class WkFiles(WkBase):
    success = pyqtSignal(str, bytes, dict)

    def __init__(self, cli, name):
        super().__init__()
        self.cli = cli
        self.name = name

    def run(self):
        try:
            pid, key, files = self.cli.getFiles(self.name)
            self.success.emit(pid, key, files)
        except Exception as e:
            self.error.emit(str(e))


class WkUpload(WkBase):
    success = pyqtSignal()
    progress = pyqtSignal(int, int, float)

    def __init__(self, cli, fPid, fKey, flMap, paths):
        super().__init__()
        self.cli = cli
        self.fPid = fPid
        self.fKey = fKey
        self.flMap = flMap
        self.paths = paths

    def run(self):
        try:
            for fp in self.paths:
                self.cli.upFile(
                    self.fPid, self.fKey, self.flMap, fp,
                    progCb=lambda s, t, spd: self.progress.emit(s, t, spd))
            self.success.emit()
        except Exception as e:
            self.error.emit(str(e))


class WkDown(WkBase):
    success = pyqtSignal(str)

    def __init__(self, cli, fPid, flInfo, name, outDir):
        super().__init__()
        self.cli = cli
        self.fPid = fPid
        self.flInfo = flInfo
        self.name = name
        self.outDir = outDir

    def run(self):
        try:
            self.success.emit(self.cli.dnFile(self.fPid, self.flInfo, self.name, self.outDir))
        except Exception as e:
            self.error.emit(str(e))


class WkThumb(WkBase):
    success = pyqtSignal(str, bytes)  # fpid, raw image bytes

    def __init__(self, cli, fPid, fpid, fkBytes):
        super().__init__()
        self.cli = cli
        self.fPid = fPid
        self.fpid = fpid
        self.fkBytes = fkBytes

    def run(self):
        try:
            import requests
            import Bencrypt
            url = f"{self.cli.url}/api/media/{self.fPid}/{self.fpid}/thumb"
            res = requests.get(url, verify=False)
            if res.status_code == 200 and res.content:
                sm = Bencrypt.SymMaster("gcm1", self.fkBytes[:32])
                raw = sm.DeBin(res.content)
                if raw:
                    self.success.emit(self.fpid, raw)
        except Exception:
            pass


# --- Viewer Window ---

class Viewer(QMainWindow):
    def __init__(self, fileUrl, fileName, parent=None):
        super().__init__(parent)
        self.fileUrl = fileUrl
        self.setWindowTitle(f"MediaHub - {fileName}")
        self.resize(800, 600)
        self.setStyleSheet("""
            QMainWindow { background-color: #121212; color: #FFFFFF; }
            QWidget { font-family: 'Inter', 'Segoe UI', sans-serif; font-size: 14px; }
            QLabel { color: #E0E0E0; }
            QTextEdit { background-color: #1E1E1E; color: #E0E0E0; border: 1px solid #333; padding: 10px; }
            QPushButton { background-color: #BB86FC; color: #000; border: none; border-radius: 6px; padding: 10px 20px; font-weight: bold; }
            QPushButton:hover { background-color: #9965f4; }
        """)

        self.cw = QWidget()
        self.setCentralWidget(self.cw)
        self.lay = QVBoxLayout(self.cw)
        self.lay.setContentsMargins(10, 10, 10, 10)

        ext = fileName.split('.')[-1].lower()
        if ext in ['png', 'jpg', 'jpeg', 'gif', 'webp']:
            self._showImg()
        elif ext in ['mp4', 'webm', 'mov', 'mkv']:
            self._showVid()
        elif ext in ['txt', 'md', 'csv', 'py', 'json', 'log']:
            self._showTxt()
        elif ext == 'pdf':
            self._showPdf()
        else:
            lbl = QLabel("Unsupported file type for internal viewer.")
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.lay.addWidget(lbl)

    def _showImg(self):
        import requests
        self.lbl = ScaleLabel()
        self.lay.addWidget(self.lbl, 1)

        # zoom UI controls layout
        ctrlLay = QHBoxLayout()
        
        zoomOutBtn = QPushButton("Zoom -")
        zoomOutBtn.clicked.connect(self.lbl.zoomOut)
        
        zoomInBtn = QPushButton("Zoom +")
        zoomInBtn.clicked.connect(self.lbl.zoomIn)
        
        fitBtn = QPushButton("Fit Screen")
        fitBtn.clicked.connect(self.lbl.resetZoom)
        
        origBtn = QPushButton("100% (Original)")
        origBtn.clicked.connect(self.lbl.originalSize)
        
        self.zoomLbl = QLabel("Zoom: 100%")
        self.zoomLbl.setMinimumWidth(100)
        self.zoomLbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        ctrlLay.addWidget(zoomOutBtn)
        ctrlLay.addWidget(zoomInBtn)
        ctrlLay.addWidget(fitBtn)
        ctrlLay.addWidget(origBtn)
        ctrlLay.addWidget(self.zoomLbl)
        ctrlLay.addStretch()
        
        self.lay.addLayout(ctrlLay)
        
        # Connect signal to update zoom label
        self.lbl.zoomChanged.connect(self._updateZoomLbl)

        try:
            res = requests.get(self.fileUrl)
            self.lbl.setPixmap(QPixmap.fromImage(QImage.fromData(res.content)))
        except Exception as e:
            self.lay.addWidget(QLabel(f"Failed to load image: {e}"))

    def _updateZoomLbl(self, scale):
        self.zoomLbl.setText(f"Zoom: {int(scale * 100)}%")

    def _showTxt(self):
        import requests
        txt = QTextEdit()
        txt.setReadOnly(True)
        try:
            res = requests.get(self.fileUrl)
            txt.setText(res.content.decode('utf-8', errors='replace'))
        except Exception as e:
            txt.setText(f"Error: {e}")
        self.lay.addWidget(txt)

    def _showVid(self):
        try:
            from PyQt6.QtMultimedia import QMediaPlayer, QAudioOutput
            from PyQt6.QtMultimediaWidgets import QVideoWidget
        except ImportError:
            lbl = QLabel("QtMultimedia is not available.")
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.lay.addWidget(lbl)
            return

        self.vidW = QVideoWidget()
        self.lay.addWidget(self.vidW)
        self.player = QMediaPlayer()
        self.audio = QAudioOutput()
        self.audio.setVolume(1.0)
        self.player.setAudioOutput(self.audio)
        self.player.setVideoOutput(self.vidW)
        self.player.setSource(QUrl(self.fileUrl))

        # seek bar
        seekLay = QHBoxLayout()
        self.timeLbl = QLabel("00:00 / 00:00")
        self.seekBar = ClickSldr(Qt.Orientation.Horizontal)
        self.seekBar.setRange(0, 0)
        self.seekBar.sliderMoved.connect(self.player.setPosition)
        self.player.positionChanged.connect(self._onPos)
        self.player.durationChanged.connect(lambda d: self.seekBar.setRange(0, d))
        seekLay.addWidget(self.timeLbl)
        seekLay.addWidget(self.seekBar)
        self.lay.addLayout(seekLay)

        # controls
        ctrlLay = QHBoxLayout()
        playBtn = QPushButton("Play / Pause")
        playBtn.clicked.connect(self._toggle)
        volLbl = QLabel("Volume:")
        self.volSldr = QSlider(Qt.Orientation.Horizontal)
        self.volSldr.setRange(0, 100)
        self.volSldr.setValue(100)
        self.volSldr.valueChanged.connect(lambda v: self.audio.setVolume(v / 100.0))
        ctrlLay.addWidget(playBtn)
        ctrlLay.addStretch()
        ctrlLay.addWidget(volLbl)
        ctrlLay.addWidget(self.volSldr)
        self.lay.addLayout(ctrlLay)
        self.player.play()

    def _onPos(self, pos):
        self.seekBar.setValue(pos)
        p, d = pos // 1000, self.player.duration() // 1000
        self.timeLbl.setText(f"{p//60:02d}:{p%60:02d} / {d//60:02d}:{d%60:02d}")

    def _toggle(self):
        if hasattr(self, 'player'):
            from PyQt6.QtMultimedia import QMediaPlayer
            if self.player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
                self.player.pause()
            else:
                self.player.play()

    def keyPressEvent(self, ev):
        if not hasattr(self, 'player'):
            super().keyPressEvent(ev)
            return
        key = ev.key()
        if key == Qt.Key.Key_Space:
            from PyQt6.QtMultimedia import QMediaPlayer
            if self.player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
                self.player.pause()
                self._overlay("⏸  Paused")
            else:
                self.player.play()
                self._overlay("▶  Playing")
        elif key in (Qt.Key.Key_Up, Qt.Key.Key_Down):
            v = self.volSldr.value() + (5 if key == Qt.Key.Key_Up else -5)
            v = max(0, min(100, v))
            self.volSldr.setValue(v)
            self._overlay(f"Volume: {v}%")
        elif key in (Qt.Key.Key_Left, Qt.Key.Key_Right):
            off = 10000 if key == Qt.Key.Key_Right else -10000
            self.player.setPosition(max(0, min(self.player.duration(), self.player.position() + off)))
            self._overlay(f"Seek: {'+10s' if off > 0 else '-10s'}")
        else:
            super().keyPressEvent(ev)

    def _overlay(self, text):
        if not hasattr(self, '_ovLbl'):
            self._ovLbl = QLabel()
            self._ovLbl.setWindowFlags(
                Qt.WindowType.FramelessWindowHint |
                Qt.WindowType.WindowStaysOnTopHint |
                Qt.WindowType.Tool)
            self._ovLbl.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
            self._ovLbl.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
            self._ovLbl.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
            self._ovLbl.setStyleSheet("""
                QLabel { color: white; background-color: rgba(0,0,0,180);
                         padding: 12px 18px; border-radius: 8px;
                         font-size: 22px; font-weight: bold; }
            """)
            from PyQt6.QtCore import QTimer
            self._ovTimer = QTimer(self)
            self._ovTimer.setSingleShot(True)
            self._ovTimer.timeout.connect(self._ovLbl.hide)

        self._ovLbl.setText(text)
        self._ovLbl.adjustSize()
        gp = self.vidW.mapToGlobal(self.vidW.rect().topLeft())
        self._ovLbl.move(gp.x() + 20, gp.y() + 20)
        self._ovLbl.show()
        self._ovLbl.raise_()
        self._ovTimer.start(1500)

    def _showPdf(self):
        if QWebEngineView is None:
            lbl = QLabel("PyQt6-WebEngine is not installed.\nRun: pip install PyQt6-WebEngine")
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.lay.addWidget(lbl)
            return
        self.web = QWebEngineView()
        self.web.load(QUrl(self.fileUrl))
        self.lay.addWidget(self.web)

    def closeEvent(self, ev):
        if hasattr(self, 'player'):
            self.player.stop()
            self.player.setSource(QUrl(""))
        if hasattr(self, 'web') and self.web is not None:
            self.web.load(QUrl(""))
        super().closeEvent(ev)


# --- Main Application ---

class MHApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.proxy = MHProxy(port=18080)
        self.proxy.start()
        self.cli = None
        self.curFld = None
        self.curPid = None
        self.curKey = None
        self.curFiles = {}

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
            QCheckBox { color: #E0E0E0; spacing: 6px; }
            QCheckBox::indicator { width: 16px; height: 16px; }
        """)

        self.stack = QStackedWidget()
        self.setCentralWidget(self.stack)
        self._initLog()
        self._initMain()

        # auto-login from keyring
        cred = self._loadCred()
        if cred:
            self.urlIn.setText(cred['url'])
            self.userIn.setText(cred['user'])
            self.autoChk.setChecked(True)
            self.cli = MHClient(cred['url'], cred['user'], "")
            self.cli.setAuth(cred['uHash'], cred['uKey'])
            self.stack.setCurrentIndex(1)
            self.doFlds()
        else:
            self.stack.setCurrentIndex(0)

    # --- Keyring ---

    def _loadCred(self):
        if not HAS_KEYRING:
            return None
        try:
            raw = keyring.get_password(KR_SVC, KR_ACC)
            if not raw:
                return None
            d = json.loads(raw)
            return {'url': d['url'], 'user': d['user'],
                    'uHash': d['uHash'], 'uKey': bytes.fromhex(d['uKey'])}
        except Exception:
            return None

    def _saveCred(self, url, user, uHash, uKey):
        if not HAS_KEYRING:
            return
        try:
            keyring.set_password(KR_SVC, KR_ACC, json.dumps({
                'url': url, 'user': user,
                'uHash': uHash, 'uKey': uKey.hex()}))
        except Exception:
            pass

    def _clrCred(self):
        if HAS_KEYRING:
            try:
                keyring.delete_password(KR_SVC, KR_ACC)
            except Exception:
                pass

    # --- Login UI ---

    def _initLog(self):
        w = QWidget()
        lay = QVBoxLayout()
        lay.setAlignment(Qt.AlignmentFlag.AlignCenter)

        title = QLabel("MediaHub")
        title.setStyleSheet("font-size: 32px; font-weight: bold; color: #BB86FC; margin-bottom: 20px;")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.urlIn = QLineEdit()
        self.urlIn.setPlaceholderText("Server Address (e.g., https://localhost:443)")
        self.urlIn.setFixedWidth(300)

        self.userIn = QLineEdit()
        self.userIn.setPlaceholderText("Username")
        self.userIn.setFixedWidth(300)

        self.passIn = QLineEdit()
        self.passIn.setPlaceholderText("Password")
        self.passIn.setEchoMode(QLineEdit.EchoMode.Password)
        self.passIn.setFixedWidth(300)

        self.autoChk = QCheckBox("Auto Login")
        self.autoChk.setFixedWidth(300)

        self.logBtn = QPushButton("Login")
        self.logBtn.setFixedWidth(300)
        self.logBtn.clicked.connect(self.doLogin)

        self.statLbl = QLabel("")
        self.statLbl.setStyleSheet("color: #CF6679;")
        self.statLbl.setAlignment(Qt.AlignmentFlag.AlignCenter)

        lay.addWidget(title)
        lay.addWidget(self.urlIn)
        lay.addWidget(self.userIn)
        lay.addWidget(self.passIn)
        lay.addWidget(self.autoChk)
        lay.addWidget(self.logBtn)
        lay.addWidget(self.statLbl)
        w.setLayout(lay)
        self.stack.addWidget(w)

    # --- Main UI ---

    def _initMain(self):
        w = QWidget()
        lay = QHBoxLayout()

        # sidebar
        sb = QWidget()
        sbLay = QVBoxLayout()
        sbLay.setContentsMargins(0, 0, 0, 0)
        sb.setFixedWidth(250)

        fldLbl = QLabel("Folders")
        fldLbl.setStyleSheet("font-size: 18px; font-weight: bold; margin-bottom: 10px; color: #BB86FC;")

        self.fldList = QListWidget()
        self.fldList.itemClicked.connect(self.onFldSel)

        btnLay = QHBoxLayout()
        newBtn = QPushButton("New Folder")
        newBtn.clicked.connect(self.doMkFld)
        refBtn = QPushButton("Refresh")
        refBtn.clicked.connect(self.doFlds)
        btnLay.addWidget(newBtn)
        btnLay.addWidget(refBtn)

        logoutBtn = QPushButton("Logout")
        logoutBtn.setStyleSheet("background-color: #333; color: #CF6679; font-size: 12px; padding: 6px;")
        logoutBtn.clicked.connect(self.doLogout)

        sbLay.addWidget(fldLbl)
        sbLay.addWidget(self.fldList)
        sbLay.addLayout(btnLay)
        sbLay.addWidget(logoutBtn)
        sb.setLayout(sbLay)

        # content
        ct = QWidget()
        ctLay = QVBoxLayout()
        ctLay.setContentsMargins(15, 0, 0, 0)

        self.curLbl = QLabel("Select a folder")
        self.curLbl.setStyleSheet("font-size: 24px; font-weight: bold; margin-bottom: 10px;")

        self.srchIn = QLineEdit()
        self.srchIn.setPlaceholderText("Search files...")
        self.srchIn.textChanged.connect(self.doFilter)

        self.fileTbl = QTableWidget(0, 3)
        self.fileTbl.setHorizontalHeaderLabels(["", "Filename", "Size"])
        self.fileTbl.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Fixed)
        self.fileTbl.setColumnWidth(0, 80)
        self.fileTbl.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.fileTbl.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self.fileTbl.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.fileTbl.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.fileTbl.itemDoubleClicked.connect(self.doView)
        self.fileTbl.setSortingEnabled(True)
        self.fileTbl.horizontalHeader().setSortIndicator(-1, Qt.SortOrder.AscendingOrder)
        self.fileTbl.verticalHeader().setDefaultSectionSize(70)
        self.fileTbl.verticalHeader().hide()
        self.fileTbl.horizontalHeader().sectionClicked.connect(
            lambda c: self.fileTbl.horizontalHeader().setSortIndicator(-1, Qt.SortOrder.AscendingOrder) if c == 0 else None)

        actLay = QHBoxLayout()
        self.upBtn = QPushButton("Upload Files")
        self.upBtn.clicked.connect(self.doUpload)
        self.upDirBtn = QPushButton("Upload Directory")
        self.upDirBtn.clicked.connect(self.doUpDir)
        self.dnBtn = QPushButton("Download Selected")
        self.dnBtn.clicked.connect(self.doDown)
        self.viewBtn = QPushButton("View File")
        self.viewBtn.clicked.connect(self.doView)
        actLay.addWidget(self.upBtn)
        actLay.addWidget(self.upDirBtn)
        actLay.addWidget(self.dnBtn)
        actLay.addWidget(self.viewBtn)
        actLay.addStretch()

        self.progBar = QProgressBar()
        self.progBar.setVisible(False)
        self.progBar.setRange(0, 100)
        self.progBar.setTextVisible(False)
        self.progBar.setStyleSheet("""
            QProgressBar { border: 1px solid #333; border-radius: 5px; background-color: #1E1E1E; height: 10px; }
            QProgressBar::chunk { background-color: #BB86FC; border-radius: 5px; }
        """)
        self.upStatLbl = QLabel("")
        self.upStatLbl.setVisible(False)
        self.upStatLbl.setStyleSheet("color: #BB86FC; font-size: 12px;")

        progLay = QVBoxLayout()
        progLay.setSpacing(2)
        progLay.addWidget(self.upStatLbl)
        progLay.addWidget(self.progBar)

        ctLay.addWidget(self.curLbl)
        ctLay.addWidget(self.srchIn)
        ctLay.addWidget(self.fileTbl)
        ctLay.addLayout(actLay)
        ctLay.addLayout(progLay)
        ct.setLayout(ctLay)

        lay.addWidget(sb)
        lay.addWidget(ct)
        w.setLayout(lay)
        self.stack.addWidget(w)

    # --- Actions ---

    def doFilter(self, text):
        s = unicodedata.normalize('NFC', text).lower()
        for r in range(self.fileTbl.rowCount()):
            it = self.fileTbl.item(r, 1)
            if it:
                self.fileTbl.setRowHidden(r, s not in unicodedata.normalize('NFC', it.text()).lower())

    def doLogin(self):
        url = self.urlIn.text().strip()
        user = self.userIn.text().strip()
        pw = self.passIn.text()
        if not url or not user or not pw:
            self.statLbl.setText("Please fill all fields")
            return
        self.logBtn.setEnabled(False)
        self.statLbl.setText("Authenticating...")
        self.cli = MHClient(url, user, pw)
        self._wk = WkLogin(self.cli)
        self._wk.success.connect(self._onLogOk)
        self._wk.error.connect(self._onLogErr)
        self._wk.start()

    def _onLogOk(self):
        if self.autoChk.isChecked():
            self._saveCred(self.urlIn.text().strip(), self.userIn.text().strip(),
                           self.cli.uHash, self.cli.uKey)
        self.passIn.clear()
        self.stack.setCurrentIndex(1)
        self.doFlds()

    def _onLogErr(self, err):
        self.logBtn.setEnabled(True)
        self.statLbl.setText(f"Error: {err}")

    def doLogout(self):
        self._clrCred()
        self.cli = None
        self.fldList.clear()
        self.fileTbl.setRowCount(0)
        self.passIn.clear()
        self.autoChk.setChecked(False)
        self.stack.setCurrentIndex(0)
        self.logBtn.setEnabled(True)
        self.statLbl.setText("")

    def doFlds(self):
        self.fldList.clear()
        self._wk = WkFlds(self.cli)
        self._wk.success.connect(self._onFlds)
        self._wk.error.connect(lambda e: QMessageBox.critical(self, "Error", f"Failed to fetch folders: {e}"))
        self._wk.start()

    def _onFlds(self, flds):
        self.fldList.clear()
        for f in flds.keys():
            self.fldList.addItem(f)

    def doMkFld(self):
        name, ok = QInputDialog.getText(self, "New Folder", "Folder Name:")
        if ok and name:
            try:
                self.cli.mkFld(name)
                self.doFlds()
            except Exception as e:
                QMessageBox.critical(self, "Error", str(e))

    def onFldSel(self, item):
        self.curFld = item.text()
        self.curLbl.setText(f"Folder: {self.curFld}")
        self.fileTbl.setRowCount(0)
        self._wk = WkFiles(self.cli, self.curFld)
        self._wk.success.connect(self._onFiles)
        self._wk.error.connect(lambda e: QMessageBox.critical(self, "Error", f"Failed to fetch files: {e}"))
        self._wk.start()

    def _fmtSize(self, sz):
        for u in ['B', 'KB', 'MB', 'GB', 'TB']:
            if sz < 1024.0:
                return f"{sz:.1f} {u}" if u != 'B' else f"{sz} {u}"
            sz /= 1024.0
        return f"{sz:.1f} PB"

    def _onFiles(self, pid, key, files):
        self.curPid = pid
        self.curKey = key
        self.curFiles = files
        self.proxy.updCtx(self.cli, files)
        self._thumbWk = []

        IMG = {'jpg', 'jpeg', 'png', 'gif', 'webp'}
        VID = {'mp4', 'webm', 'mov', 'mkv'}
        TXT = {'txt', 'md', 'csv', 'py', 'json', 'log'}

        self.fileTbl.setSortingEnabled(False)
        self.fileTbl.setRowCount(0)

        for name, info in files.items():
            sz = Opsec.DecodeInt(info[44:52], False)
            row = self.fileTbl.rowCount()
            self.fileTbl.insertRow(row)
            self.fileTbl.setRowHeight(row, 70)

            thLbl = QLabel()
            thLbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''

            if ext in IMG | VID:
                thLbl.setText("⏳")
                thLbl.setStyleSheet("color:#888; font-size:22px;")
                fk = info[:44]
                fpid = self.cli.objPid(fk)
                thLbl.setProperty("fpid", fpid)
                w = WkThumb(self.cli, pid, fpid, fk)
                w.success.connect(self._onThumb)
                w.start()
                self._thumbWk.append(w)
            elif ext == 'pdf':
                thLbl.setText("📄"); thLbl.setStyleSheet("font-size:32px;")
            elif ext in TXT:
                thLbl.setText("📝"); thLbl.setStyleSheet("font-size:32px;")
            else:
                thLbl.setText("📁"); thLbl.setStyleSheet("font-size:32px;")

            self.fileTbl.setCellWidget(row, 0, thLbl)
            self.fileTbl.setItem(row, 0, SortItem(""))

            nItem = SortItem(name)
            nItem.setData(Qt.ItemDataRole.UserRole, name.lower())
            sItem = SortItem(self._fmtSize(sz))
            sItem.setData(Qt.ItemDataRole.UserRole, sz)

            self.fileTbl.setItem(row, 1, nItem)
            self.fileTbl.setItem(row, 2, sItem)

        self.fileTbl.setSortingEnabled(True)
        self.doFilter(self.srchIn.text())

    def _onThumb(self, fpid, raw):
        # QPixmap must be created on GUI thread
        pm = QPixmap.fromImage(QImage.fromData(raw))
        if pm.isNull():
            return
        scaled = pm.scaled(68, 68, Qt.AspectRatioMode.KeepAspectRatio,
                           Qt.TransformationMode.SmoothTransformation)
        # find row by fpid to handle sorting correctly
        for r in range(self.fileTbl.rowCount()):
            lbl = self.fileTbl.cellWidget(r, 0)
            if lbl and lbl.property("fpid") == fpid:
                lbl.setPixmap(scaled)
                break

    def _setLoad(self, on=True):
        self.upBtn.setEnabled(not on)
        self.upDirBtn.setEnabled(not on)
        self.dnBtn.setEnabled(not on)
        self.viewBtn.setEnabled(not on)
        self.progBar.setVisible(on)
        self.upStatLbl.setVisible(on)
        if on:
            self.progBar.setRange(0, 100)
            self.progBar.setValue(0)
            self.upStatLbl.setText("Preparing...")

    def _onUpProg(self, sent, total, speed):
        if total > 0:
            pct = int(sent * 100 / total)
            self.progBar.setValue(pct)
            if speed > 0:
                self.upStatLbl.setText(f"Uploading... {pct}%  |  {speed / (1024*1024):.1f} MB/s")
            else:
                self.upStatLbl.setText(f"Uploading... {pct}%")

    def doUpload(self):
        if not self.curFld:
            QMessageBox.warning(self, "Warning", "Select a folder first")
            return
        files, _ = QFileDialog.getOpenFileNames(self, "Select Files to Upload")
        if files:
            self._setLoad(True)
            self._wk = WkUpload(self.cli, self.curPid, self.curKey, self.curFiles, files)
            self._wk.success.connect(self._onUpDone)
            self._wk.error.connect(self._onOpErr)
            self._wk.progress.connect(self._onUpProg)
            self._wk.start()

    def doUpDir(self):
        if not self.curFld:
            QMessageBox.warning(self, "Warning", "Select a folder first")
            return
        dp = QFileDialog.getExistingDirectory(self, "Select Directory to Upload")
        if dp:
            files = [os.path.join(dp, f) for f in os.listdir(dp) if os.path.isfile(os.path.join(dp, f))]
            if files:
                self._setLoad(True)
                self._wk = WkUpload(self.cli, self.curPid, self.curKey, self.curFiles, files)
                self._wk.success.connect(self._onUpDone)
                self._wk.error.connect(self._onOpErr)
                self._wk.progress.connect(self._onUpProg)
                self._wk.start()

    def _onUpDone(self):
        self._setLoad(False)
        self.upStatLbl.setVisible(False)
        QMessageBox.information(self, "Success", "Upload complete!")
        self.onFldSel(self.fldList.currentItem())

    def doDown(self):
        if not self.curFld:
            QMessageBox.warning(self, "Warning", "Select a folder first")
            return
        sel = self.fileTbl.selectionModel().selectedRows()
        if not sel:
            QMessageBox.warning(self, "Warning", "Select files to download")
            return
        outDir = QFileDialog.getExistingDirectory(self, "Select Download Directory")
        if outDir:
            self._setLoad(True)
            row = sel[0].row()
            name = self.fileTbl.item(row, 1).text()
            flInfo = self.curFiles[name]
            self._wk = WkDown(self.cli, self.curPid, flInfo, name, outDir)
            self._wk.success.connect(self._onDnDone)
            self._wk.error.connect(self._onOpErr)
            self._wk.start()

    def _onDnDone(self, path):
        self._setLoad(False)
        QMessageBox.information(self, "Success", f"Downloaded to:\n{path}")

    def doView(self):
        if not self.curFld:
            QMessageBox.warning(self, "Warning", "Select a folder first")
            return
        sel = self.fileTbl.selectionModel().selectedRows()
        if not sel:
            QMessageBox.warning(self, "Warning", "Select a file to view")
            return
        row = sel[0].row()
        name = self.fileTbl.item(row, 1).text()
        url = f"http://127.0.0.1:18080/stream/{self.curPid}/{urllib.parse.quote(name)}"
        self.viewer = Viewer(url, name, parent=self)
        self.viewer.show()

    def _onOpErr(self, err):
        self._setLoad(False)
        QMessageBox.critical(self, "Error", str(err))

    def closeEvent(self, ev):
        self.proxy.stop()
        super().closeEvent(ev)


if __name__ == "__main__":
    app = QApplication(sys.argv)
    win = MHApp()
    win.show()
    sys.exit(app.exec())
