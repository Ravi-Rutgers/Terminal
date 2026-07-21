import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  Pressable,
} from 'react-native';
import { showAlert } from '../utils/alert';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../hooks/useAuth';
import { colors, spacing, radius, fontSize } from '../constants/theme';
import { getRecentUrls, addRecentUrl } from '../utils/recentUrls';
import { Ionicons } from '@expo/vector-icons';

export default function LoginScreen() {
  const { login } = useAuth();
  const [serverUrl, setServerUrl] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [recentUrls, setRecentUrls] = useState<string[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  const { prefillUrl } = useLocalSearchParams<{ prefillUrl?: string }>();

  useEffect(() => {
    getRecentUrls().then(setRecentUrls);
  }, []);

  useEffect(() => {
    if (prefillUrl) setServerUrl(prefillUrl);
  }, [prefillUrl]);

  const handleLogin = async () => {
    if (!serverUrl.trim() || !password.trim()) {
      showAlert('Vul beide velden in');
      return;
    }
    setLoading(true);
    try {
      await login(serverUrl.trim(), password);
      await addRecentUrl(serverUrl.trim());
      setRecentUrls(await getRecentUrls());
      router.replace('/(tabs)/terminal' as any);
    } catch (err: any) {
      const url = serverUrl.trim().replace(/\/+$/, '');
      const fullUrl = /^https?:\/\//i.test(url) ? url : `http://${url}`;
      showAlert('Login mislukt', `${err.message}\n\nURL: ${fullUrl}/auth`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Hussle Terminal</Text>
        <Text style={styles.subtitle}>Verbind met je server</Text>

        <View style={styles.urlRow}>
          <TextInput
            style={[styles.input, styles.urlInput]}
            placeholder="Server URL (bijv. http://192.168.1.10:3443)"
            placeholderTextColor={colors.textDim}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {recentUrls.length > 0 && (
            <TouchableOpacity
              style={styles.historyBtn}
              onPress={() => setShowRecent(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="time-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <TextInput
          style={styles.input}
          placeholder="Wachtwoord"
          placeholderTextColor={colors.textDim}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.buttonText}>Verbinden</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={showRecent}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRecent(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowRecent(false)}>
          <Pressable style={styles.modalBox} onPress={() => {}}>
            <Text style={styles.modalTitle}>Recente servers</Text>
            <FlatList
              data={recentUrls}
              keyExtractor={(item) => item}
              ItemSeparatorComponent={() => <View style={styles.modalDivider} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalItem}
                  onPress={() => {
                    setServerUrl(item);
                    setShowRecent(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="server-outline" size={16} color={colors.textMuted} style={{ marginRight: 10 }} />
                  <Text style={styles.modalItemText} numberOfLines={1}>{item}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowRecent(false)}>
              <Text style={styles.modalCancelText}>Sluiten</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.title,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: fontSize.standard,
    textAlign: 'center',
    marginBottom: 32,
  },
  input: {
    backgroundColor: colors.elevated,
    color: colors.text,
    borderRadius: radius.md,
    padding: 14,
    fontSize: fontSize.body,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  urlInput: {
    flex: 1,
    marginBottom: 0,
  },
  historyBtn: {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: 14,
    marginLeft: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: fontSize.body,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalBox: {
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
  },
  modalTitle: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  modalItemText: {
    color: colors.textSecondary,
    fontSize: fontSize.standard,
    flex: 1,
  },
  modalDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  modalCancel: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  modalCancelText: {
    color: colors.textMuted,
    fontSize: fontSize.standard,
    fontWeight: '600',
  },
});
