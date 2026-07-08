import React, { createContext, useContext, useState } from 'react';
import { MediaHubClient } from '../core/MediaHubClient';

interface AppContextType {
    client: MediaHubClient | null;
    setClient: (client: MediaHubClient | null) => void;
}

const AppContext = createContext<AppContextType>({
    client: null,
    setClient: () => {},
});

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [client, setClient] = useState<MediaHubClient | null>(null);

    return (
        <AppContext.Provider value={{ client, setClient }}>
            {children}
        </AppContext.Provider>
    );
};

export const useAppContext = () => useContext(AppContext);
