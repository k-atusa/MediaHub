import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, MD3DarkTheme } from 'react-native-paper';
import { AppProvider } from './src/context/AppContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ViewerScreen } from './src/screens/ViewerScreen';

import { MaterialCommunityIcons } from '@expo/vector-icons';

const Stack = createNativeStackNavigator();

const customTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#0A84FF',
    background: '#1C1C1E',
    surface: '#2C2C2E',
  },
};

export default function App() {
  return (
    <AppProvider>
      <PaperProvider 
        theme={customTheme}
        settings={{
          icon: props => <MaterialCommunityIcons {...props} />,
        }}
      >
        <NavigationContainer theme={customTheme as any}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Viewer" component={ViewerScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </AppProvider>
  );
}
