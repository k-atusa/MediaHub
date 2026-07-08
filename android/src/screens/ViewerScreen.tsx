import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Image, ActivityIndicator, TouchableWithoutFeedback, TouchableOpacity, ScrollView, Animated, Dimensions, GestureResponderEvent } from 'react-native';
import { Appbar, Text, useTheme, IconButton } from 'react-native-paper';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEventListener } from 'expo';
import * as FileSystem from 'expo-file-system/legacy';
import { WebView } from 'react-native-webview';
import { useAppContext } from '../context/AppContext';
import { Buffer } from 'buffer';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Separate component to isolate video hooks
const VideoPlayerComponent = ({ localUri, file, navigation }: any) => {
	const theme = useTheme();
	const [showControls, setShowControls] = useState(true);
	const [lastTapLeft, setLastTapLeft] = useState(0);
	const [lastTapRight, setLastTapRight] = useState(0);
	const [progressBarWidth, setProgressBarWidth] = useState(1);

	const leftArrowOpacity = useRef(new Animated.Value(0)).current;
	const rightArrowOpacity = useRef(new Animated.Value(0)).current;
	const controlsOpacity = useRef(new Animated.Value(1)).current;
	const controlsTimer = useRef<NodeJS.Timeout | null>(null);

	const player = useVideoPlayer(localUri, p => {
		p.loop = true;
		p.timeUpdateEventInterval = 0.2;
	});

	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);

	useEventListener(player, 'playingChange', ({ isPlaying }) => {
		setIsPlaying(isPlaying);
	});

	useEventListener(player, 'timeUpdate', ({ currentTime }) => {
		setCurrentTime(currentTime);
	});

	useEventListener(player, 'sourceLoad', ({ duration }) => {
		setDuration(duration);
	});

	useEffect(() => {
		if (localUri && player) {
			player.play();
			resetControlsTimer();
		}
		return () => {
			if (controlsTimer.current) clearTimeout(controlsTimer.current);
		};
	}, [localUri, player]);

	const resetControlsTimer = () => {
		if (controlsTimer.current) clearTimeout(controlsTimer.current);
		controlsTimer.current = setTimeout(() => {
			if (player.playing) {
				hideControlsAnimated();
			}
		}, 3500);
	};

	const showControlsAnimated = () => {
		setShowControls(true);
		Animated.timing(controlsOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start(() => resetControlsTimer());
	};

	const hideControlsAnimated = () => {
		setShowControls(false);
		Animated.timing(controlsOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
	};

	const toggleControls = () => {
		if (showControls) hideControlsAnimated();
		else showControlsAnimated();
	};

	const handleScreenTap = (event: GestureResponderEvent) => {
		const { pageX } = event.nativeEvent;
		const isLeft = pageX < SCREEN_WIDTH / 2;
		const now = Date.now();

		if (isLeft) {
			if (now - lastTapLeft < 400) {
				player.seekBy(-10);
				triggerDoubleTapAnimation(leftArrowOpacity);
				resetControlsTimer();
				setLastTapLeft(0);
			} else {
				toggleControls();
				setLastTapLeft(now);
			}
			setLastTapRight(0);
		} else {
			if (now - lastTapRight < 400) {
				player.seekBy(10);
				triggerDoubleTapAnimation(rightArrowOpacity);
				resetControlsTimer();
				setLastTapRight(0);
			} else {
				toggleControls();
				setLastTapRight(now);
			}
			setLastTapLeft(0);
		}
	};

	const triggerDoubleTapAnimation = (opacityVar: Animated.Value) => {
		opacityVar.setValue(1);
		Animated.timing(opacityVar, { toValue: 0, duration: 500, delay: 100, useNativeDriver: true }).start();
	};

	const handleProgressBarPress = (event: GestureResponderEvent) => {
		const ratio = Math.max(0, Math.min(1, event.nativeEvent.locationX / progressBarWidth));
		const targetTime = ratio * duration;
		player.seekBy(targetTime - currentTime);
		resetControlsTimer();
	};

	const formatTime = (seconds: number) => {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
	};

	const progressRatio = duration > 0 ? currentTime / duration : 0;

	return (
		<View style={styles.videoContainer}>
			<VideoView style={styles.media} player={player} nativeControls={false} />
			
			<TouchableWithoutFeedback onPress={handleScreenTap}>
				<View style={styles.tapOverlay}>
					<View style={styles.tapZone}>
						<Animated.View style={[styles.arrowContainer, { opacity: leftArrowOpacity }]}>
							<View style={styles.circleFeedback}>
								<IconButton icon="rewind" iconColor="white" size={32} />
								<Text style={styles.arrowText}>-10s</Text>
							</View>
						</Animated.View>
					</View>
					<View style={styles.tapZone}>
						<Animated.View style={[styles.arrowContainer, { opacity: rightArrowOpacity }]}>
							<View style={styles.circleFeedback}>
								<IconButton icon="fast-forward" iconColor="white" size={32} />
								<Text style={styles.arrowText}>+10s</Text>
							</View>
						</Animated.View>
					</View>
				</View>
			</TouchableWithoutFeedback>

			<Animated.View style={[styles.controlsOverlay, { opacity: controlsOpacity }]} pointerEvents={showControls ? "box-none" : "none"}>
				<View style={styles.topControlRow}>
					<IconButton icon="chevron-down" iconColor="white" size={30} onPress={() => navigation.goBack()} />
					<Text style={styles.videoTitle} numberOfLines={1}>{file.name}</Text>
				</View>
				<View style={styles.centerControlRow}>
					<TouchableOpacity style={styles.playPauseCircle} onPress={() => {
						isPlaying ? player.pause() : player.play();
						resetControlsTimer();
					}}>
						<IconButton icon={isPlaying ? "pause" : "play"} iconColor="white" size={48} />
					</TouchableOpacity>
				</View>
				<View style={styles.bottomControlRow}>
					<View style={styles.progressBarWrapper} onLayout={(e) => setProgressBarWidth(e.nativeEvent.layout.width)}>
						<TouchableWithoutFeedback onPress={handleProgressBarPress}>
							<View style={styles.progressBarBg}>
								<View pointerEvents="none" style={[styles.progressBarFill, { width: `${progressRatio * 100}%`, backgroundColor: theme.colors.primary }]} />
								<View pointerEvents="none" style={[styles.progressBarHandle, { left: `${progressRatio * 100}%`, backgroundColor: theme.colors.primary }]} />
							</View>
						</TouchableWithoutFeedback>
					</View>
					<View style={styles.timeRow}>
						<Text style={styles.timeText}>{formatTime(currentTime)} / {formatTime(duration)}</Text>
					</View>
				</View>
			</Animated.View>
		</View>
	);
};

export const ViewerScreen = ({ route, navigation }: any) => {
	const { file, fPid, flInfoHex } = route.params;
	const theme = useTheme();
	const { client } = useAppContext();

	const [loading, setLoading] = useState(true);
	const [localUri, setLocalUri] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [textContent, setTextContent] = useState<string | null>(null);
	const [pdfBase64, setPdfBase64] = useState<string | null>(null);

	const ext = file.name.split('.').pop()?.toLowerCase();
	const isVideo = ['mp4', 'webm', 'mov', 'mkv'].includes(ext || '');

	useEffect(() => {
		downloadAndPrepare();
		return () => {
			if (localUri) {
				FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => { });
			}
		};
	}, []);

	const downloadAndPrepare = async () => {
		try {
			const tempDir = FileSystem.cacheDirectory + 'mediahub_temp/';
			const dirInfo = await FileSystem.getInfoAsync(tempDir);
			if (!dirInfo.exists) {
				await FileSystem.makeDirectoryAsync(tempDir);
			}
			if (!flInfoHex) throw new Error("Missing file info");

			let flInfo;
			try {
				flInfo = Buffer.from(flInfoHex, 'hex');
			} catch (err) {
				throw new Error("Failed to parse file info buffer");
			}

			const destPath = await client!.dnFile(fPid, flInfo, file.name, tempDir);
			setLocalUri(destPath);

			if (['txt', 'md', 'csv', 'json', 'log', 'svg'].includes(ext || '')) {
				const b64 = await FileSystem.readAsStringAsync(destPath, { encoding: FileSystem.EncodingType.Base64 });
				const text = Buffer.from(b64, 'base64').toString('utf-8');
				setTextContent(text);
			} else if (ext === 'pdf') {
				const b64 = await FileSystem.readAsStringAsync(destPath, { encoding: FileSystem.EncodingType.Base64 });
				setPdfBase64(b64);
			}
		} catch (e: any) {
			setError(e.message || String(e));
		} finally {
			setLoading(false);
		}
	};

	const renderContent = () => {
		if (loading) return (
			<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
				<ActivityIndicator size="large" color={theme.colors.primary} />
			</View>
		);
		if (error) return <Text style={[styles.center, { color: theme.colors.error }]}>{error}</Text>;
		if (!localUri) return null;

		// Image Viewer
		if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) {
			return <Image source={{ uri: localUri }} style={styles.media} resizeMode="contain" />;
		}

		// SVG Viewer (runs inside WebView)
		if (ext === 'svg' && textContent) {
			const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
                    <style>
                        body { margin: 0; padding: 0; background-color: #1C1C1E; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
                        svg { width: 100%; height: 100%; max-width: 100%; max-height: 100%; }
                    </style>
                </head>
                <body>${textContent}</body>
                </html>
            `;
			return <WebView source={{ html }} style={styles.web} backgroundColor="#1C1C1E" />;
		}

		// PDF Viewer (runs via pdf.js in WebView)
		if (ext === 'pdf' && pdfBase64) {
			const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
                    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js"></script>
                    <style>
                        body { margin: 0; padding: 0; background-color: #1C1C1E; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; min-height: 100vh; overflow-y: auto; }
                        #pdf-container { width: 100%; display: flex; flex-direction: column; align-items: center; padding: 10px 0; }
                        canvas { width: 95%; max-width: 800px; height: auto; margin-bottom: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); border-radius: 4px; }
                        .loader { border: 4px solid #f3f3f3; border-top: 4px solid #0A84FF; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-top: 50px; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                </head>
                <body>
                    <div id="loader" class="loader"></div>
                    <div id="pdf-container"></div>
                    <script>
                        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                        const pdfData = atob('${pdfBase64}');
                        pdfjsLib.getDocument({data: pdfData}).promise.then(pdf => {
                            document.getElementById('loader').style.display = 'none';
                            const container = document.getElementById('pdf-container');
                            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                                pdf.getPage(pageNum).then(page => {
                                    const viewport = page.getViewport({scale: 1.5});
                                    const canvas = document.createElement('canvas');
                                    canvas.height = viewport.height;
                                    canvas.width = viewport.width;
                                    container.appendChild(canvas);
                                    page.render({canvasContext: canvas.getContext('2d'), viewport: viewport});
                                });
                            }
                        }).catch(err => {
                            document.getElementById('loader').style.display = 'none';
                            document.body.innerHTML = '<div style="padding: 20px; color: red; text-align: center;">Error rendering PDF: ' + err.message + '</div>';
                        });
                    </script>
                </body>
                </html>
            `;
			return <WebView source={{ html }} style={styles.web} backgroundColor="#1C1C1E" originWhitelist={['*']} />;
		}

		// MP4 Video Viewer with Custom Youtube Controls
		if (isVideo) {
			return <VideoPlayerComponent localUri={localUri} file={file} navigation={navigation} />;
		}

		// Text Viewer
		if (textContent !== null) {
			return (
				<ScrollView style={styles.textScroll} contentContainerStyle={styles.textContainer}>
					<Text style={[styles.textContent, { color: '#E5E5EA' }]}>{textContent}</Text>
				</ScrollView>
			);
		}

		return <Text style={styles.center}>Preview not supported for this file type.</Text>;
	};

	return (
		<View style={[styles.container, { backgroundColor: '#1C1C1E' }]}>
			{!isVideo && (
				<Appbar.Header elevated style={{ backgroundColor: '#1C1C1E' }} theme={{ dark: true }}>
					<Appbar.BackAction onPress={() => navigation.goBack()} color="white" />
					<Appbar.Content title={file.name} titleStyle={{ color: 'white' }} />
				</Appbar.Header>
			)}
			<View style={styles.content}>
				{renderContent()}
			</View>
		</View>
	);
};

