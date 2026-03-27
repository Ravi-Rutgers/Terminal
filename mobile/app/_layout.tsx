import React, { useEffect, useState } from 'react';

import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';

const queryClient = new QueryClient();

function AuthRedirect() {
  const { isAuthenticated, loadStored } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadStored().then(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;

    const inAuth = segments[0] === 'login';

    if (!isAuthenticated && !inAuth) {
      router.replace('/login');
    } else if (isAuthenticated && inAuth) {
      router.replace('/(tabs)/terminal');
    }
  }, [loaded, isAuthenticated, segments]);

  return null;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthRedirect />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0a0a0a' },
          headerTintColor: '#e0e0e0',
          contentStyle: { backgroundColor: '#0a0a0a' },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="editor/[path]" options={{ headerShown: true, title: 'Editor' }} />
        <Stack.Screen name="agent-history/[id]" options={{ headerShown: true, title: 'Geschiedenis', animation: 'slide_from_right' }} />
      </Stack>
    </QueryClientProvider>
  );
}
