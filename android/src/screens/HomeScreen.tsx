import React, { useState, useEffect } from 'react';
import { View, FlatList, StyleSheet, Alert, BackHandler } from 'react-native';
import { Appbar, Drawer, FAB, List, Text, useTheme, Dialog, Portal, TextInput, Button, ProgressBar, IconButton } from 'react-native-paper';
import { useAppContext } from '../context/AppContext';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';

export const HomeScreen = ({ navigation }: any) => {
	const { client, setClient } = useAppContext();
	const theme = useTheme();

	const [folders, setFolders] = useState<string[]>([]);
	const [currentFolder, setCurrentFolder] = useState<string | null>(null);
	const [files, setFiles] = useState<{ name: string, size: number, info: Buffer }[]>([]);
	const [curPid, setCurPid] = useState<string>('');
	const [curKey, setCurKey] = useState<Buffer | null>(null);
	const [flMap, setFlMap] = useState<Record<string, Buffer>>({});

	const [drawerOpen, setDrawerOpen] = useState(false);
	const [newFolderVisible, setNewFolderVisible] = useState(false);
	const [newFolderName, setNewFolderName] = useState('');

	const [uploading, setUploading] = useState(false);
	const [progress, setProgress] = useState(0);

	useEffect(() => {
		loadFolders();
		const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
			if (drawerOpen) {
				setDrawerOpen(false);
				return true;
			}
			return false;
		});
		return () => backHandler.remove();
	}, [drawerOpen]);

	const loadFolders = async () => {
		if (!client) return;
		try {
			const flds = await client.getFlds();
			setFolders(Object.keys(flds));
		} catch (e: any) {
			Alert.alert("Error", `Failed to fetch folders: ${e.message}`);
		}
	};

	const handleCreateFolder = async () => {
		if (!newFolderName) return;
		setNewFolderVisible(false);
		try {
			await client?.mkFld(newFolderName);
			setNewFolderName('');
			loadFolders();
		} catch (e: any) {
			Alert.alert("Error", e.message);
		}
	};

	const selectFolder = async (folder: string) => {
		setCurrentFolder(folder);
		setDrawerOpen(false);
		setFiles([]);
		try {
			const { fPid, fKey, flMap } = await client!.getFiles(folder);
			setCurPid(fPid);
			setCurKey(fKey);
			setFlMap(flMap);

			const fileList = Object.entries(flMap).map(([name, info]) => {
				const sizeBuf = info.subarray(44, 52);
				// Simple 53-bit int read (max safe int is enough for files)
				let size = 0;
				for (let i = 0; i < 6; i++) {
					size += sizeBuf[i] * Math.pow(256, i);
				}
				return { name, size, info };
			});
			setFiles(fileList.sort((a, b) => a.name.localeCompare(b.name)));
		} catch (e: any) {
			Alert.alert("Error", `Failed to fetch files: ${e.message}`);
		}
	};

	const handleLogout = async () => {
		await SecureStore.deleteItemAsync('mediahub_cred');
		setClient(null);
		navigation.replace('Login');
	};

	const handleUpload = async () => {
		if (!currentFolder || !curPid || !curKey) {
			Alert.alert("Warning", "Select a folder first");
			return;
		}
		try {
			const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
			if (!res.canceled && res.assets && res.assets.length > 0) {
				setUploading(true);
				setProgress(0);

				let currentFileIdx = 0;
				for (const asset of res.assets) {
					await client!.upFile(curPid, curKey, flMap, asset.uri, asset.name, asset.size || 0, (sent, total) => {
						const fileProg = sent / total;
						setProgress((currentFileIdx + fileProg) / res.assets.length);
					});
					currentFileIdx++;
				}

				Alert.alert("Success", "Upload complete!");
				selectFolder(currentFolder);
			}
		} catch (e: any) {
			Alert.alert("Upload Error", e.message || String(e));
		} finally {
			setUploading(false);
		}
	};

	const handleDownload = async (file: { name: string, size: number, info: Buffer }) => {
		Alert.alert("Download", `Download ${file.name}?`, [
			{ text: "Cancel", style: "cancel" },
			{
				text: "Download", onPress: async () => {
					setUploading(true);
					setProgress(0);
					try {
						const dest = FileSystem.documentDirectory + file.name;
						await client!.dnFile(curPid, file.info, file.name, FileSystem.documentDirectory!);
						Alert.alert("Success", `Downloaded to ${dest}`);
					} catch (e: any) {
						Alert.alert("Error", e.message);
					} finally {
						setUploading(false);
					}
				}
			}
		]);
	};

	const handleView = (file: { name: string, size: number, info: Buffer }) => {
		navigation.navigate('Viewer', {
			file: { name: file.name, size: file.size },
			fPid: curPid,
			flInfoHex: Buffer.from(file.info).toString('hex'),
		});
	};

	const formatSize = (sz: number) => {
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let uIdx = 0;
		while (sz >= 1024 && uIdx < units.length - 1) {
			sz /= 1024;
			uIdx++;
		}
		return `${uIdx === 0 ? sz : sz.toFixed(1)} ${units[uIdx]}`;
	};

	const getIcon = (name: string) => {
		const ext = name.split('.').pop()?.toLowerCase();
		if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext!)) return 'image';
		if (['mp4', 'webm', 'mov', 'mkv'].includes(ext!)) return 'video';
		if (ext === 'pdf') return 'file-pdf-box';
		if (['txt', 'md', 'csv', 'py', 'json', 'log'].includes(ext!)) return 'file-document';
		return 'file';
	};

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header elevated>
				<Appbar.Action icon="menu" onPress={() => setDrawerOpen(!drawerOpen)} />
				<Appbar.Content title={currentFolder || "MediaHub"} />
				<Appbar.Action icon="refresh" onPress={() => currentFolder ? selectFolder(currentFolder) : loadFolders()} />
				<Appbar.Action icon="logout" onPress={handleLogout} />
			</Appbar.Header>

			{uploading && <ProgressBar progress={progress} color={theme.colors.primary} style={{ height: 4 }} />}

			{drawerOpen ? (
				<View style={[styles.drawer, { backgroundColor: theme.colors.surface }]}>
					<List.Section>
						<List.Subheader>Folders</List.Subheader>
						{folders.map(f => (
							<List.Item
								key={f}
								title={f}
								left={props => <List.Icon {...props} icon="folder" />}
								onPress={() => selectFolder(f)}
								style={currentFolder === f ? { backgroundColor: theme.colors.secondaryContainer } : {}}
							/>
						))}
						<List.Item
							title="New Folder..."
							left={props => <List.Icon {...props} icon="folder-plus" />}
							onPress={() => setNewFolderVisible(true)}
						/>
					</List.Section>
				</View>
			) : (
				<FlatList
					data={files}
					keyExtractor={item => item.name}
					renderItem={({ item }) => (
						<List.Item
							title={item.name}
							description={formatSize(item.size)}
							left={props => <List.Icon {...props} icon={getIcon(item.name)} />}
							right={props => (
								<View style={{ flexDirection: 'row' }}>
									<IconButton icon="download" onPress={() => handleDownload(item)} />
								</View>
							)}
							onPress={() => handleView(item)}
						/>
					)}
					ListEmptyComponent={<Text style={{ textAlign: 'center', marginTop: 50 }}>{currentFolder ? "Folder is empty" : "Select a folder from the menu"}</Text>}
				/>
			)}

			{!drawerOpen && currentFolder && (
				<FAB
					icon="upload"
					style={styles.fab}
					onPress={handleUpload}
					disabled={uploading}
				/>
			)}

			<Portal>
				<Dialog visible={newFolderVisible} onDismiss={() => setNewFolderVisible(false)}>
					<Dialog.Title>New Folder</Dialog.Title>
					<Dialog.Content>
						<TextInput
							label="Folder Name"
							value={newFolderName}
							onChangeText={setNewFolderName}
							mode="outlined"
						/>
					</Dialog.Content>
					<Dialog.Actions>
						<Button onPress={() => setNewFolderVisible(false)}>Cancel</Button>
						<Button onPress={handleCreateFolder}>Create</Button>
					</Dialog.Actions>
				</Dialog>
			</Portal>
		</View>
	);
};

const styles = StyleSheet.create({
	fab: {
		position: 'absolute',
		margin: 16,
		right: 0,
		bottom: 0,
	},
	drawer: {
		flex: 1,
	}
});