const styles = StyleSheet.create({
	container: { flex: 1 },
	content: { flex: 1, backgroundColor: '#1C1C1E' },
	center: { textAlign: 'center', margin: 20, alignSelf: 'center', color: '#8E8E93' },
	media: { width: '100%', height: '100%' },
	web: { flex: 1, width: SCREEN_WIDTH },
	textScroll: { flex: 1, width: '100%' },
	textContainer: { padding: 15 },
	textContent: { fontFamily: 'monospace', fontSize: 14, lineHeight: 20 },

	// Video Custom Layout
	videoContainer: { width: '100%', height: '100%', backgroundColor: 'black', justifyContent: 'center', alignItems: 'center', position: 'relative' },
	tapOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', zIndex: 10 },
	tapZone: { flex: 1, height: '100%', justifyContent: 'center', alignItems: 'center' },
	circleFeedback: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
	arrowContainer: { justifyContent: 'center', alignItems: 'center' },
	arrowText: { color: 'white', fontSize: 12, fontWeight: 'bold', marginTop: -5 },
	controlsOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0, 0, 0, 0.45)', zIndex: 20, justifyContent: 'space-between', paddingVertical: 10 },
	topControlRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, marginTop: 20 },
	videoTitle: { color: 'white', fontSize: 16, fontWeight: 'bold', flex: 1 },
	centerControlRow: { justifyContent: 'center', alignItems: 'center' },
	playPauseCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(0, 0, 0, 0.6)', justifyContent: 'center', alignItems: 'center' },
	bottomControlRow: { paddingHorizontal: 20, paddingBottom: 20 },
	progressBarWrapper: { height: 20, justifyContent: 'center', width: '100%', marginBottom: 8 },
	progressBarBg: { height: 4, width: '100%', backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, position: 'relative' },
	progressBarFill: { height: '100%', borderRadius: 2, position: 'absolute', left: 0, top: 0 },
	progressBarHandle: { width: 12, height: 12, borderRadius: 6, position: 'absolute', top: -4, marginLeft: -6 },
	timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
	timeText: { color: 'white', fontSize: 12 }
});
