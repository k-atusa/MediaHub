import React, { useState, useEffect } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Text, TextInput, Button, Switch, useTheme } from 'react-native-paper';
import { useAppContext } from '../context/AppContext';
import { MediaHubClient } from '../core/MediaHubClient';
import * as SecureStore from 'expo-secure-store';

export const LoginScreen = ({ navigation }: any) => {
	const [url, setUrl] = useState('');
	const [user, setUser] = useState('');
	const [password, setPassword] = useState('');
	const [autoLogin, setAutoLogin] = useState(false);
	const [loading, setLoading] = useState(false);
	const { setClient } = useAppContext();
	const theme = useTheme();

	useEffect(() => {
		loadCredentials();
	}, []);

	const loadCredentials = async () => {
		try {
			const credStr = await SecureStore.getItemAsync('mediahub_cred');
			if (credStr) {
				const cred = JSON.parse(credStr);
				setUrl(cred.url);
				setUser(cred.user);

				/* 
				setAutoLogin(true);
				// Do auto login
				setLoading(true);
				const cli = new MediaHubClient(cred.url, cred.user, "");
				cli.setAuth(cred.uHash, Buffer.from(cred.uKey, 'hex'));
				setClient(cli);
				navigation.replace('Home');
				*/
			}
		} catch (e) { }
	};

	const handleLogin = async () => {
		if (!url || !user || !password) {
			Alert.alert("Error", "Please fill all fields");
			return;
		}
		setLoading(true);
		try {
			const cli = new MediaHubClient(url.trim(), user.trim(), password);
			await cli.auth();
			await cli.getFlds();
			if (autoLogin) {
				await SecureStore.setItemAsync('mediahub_cred', JSON.stringify({
					url, user, uHash: cli.uHash, uKey: cli.uKey?.toString('hex')
				}));
			} else {
				await SecureStore.deleteItemAsync('mediahub_cred');
			}
			setClient(cli);
			navigation.replace('Home');
		} catch (e: any) {
			Alert.alert("Login Failed", e.message || String(e));
			setLoading(false);
		}
	};

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === "ios" ? "padding" : "height"}
			style={[styles.container, { backgroundColor: theme.colors.background }]}
		>
			<View style={styles.form}>
				<Text variant="displaySmall" style={styles.title}>MediaHub</Text>

				<TextInput
					label="Server Address"
					value={url}
					onChangeText={setUrl}
					mode="outlined"
					style={styles.input}
					autoCapitalize="none"
					keyboardType="url"
				/>
				<TextInput
					label="Username"
					value={user}
					onChangeText={setUser}
					mode="outlined"
					style={styles.input}
					autoCapitalize="none"
				/>
				<TextInput
					label="Password"
					value={password}
					onChangeText={setPassword}
					mode="outlined"
					secureTextEntry
					style={styles.input}
				/>

				<View style={styles.switchContainer}>
					<Text>Auto Login</Text>
					<Switch value={autoLogin} onValueChange={setAutoLogin} />
				</View>

				<Button
					mode="contained"
					onPress={handleLogin}
					loading={loading}
					disabled={loading}
					style={styles.button}
				>
					Login
				</Button>
			</View>
		</KeyboardAvoidingView>
	);
};

const styles = StyleSheet.create({
	container: { flex: 1, justifyContent: 'center' },
	form: { padding: 20 },
	title: { textAlign: 'center', marginBottom: 30, fontWeight: 'bold' },
	input: { marginBottom: 15 },
	switchContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
	button: { marginTop: 10, paddingVertical: 5 },
});
