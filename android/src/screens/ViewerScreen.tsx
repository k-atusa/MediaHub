import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { Appbar, Text, useTheme } from 'react-native-paper';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';
import { useAppContext } from '../context/AppContext';
import { Buffer } from 'buffer';

export const ViewerScreen = ({ route, navigation }: any) => {
    const { file, fPid, flInfoHex } = route.params;
    const theme = useTheme();
    const { client } = useAppContext();
    
    const [loading, setLoading] = useState(true);
    const [localUri, setLocalUri] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [textContent, setTextContent] = useState<string | null>(null);

    const ext = file.name.split('.').pop()?.toLowerCase();

    const player = useVideoPlayer(localUri, player => {
        player.loop = true;
        player.play();
    });

    useEffect(() => {
        downloadAndPrepare();
        return () => {
            // Clean up temp file on exit
            if (localUri) {
                FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
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
            const flInfo = Buffer.from(flInfoHex, 'hex');
            const destPath = await client!.dnFile(fPid, flInfo, file.name, tempDir);
            setLocalUri(destPath);
            
            if (['txt', 'md', 'csv', 'json', 'log'].includes(ext!)) {
                const b64 = await FileSystem.readAsStringAsync(destPath, { encoding: FileSystem.EncodingType.Base64 });
                const text = Buffer.from(b64, 'base64').toString('utf-8');
                setTextContent(text);
            }
        } catch (e: any) {
            setError(e.message || "Failed to load file");
        } finally {
            setLoading(false);
        }
    };

    const renderContent = () => {
        if (loading) return <ActivityIndicator size="large" color={theme.colors.primary} style={styles.center} />;
        if (error) return <Text style={[styles.center, { color: theme.colors.error }]}>{error}</Text>;
        if (!localUri) return null;

        if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext!)) {
            return <Image source={{ uri: localUri }} style={styles.media} resizeMode="contain" />;
        }
        if (['mp4', 'webm', 'mov', 'mkv'].includes(ext!)) {
            return (
                <VideoView
                    style={styles.media}
                    player={player}
                    allowsFullscreen
                    allowsPictureInPicture
                />
            );
        }
        if (textContent !== null) {
            return <Text style={styles.text}>{textContent}</Text>;
        }

        return <Text style={styles.center}>Preview not supported for this file type.</Text>;
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header elevated>
                <Appbar.BackAction onPress={() => navigation.goBack()} />
                <Appbar.Content title={file.name} />
            </Appbar.Header>
            <View style={styles.content}>
                {renderContent()}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    center: { textAlign: 'center', margin: 20 },
    media: { width: '100%', height: '100%' },
    text: { padding: 10, width: '100%', height: '100%' }
});
